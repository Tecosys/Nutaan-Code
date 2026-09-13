// Self-Healing Workspace — Nutaan keeps an eye on the whole workspace, not just the chat:
//
//   background tasks (dev server, build, watcher)  → crash / compile / unhandled-error lines
//   the built-in browser panel                     → console errors, failed page loads, 5xx
//   a health URL the user pins for the project     → healthy → unhealthy transitions
//   the test command, re-run on file change        → a red suite
//
// Anything it sees becomes an incident. In `watch` mode it tells the user; in `auto` mode it
// hands the incident to a repair agent that walks Detect → Reproduce → Diagnose → Patch → Test
// → Deploy → Verify, reporting each stage through the heal_step tool so the UI shows the loop
// live, and posts the result to the Updates feed.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

const STAGES = ["detect", "reproduce", "diagnose", "patch", "test", "deploy", "verify"];
const DEDUP_WINDOW_MS = 30 * 60 * 1000;
const MAX_INCIDENTS = 100;
const MAX_REPAIRS_PER_FINGERPRINT = 2;
const HEALTH_POLL_MS = 60_000;
const TEST_DEBOUNCE_MS = 3000;
const TEST_TIMEOUT_MS = 180_000;
// A long-running command (dev server, watcher) that exits this soon after it started crashed.
const EARLY_EXIT_MS = 90_000;

const ERROR_PATTERNS = [
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError)\b\s*[:]/,
  /\bError:\s+\S/,
  /\b(ECONNREFUSED|EADDRINUSE|ENOENT|EACCES|EPERM|ETIMEDOUT)\b/,
  /Cannot find module|Module not found|ModuleNotFoundError|ImportError|cannot resolve/i,
  /Traceback \(most recent call last\)/,
  /\bpanic:|fatal error|\bFATAL\b/,
  /failed to compile|Build failed|compilation failed|error TS\d+|\[vite\].*error|✘ \[ERROR\]/i,
  /Unhandled(Promise)?Rejection|Unhandled rejection|Uncaught (exception|error|TypeError|ReferenceError)/i,
  /Tests:\s+\d+ failed|\d+ failing\b|FAIL\s+\S+\.(test|spec)\.|AssertionError/i,
  /\b5\d\d\b.*(Internal Server Error|Bad Gateway|Service Unavailable)|Internal Server Error/i,
  /segmentation fault|core dumped|out of memory|heap out of memory/i,
];
const NOISE = /\b(warn(ing)?|deprecat|ExperimentalWarning|npm notice|npm WARN|punycode)\b/i;
const LONG_RUNNING = /\b(dev|start|serve|watch|preview|runserver|nodemon|tsc -w|--watch)\b/i;

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function looksLikeError(line) {
  if (!line || NOISE.test(line)) return false;
  return ERROR_PATTERNS.some((re) => re.test(line));
}

function fingerprintOf(source, text) {
  const norm = String(text || "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 90).toLowerCase();
  return `${source}:${norm}`;
}

class Healer {
  constructor({ userDataDir, runHeadless, notify, emit, bgTasks, postUpdate, log = () => {} }) {
    this.file = path.join(userDataDir, "healer.json");
    this.runHeadless = runHeadless;
    this.notify = notify;
    this.emit = emit;
    this.bgTasks = bgTasks; // { list(), view(id), stop(id) }
    this.postUpdate = postUpdate;
    this.log = log;
    this.state = { mode: "watch", projects: {}, incidents: [] };
    this.loaded = false;
    this.repairing = new Map(); // root -> incidentId
    this.bgSeen = new Map(); // taskId -> { lastSignalAt, lines: [] }
    this.health = new Map(); // root -> { healthy: null|bool, timer }
    this.watchers = new Map(); // root -> { fsw, timer, running }
    this.activeRoots = new Set();
    this.repairAttempts = new Map(); // fingerprint -> count
  }

  async load() {
    try { this.state = { ...this.state, ...JSON.parse(await fs.readFile(this.file, "utf8")) }; } catch {}
    if (!["off", "watch", "auto"].includes(this.state.mode)) this.state.mode = "watch";
    if (!this.state.projects || typeof this.state.projects !== "object") this.state.projects = {};
    if (!Array.isArray(this.state.incidents)) this.state.incidents = [];
    // A repair that was mid-flight when the app closed is not still running.
    for (const inc of this.state.incidents) if (inc.status === "repairing") { inc.status = "failed"; inc.summary = inc.summary || "Nutaan Code was closed during the repair."; }
    this.loaded = true;
    return this;
  }

  async save() {
    if (this.state.incidents.length > MAX_INCIDENTS) this.state.incidents.splice(MAX_INCIDENTS);
    await fs.mkdir(path.dirname(this.file), { recursive: true }).catch(() => {});
    await fs.writeFile(this.file, JSON.stringify(this.state, null, 2), "utf8").catch(() => {});
  }

  view(root) {
    const project = root ? this.projectConfig(root) : null;
    return {
      mode: this.state.mode,
      stages: STAGES,
      project: project ? { root, ...project, healthy: this.health.get(root)?.healthy ?? null } : null,
      incidents: this.state.incidents.filter((i) => !root || i.root === root).slice(0, 50),
      openCount: this.state.incidents.filter((i) => i.status === "detected" || i.status === "repairing").length,
      repairing: [...this.repairing.values()],
    };
  }

  projectConfig(root) {
    const key = path.resolve(root);
    return this.state.projects[key] || { healthUrl: "", testCommand: "", deployCommand: "", watchTests: false };
  }

  _changed(root) {
    try { this.emit("healer:changed", this.view(root)); } catch {}
  }

  async setMode(mode) {
    if (!["off", "watch", "auto"].includes(mode)) throw new Error("mode must be off, watch or auto");
    this.state.mode = mode;
    await this.save();
    this._changed();
    return this.view();
  }

  async configureProject(root, patch) {
    const key = path.resolve(root);
    const next = { ...this.projectConfig(root), ...patch };
    next.healthUrl = String(next.healthUrl || "").trim();
    next.testCommand = String(next.testCommand || "").trim();
    next.deployCommand = String(next.deployCommand || "").trim();
    next.watchTests = !!next.watchTests && !!next.testCommand;
    this.state.projects[key] = next;
    await this.save();
    this._armProject(root);
    this._changed(root);
    return this.view(root);
  }

  // Called when the renderer opens a project: start the health poll and the test watcher.
  projectOpened(root) {
    if (!root) return;
    this.activeRoots.add(path.resolve(root));
    this._armProject(root);
  }

  _armProject(root) {
    const key = path.resolve(root);
    const cfg = this.projectConfig(root);
    // health poll
    const h = this.health.get(key) || { healthy: null, timer: null };
    if (h.timer) clearInterval(h.timer);
    h.timer = null;
    if (cfg.healthUrl && this.state.mode !== "off") {
      h.timer = setInterval(() => this._pollHealth(key).catch(() => {}), HEALTH_POLL_MS);
      setTimeout(() => this._pollHealth(key).catch(() => {}), 1500);
    }
    this.health.set(key, h);
    // test-on-change watcher
    const w = this.watchers.get(key);
    if (w?.fsw) { try { w.fsw.close(); } catch {} }
    this.watchers.delete(key);
    if (cfg.watchTests && cfg.testCommand && this.state.mode !== "off") {
      try {
        const fsw = fsSync.watch(key, { recursive: true }, (_ev, file) => {
          const f = String(file || "");
          if (/(^|[\\/])(node_modules|\.git|dist|build|out|coverage|\.next|__pycache__)([\\/]|$)/.test(f)) return;
          this._scheduleTests(key);
        });
        fsw.on("error", () => {});
        this.watchers.set(key, { fsw, timer: null, running: false });
      } catch (e) {
        this.log("could not watch " + key + ": " + e.message);
      }
    }
  }

  _scheduleTests(key) {
    const w = this.watchers.get(key);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => this._runTests(key).catch(() => {}), TEST_DEBOUNCE_MS);
  }

  async _runTests(key, { manual = false } = {}) {
    const cfg = this.projectConfig(key);
    if (!cfg.testCommand) return { ok: true, skipped: true };
    const w = this.watchers.get(key) || {};
    if (w.running) return { ok: true, skipped: true };
    w.running = true;
    this.emit("healer:activity", { root: key, activity: "Running tests", command: cfg.testCommand });
    const res = await new Promise((resolve) => {
      exec(cfg.testCommand, { cwd: key, timeout: TEST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, out: (stdout || "") + (stderr || "") });
      });
    });
    w.running = false;
    this.emit("healer:activity", { root: key, activity: null });
    if (res.code !== 0) {
      const tail = res.out.split(/\r?\n/).filter(Boolean).slice(-40).join("\n");
      const failing = res.out.split(/\r?\n/).find((l) => /failing|failed|FAIL|Error/.test(l)) || `exit code ${res.code}`;
      await this.signal({ source: "tests", root: key, title: `Tests failing: ${failing.trim().slice(0, 100)}`, evidence: `$ ${cfg.testCommand}\n${tail}`, command: cfg.testCommand });
      return { ok: false, output: tail };
    }
    if (manual) this.emit("healer:activity", { root: key, activity: null, note: "Tests passed" });
    return { ok: true, output: res.out.slice(-1500) };
  }

  async _pollHealth(key) {
    const cfg = this.projectConfig(key);
    if (!cfg.healthUrl) return;
    const h = this.health.get(key);
    if (!h) return;
    let ok = false;
    let detail = "";
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(cfg.healthUrl, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(t);
      ok = res.status < 500;
      detail = `HTTP ${res.status} in ${Date.now() - started}ms`;
      if (ok && res.status >= 400) detail += " (client error — the URL itself may be wrong, not the app)";
    } catch (e) {
      detail = e.name === "AbortError" ? "timed out after 8s" : e.message;
    }
    const was = h.healthy;
    h.healthy = ok;
    this.emit("healer:health", { root: key, healthy: ok, detail, url: cfg.healthUrl });
    // Only a healthy → unhealthy transition is an incident: a server that was never up is just
    // not started yet, not broken.
    if (was === true && !ok) {
      await this.signal({ source: "health", root: key, title: `${cfg.healthUrl} stopped responding (${detail})`, evidence: `Health check ${cfg.healthUrl}: ${detail}`, url: cfg.healthUrl });
    }
  }

  // ---- signals from main.js (background tasks) and the renderer (browser panel) ----

  onBgOutput(task, stream, line) {
    if (this.state.mode === "off") return;
    if (!looksLikeError(line)) return;
    const seen = this.bgSeen.get(task.id) || { lastSignalAt: 0, lines: [] };
    seen.lines.push(line);
    if (seen.lines.length > 30) seen.lines.splice(0, seen.lines.length - 30);
    this.bgSeen.set(task.id, seen);
    if (Date.now() - seen.lastSignalAt < 15_000) return; // one incident per burst
    seen.lastSignalAt = Date.now();
    const context = (task.output || []).slice(-25).map((o) => o.line).join("\n");
    this.signal({ source: "logs", root: task.cwd, title: line.trim().slice(0, 120), evidence: `$ ${task.command}\n…\n${context}`, command: task.command, bgTaskId: task.id }).catch(() => {});
  }

  onBgExit(task) {
    if (this.state.mode === "off") return;
    const ran = (task.endedAt || Date.now()) - task.startedAt;
    const code = task.exitCode;
    if (code === 0 || code == null) return;
    if (!LONG_RUNNING.test(task.command) && ran > EARLY_EXIT_MS) return; // a one-shot command failing is the agent's business
    const tail = (task.output || []).slice(-25).map((o) => o.line).join("\n");
    this.signal({ source: "logs", root: task.cwd, title: `${task.command.slice(0, 60)} exited with code ${code} after ${Math.round(ran / 1000)}s`, evidence: `$ ${task.command}\n${tail}`, command: task.command, bgTaskId: task.id }).catch(() => {});
  }

  // Any surface can report a problem: {source, root, title, evidence, url?, command?}
  async signal(sig) {
    if (!this.loaded) await this.load();
    if (this.state.mode === "off") return null;
    const root = sig.root ? path.resolve(sig.root) : null;
    const fp = fingerprintOf(sig.source, sig.title);
    const recent = this.state.incidents.find((i) => i.fingerprint === fp && Date.now() - i.detectedAt < DEDUP_WINDOW_MS && i.status !== "ignored");
    if (recent) {
      recent.occurrences = (recent.occurrences || 1) + 1;
      recent.lastSeenAt = Date.now();
      await this.save();
      this._changed(root);
      return recent;
    }
    const incident = {
      id: genId("inc"),
      fingerprint: fp,
      root,
      source: sig.source,
      title: String(sig.title || "Problem detected").slice(0, 200),
      evidence: String(sig.evidence || "").slice(0, 6000),
      url: sig.url || null,
      command: sig.command || null,
      bgTaskId: sig.bgTaskId || null,
      detectedAt: Date.now(),
      lastSeenAt: Date.now(),
      occurrences: 1,
      status: "detected",
      stages: STAGES.map((s) => ({ stage: s, status: s === "detect" ? "done" : "pending", note: s === "detect" ? `Seen in ${sig.source}` : "" })),
      summary: null,
      filesChanged: [],
    };
    this.state.incidents.unshift(incident);
    await this.save();
    this.emit("healer:incident", { incident });
    this._changed(root);
    if (this.state.mode === "auto" && root) {
      const attempts = this.repairAttempts.get(fp) || 0;
      if (attempts >= MAX_REPAIRS_PER_FINGERPRINT) {
        incident.summary = `Auto-repair gave up: this same problem was already attempted ${attempts} times. It needs a human look.`;
        incident.status = "needs-human";
        await this.save();
        this._changed(root);
        try { this.notify({ title: "Needs a human: " + incident.title, body: incident.summary }); } catch {}
      } else {
        this.repair(incident.id).catch((e) => this.log("repair failed: " + e.message));
      }
    } else {
      try { this.notify({ title: "Problem detected", body: incident.title }); } catch {}
    }
    return incident;
  }

  async ignore(id) {
    const inc = this.state.incidents.find((i) => i.id === id);
    if (inc) { inc.status = "ignored"; await this.save(); this._changed(inc.root); }
    return { ok: true };
  }

  async clear() {
    this.state.incidents = this.state.incidents.filter((i) => i.status === "repairing");
    await this.save();
    this._changed();
    return { ok: true };
  }

  // Manual "check now": tests + health URL for one project.
  async scan(root) {
    if (!this.loaded) await this.load();
    const key = path.resolve(root);
    const cfg = this.projectConfig(root);
    const findings = [];
    if (cfg.healthUrl) {
      await this._pollHealth(key);
      const h = this.health.get(key);
      findings.push({ check: "health", ok: h?.healthy === true, detail: cfg.healthUrl });
    }
    if (cfg.testCommand) {
      const r = await this._runTests(key, { manual: true });
      findings.push({ check: "tests", ok: r.ok, detail: r.skipped ? "already running" : r.ok ? "passed" : "failing" });
    }
    for (const t of this.bgTasks.list()) {
      if (path.resolve(t.cwd || "") !== key) continue;
      const v = this.bgTasks.view(t.id);
      const bad = (v?.output || "").split("\n").filter(looksLikeError).slice(-3);
      findings.push({ check: `task ${t.id}`, ok: !bad.length && t.status === "running", detail: bad[0] || t.status });
      if (bad.length) await this.signal({ source: "logs", root: key, title: bad[bad.length - 1].slice(0, 120), evidence: v.output.slice(-2500), command: t.command, bgTaskId: t.id });
    }
    return { findings, view: this.view(root) };
  }

  // ---- the repair loop ----

  async repair(id) {
    const inc = this.state.incidents.find((i) => i.id === id);
    if (!inc) throw new Error("No incident " + id);
    if (!inc.root) throw new Error("This incident is not tied to a project folder");
    if (this.repairing.has(inc.root)) throw new Error("A repair is already running in this project");
    this.repairing.set(inc.root, inc.id);
    this.repairAttempts.set(inc.fingerprint, (this.repairAttempts.get(inc.fingerprint) || 0) + 1);
    inc.status = "repairing";
    inc.repairStartedAt = Date.now();
    for (const s of inc.stages) if (s.stage !== "detect") { s.status = "pending"; s.note = ""; }
    await this.save();
    this._changed(inc.root);

    const cfg = this.projectConfig(inc.root);
    const controller = new AbortController();
    inc._controller = controller;
    const bgNow = this.bgTasks.list().filter((t) => path.resolve(t.cwd || "") === inc.root).map((t) => `${t.id}: ${t.command} (${t.status})`).join("\n");

    const healStep = async ({ stage, status, note }) => {
      const s = inc.stages.find((x) => x.stage === String(stage || "").toLowerCase());
      if (!s) return { ok: false, error: `stage must be one of ${STAGES.join(", ")}` };
      s.status = ["in_progress", "done", "skipped", "failed"].includes(status) ? status : "in_progress";
      s.note = String(note || "").slice(0, 300);
      s.at = Date.now();
      this._changed(inc.root);
      return { ok: true, stage: s.stage, status: s.status };
    };

    const result = await this.runHeadless({
      root: inc.root,
      systemPrompt: repairPrompt(inc, cfg, bgNow),
      userPrompt: `INCIDENT: ${inc.title}\n\nEVIDENCE:\n${inc.evidence}`,
      allowedTools: new Set(["list_dir", "read_file", "search_files", "write_file", "edit_file", "run_command", "run_background", "check_background_task", "list_background_tasks", "stop_background_task", "browser_navigate", "browser_read_page", "browser_screenshot", "browser_click", "browser_type", "browser_execute_script", "web_search", "web_fetch", "task_write", "heal_step", "view_image", "list_skills", "use_skill"]),
      readOnly: false,
      maxIterations: 45,
      controller,
      hooks: { heal_step: healStep },
      onEvent: (channel, data) => {
        if (channel === "agent:tool-start") {
          inc.currentTool = data.name;
          if (data.name === "write_file" || data.name === "edit_file") {
            if (data.args?.path && !inc.filesChanged.includes(data.args.path)) inc.filesChanged.push(data.args.path);
          }
          this.emit("healer:activity", { root: inc.root, incidentId: inc.id, activity: data.name, args: data.args });
        }
      },
    });

    inc._controller = null;
    inc.currentTool = null;
    this.repairing.delete(inc.root);
    const text = String(result.text || "").trim();
    const verified = inc.stages.find((s) => s.stage === "verify")?.status === "done";
    const patched = inc.stages.find((s) => s.stage === "patch")?.status === "done";
    inc.status = result.ok && verified ? "fixed" : result.ok && patched ? "patched-unverified" : "failed";
    inc.summary = text || result.error || (result.aborted ? "Repair stopped." : "The repair agent finished without a report.");
    inc.repairEndedAt = Date.now();
    await this.save();
    this._changed(inc.root);
    this.emit("healer:repair-done", { incident: inc });
    try {
      this.notify({ title: inc.status === "fixed" ? "Fixed: " + inc.title.slice(0, 60) : "Repair " + inc.status + ": " + inc.title.slice(0, 50), body: firstLine(inc.summary) });
      this.postUpdate?.({ icon: inc.status === "fixed" ? "🩹" : "⚠️", workerName: "Self-Healing", headline: `${inc.status === "fixed" ? "Fixed" : "Repair " + inc.status}: ${inc.title}`.slice(0, 160), body: inc.summary, status: inc.status === "fixed" ? "ok" : "error" });
    } catch {}
    return inc;
  }

  stopRepair(id) {
    const inc = this.state.incidents.find((i) => i.id === id);
    if (!inc?._controller) return { ok: false, error: "Not repairing" };
    inc._controller.abort();
    return { ok: true };
  }

  shutdown() {
    for (const h of this.health.values()) if (h.timer) clearInterval(h.timer);
    for (const w of this.watchers.values()) { try { w.fsw?.close(); } catch {} }
    for (const inc of this.state.incidents) inc._controller?.abort();
  }
}

function firstLine(text) {
  return String(text || "").split("\n").map((l) => l.replace(/^[#*\-\s>]+/, "").trim()).find((l) => l) || "";
}

function repairPrompt(inc, cfg, bgNow) {
  return [
    "You are the Self-Healing agent of Nutaan Code. Something in the user's workspace broke and you are fixing it, unattended, on their own machine. Nobody will answer a question — investigate, decide, act, verify, report.",
    `Project root: ${inc.root}. Now: ${new Date().toLocaleString()}.`,
    `Source of the signal: ${inc.source}${inc.command ? ` — command: ${inc.command}` : ""}${inc.url ? ` — URL: ${inc.url}` : ""}.`,
    bgNow ? `Background tasks currently in this project:\n${bgNow}` : "No background task is running in this project right now.",
    cfg.testCommand ? `Test command for this project: ${cfg.testCommand}` : "No test command is configured; look for one in package.json / Makefile / pyproject.",
    cfg.deployCommand ? `Deploy command for this project: ${cfg.deployCommand}` : "No deploy command is configured — 'deploy' here means restart the dev server / rebuild so the fix is live locally.",
    cfg.healthUrl ? `Health URL: ${cfg.healthUrl}` : "",
    "",
    "Work the repair loop and report every stage with the heal_step tool (stage, status in_progress|done|skipped|failed, note) — the user watches these stages live:",
    "  1. reproduce — make the failure happen: re-run the command, run the tests, or open the URL in the browser panel (browser_navigate + browser_read_page). Capture the exact error.",
    "  2. diagnose — read the code at the stack trace / failing test. Find the root cause, not the symptom. Say which file and line.",
    "  3. patch — the smallest change that fixes the cause (edit_file). Do not refactor around it.",
    "  4. test — run the test command / build / the failing command again. If it still fails, go back to diagnose (max 3 rounds).",
    "  5. deploy — restart the affected background task (stop_background_task then run_background with the same command), or run the deploy command if one is configured.",
    "  6. verify — prove it is fixed the way the user would notice: open the page in the browser panel and read/screenshot it, or show the test output green. Mark verify done ONLY with that evidence.",
    "If the cause is outside the code (a port in use, a missing env var, a service down), fix what you can (free the port, add the var to .env.example and say what value is needed) and be explicit about what needs the user.",
    "Never mark a stage done that you did not actually do. Never claim verification without having run or opened the thing.",
    "Final message (the user reads this): `What broke` (1 line), `Root cause` (1–2 lines, file:line), `What I changed` (files), `How I verified` (the evidence), `Still needs you` (if anything).",
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

module.exports = { Healer, STAGES, looksLikeError };
