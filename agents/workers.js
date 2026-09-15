// Workers — jobs the user sets up once and Nutaan runs on its own: a morning briefing at 07:30,
// "did any new RERA project get registered today", a stock price every hour, the weather, a
// site uptime check. Each run is a real headless agent turn with the web, the browser panel and
// the OS tools, and its final answer lands in the Updates feed (plus a desktop notification).
//
// Nothing here talks to the model directly — `runHeadless` is injected by main.js, which owns
// the agent loop. This module owns the schedule, the store, catch-up after sleep, and delivery.
const fs = require("node:fs/promises");
const path = require("node:path");

const TICK_MS = 30_000;
// A daily job the machine slept through still runs when it wakes, as long as it is the same
// morning — a 07:30 briefing at 09:10 is still wanted; the same one at 22:00 is not.
const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_UPDATES = 300;
const MAX_PARALLEL_RUNS = 2;

const TEMPLATES = [
  {
    id: "morning",
    name: "Morning briefing",
    icon: "☀️",
    prompt:
      "Prepare my morning briefing for today. Include: the date and day; the weather for my city today (high/low, rain chance); the top 5 news headlines that matter for my work; and, if a webmail is signed in in the browser panel, the 3 most important unread emails. Finish with one line: what I should do first today, based on what you found.",
    schedule: { type: "daily", time: "07:30", days: [] },
    readOnly: true,
  },
  {
    id: "rera",
    name: "New RERA projects today",
    icon: "🏗️",
    prompt:
      "Check the state RERA portal (e.g. https://rera.wb.gov.in, https://maharera.mahaonline.gov.in, or the one for my state — search for it if unsure) for real-estate projects registered or updated TODAY. Drive the portal's search form in the browser panel if needed. For each new project list: project name, promoter, district/city, RERA registration number, and the link. If nothing was registered today, say exactly 'No new RERA projects today' and then list the latest 3 registrations with their dates so I can see the trend.",
    schedule: { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5, 6] },
    readOnly: true,
  },
  {
    id: "stocks",
    name: "Stock price check",
    icon: "📈",
    prompt:
      "Report the current price of these tickers: RELIANCE.NS, TCS.NS, INFY.NS, NIFTY 50 (change the list to what I care about). One line per ticker: price, day change in %, and the 5-day trend. Then one line on the biggest news driving the biggest mover. Use a live source (Google Finance, NSE, Yahoo Finance) and name it.",
    schedule: { type: "interval", everyMinutes: 60 },
    readOnly: true,
  },
  {
    id: "weather",
    name: "Weather update",
    icon: "🌦️",
    prompt:
      "Give me today's weather for my city: current temperature, high/low, rain chance by the hour if it will rain, and air quality. One short paragraph, then one line of advice (umbrella / mask / good day to go out).",
    schedule: { type: "daily", time: "06:45", days: [] },
    readOnly: true,
  },
  {
    id: "uptime",
    name: "Site uptime check",
    icon: "🟢",
    prompt:
      "Open https://example.com (replace with my site) in the browser panel. Confirm it loads, note how long it took and whether any visible error, blank page or console error appears. If it looks broken, take a screenshot and describe exactly what is wrong. Reply 'UP — <ms>' or 'DOWN — <reason>' on the first line.",
    schedule: { type: "interval", everyMinutes: 30 },
    readOnly: true,
  },
  {
    id: "repo",
    name: "Project digest",
    icon: "🧑‍💻",
    prompt:
      "Summarise what changed in this project since the last run: run `git log --since=\"1 day ago\" --stat`, list the files touched and any new TODO/FIXME comments. If package.json has a test script, run it and report pass/fail with the failing test names. End with the single most useful next step.",
    schedule: { type: "daily", time: "08:00", days: [1, 2, 3, 4, 5] },
    readOnly: false,
    needsProject: true,
  },
  {
    id: "competitors",
    name: "Competitor watch",
    icon: "🔭",
    prompt:
      "Search the web for anything new in the last 24 hours about my competitors (name them here: e.g. Cursor, Windsurf, Claude Code, GPT Astra): launches, pricing changes, funding, outages, notable reviews. 3–8 bullets, each with a date and source link. Skip anything older than a day.",
    schedule: { type: "daily", time: "10:00", days: [] },
    readOnly: true,
  },
];

// Tools a worker is allowed to call. Read/browse/OS tools always; file and shell tools only
// when the user ticked "Allow changes" — and even then scoped to the worker's own root.
const LOOK_TOOLS = [
  "web_search", "web_fetch",
  "browser_navigate", "browser_read_page", "browser_click", "browser_type", "browser_scroll",
  "browser_screenshot", "browser_resize", "browser_execute_script",
  "os_search", "os_read", "os_system_stats",
  "kb_search", "kb_add", "memory_list", "memory_read", "memory_write",
  "list_dir", "read_file", "search_files", "list_skills", "use_skill", "task_write",
  "osint_http_recon", "osint_dns_recon", "osint_ip_lookup",
];
const CHANGE_TOOLS = ["write_file", "edit_file", "run_command", "run_background", "check_background_task", "list_background_tasks", "stop_background_task", "os_open", "os_launch_app"];

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return { h: 8, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

function atToday(now, hhmm) {
  const { h, m } = parseTime(hhmm);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

// The next moment this worker should fire, from `from`. Used both for display and for the tick.
function nextRunAt(worker, from = Date.now()) {
  const s = worker.schedule || {};
  if (!worker.enabled) return null;
  if (s.type === "interval") {
    const every = Math.max(1, Number(s.everyMinutes) || 60) * 60_000;
    return worker.lastRunAt ? worker.lastRunAt + every : from;
  }
  if (s.type === "daily") {
    const days = Array.isArray(s.days) && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) {
      const day = new Date(from + i * 86_400_000);
      const at = atToday(day, s.time);
      if (!days.includes(at.getDay())) continue;
      if (at.getTime() > from || (i === 0 && at.getTime() > (worker.lastRunAt || 0) && from - at.getTime() < CATCH_UP_WINDOW_MS)) {
        return at.getTime();
      }
    }
    return null;
  }
  if (s.type === "once") {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || worker.lastRunAt) return null;
    return t;
  }
  return null; // project-open / app-start are event driven
}

function isDue(worker, now) {
  const next = nextRunAt(worker, now);
  if (next == null) return false;
  if (next > now) return false;
  // Don't fire the same daily slot twice: lastRunAt after the slot means it already went.
  if (worker.schedule?.type === "daily" && worker.lastRunAt && worker.lastRunAt >= next) return false;
  return true;
}

function describeSchedule(s) {
  if (!s) return "manual";
  if (s.type === "interval") {
    const n = Number(s.everyMinutes) || 60;
    return n % 60 === 0 ? `every ${n / 60}h` : `every ${n} min`;
  }
  if (s.type === "daily") {
    const days = Array.isArray(s.days) && s.days.length ? s.days : null;
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const when = !days ? "daily" : days.length === 5 && !days.includes(0) && !days.includes(6) ? "weekdays" : days.map((d) => names[d]).join(" ");
    return `${when} at ${s.time || "08:00"}`;
  }
  if (s.type === "once") return `once at ${new Date(s.at).toLocaleString()}`;
  if (s.type === "project-open") return "when the project opens";
  if (s.type === "app-start") return "when Nutaan Code starts";
  return "manual";
}

class WorkerScheduler {
  constructor({ userDataDir, runHeadless, notify, emit, log = () => {} }) {
    this.file = path.join(userDataDir, "workers.json");
    this.updatesFile = path.join(userDataDir, "updates.json");
    this.scratchDir = path.join(userDataDir, "worker-files");
    this.runHeadless = runHeadless;
    this.notify = notify;
    this.emit = emit;
    this.log = log;
    this.workers = [];
    this.updates = [];
    this.running = new Map(); // workerId -> { controller, startedAt }
    this.queue = [];
    this.timer = null;
    this.loaded = false;
  }

  async load() {
    try { this.workers = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { this.workers = []; }
    try { this.updates = JSON.parse(await fs.readFile(this.updatesFile, "utf8")); } catch { this.updates = []; }
    if (!Array.isArray(this.workers)) this.workers = [];
    if (!Array.isArray(this.updates)) this.updates = [];
    this.loaded = true;
    return this;
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.workers, null, 2), "utf8");
  }

  async saveUpdates() {
    if (this.updates.length > MAX_UPDATES) this.updates.splice(MAX_UPDATES);
    await fs.writeFile(this.updatesFile, JSON.stringify(this.updates, null, 2), "utf8");
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log("tick failed: " + e.message)), TICK_MS);
    // First tick soon after start so "on app start" workers and anything missed overnight go now.
    setTimeout(() => this.tick("app-start").catch(() => {}), 3000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.running.values()) r.controller.abort();
  }

  templates() {
    return TEMPLATES;
  }

  list() {
    const now = Date.now();
    return this.workers.map((w) => ({
      ...w,
      nextRunAt: nextRunAt(w, now),
      scheduleText: describeSchedule(w.schedule),
      isRunning: this.running.has(w.id),
    }));
  }

  get(id) {
    return this.workers.find((w) => w.id === id) || null;
  }

  async create(spec) {
    const w = this._normalise({ ...spec, id: genId("wk"), createdAt: Date.now() });
    this.workers.unshift(w);
    await this.save();
    this._changed();
    return w;
  }

  async update(id, patch) {
    const idx = this.workers.findIndex((w) => w.id === id);
    if (idx < 0) throw new Error("No worker with id " + id);
    const w = this._normalise({ ...this.workers[idx], ...patch, id });
    this.workers[idx] = w;
    await this.save();
    this._changed();
    return w;
  }

  async remove(id) {
    const r = this.running.get(id);
    if (r) r.controller.abort();
    this.workers = this.workers.filter((w) => w.id !== id);
    await this.save();
    this._changed();
    return { ok: true };
  }

  _normalise(w) {
    const schedule = w.schedule && typeof w.schedule === "object" ? { ...w.schedule } : { type: "daily", time: "08:00", days: [] };
    if (!["daily", "interval", "once", "project-open", "app-start"].includes(schedule.type)) schedule.type = "daily";
    if (schedule.type === "daily") {
      schedule.time = /^\d{1,2}:\d{2}$/.test(String(schedule.time || "")) ? schedule.time : "08:00";
      schedule.days = Array.isArray(schedule.days) ? schedule.days.map(Number).filter((d) => d >= 0 && d <= 6) : [];
    }
    if (schedule.type === "interval") schedule.everyMinutes = Math.max(5, Math.min(24 * 60, Number(schedule.everyMinutes) || 60));
    return {
      id: w.id,
      name: String(w.name || "Worker").trim().slice(0, 80) || "Worker",
      icon: String(w.icon || "🤖").slice(0, 4),
      prompt: String(w.prompt || "").trim(),
      schedule,
      root: w.root ? String(w.root) : null,
      readOnly: w.readOnly !== false,
      notify: w.notify !== false,
      enabled: w.enabled !== false,
      model: w.model ? String(w.model) : null,
      createdAt: w.createdAt || Date.now(),
      lastRunAt: w.lastRunAt || null,
      lastStatus: w.lastStatus || null,
      lastHeadline: w.lastHeadline || null,
      runCount: w.runCount || 0,
    };
  }

  _changed() {
    try { this.emit("workers:changed", { workers: this.list() }); } catch {}
  }

  // ---- scheduling ----

  async tick(reason) {
    if (!this.loaded) await this.load();
    const now = Date.now();
    for (const w of this.workers) {
      if (!w.enabled || this.running.has(w.id) || this.queue.includes(w.id)) continue;
      const eventDriven = w.schedule?.type === "app-start";
      if (eventDriven ? reason === "app-start" : isDue(w, now)) this.enqueue(w.id, reason || "schedule");
    }
    this._drain();
  }

  // The renderer tells us a project was opened; workers pinned to that root with an
  // "on project open" schedule fire once per open.
  async projectOpened(root) {
    if (!this.loaded) await this.load();
    for (const w of this.workers) {
      if (w.enabled && w.schedule?.type === "project-open" && w.root && path.resolve(w.root) === path.resolve(root)) {
        this.enqueue(w.id, "project-open");
      }
    }
    this._drain();
  }

  enqueue(id, reason) {
    if (this.running.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this._reasons = this._reasons || new Map();
    this._reasons.set(id, reason);
  }

  _drain() {
    while (this.queue.length && this.running.size < MAX_PARALLEL_RUNS) {
      const id = this.queue.shift();
      const w = this.get(id);
      if (!w) continue;
      this._run(w, this._reasons?.get(id) || "schedule").catch((e) => this.log(`worker ${w.name} crashed: ${e.message}`));
    }
  }

  async runNow(id) {
    const w = this.get(id);
    if (!w) throw new Error("No worker with id " + id);
    this.enqueue(id, "manual");
    this._drain();
    return { ok: true, queued: !this.running.has(id) };
  }

  stopRun(id) {
    const r = this.running.get(id);
    if (!r) return { ok: false, error: "Not running" };
    r.controller.abort();
    return { ok: true };
  }

  async _run(worker, reason) {
    const controller = new AbortController();
    const startedAt = Date.now();
    this.running.set(worker.id, { controller, startedAt });
    this._changed();
    this.emit("workers:run", { id: worker.id, status: "running", startedAt, reason });

    const scratch = path.join(this.scratchDir, worker.id);
    await fs.mkdir(scratch, { recursive: true }).catch(() => {});
    const root = worker.root || scratch;
    const previous = this.updates.find((u) => u.workerId === worker.id && u.status === "ok");
    const allowed = new Set([...LOOK_TOOLS, ...(worker.readOnly ? [] : CHANGE_TOOLS)]);
    const events = [];

    const result = await this.runHeadless({
      root,
      model: worker.model || undefined,
      systemPrompt: workerSystemPrompt(worker, { previous, reason, root }),
      userPrompt: worker.prompt,
      allowedTools: allowed,
      readOnly: worker.readOnly,
      maxIterations: 40,
      controller,
      onEvent: (channel, data) => {
        if (channel === "agent:tool-start") events.push({ at: Date.now(), tool: data.name, args: summariseArgs(data.args) });
        if (channel === "agent:tool-start" || channel === "agent:assistant-delta") {
          this.emit("workers:run", { id: worker.id, status: "running", startedAt, tool: data.name || null });
        }
      },
    });

    this.running.delete(worker.id);
    const text = String(result.text || "").trim();
    const ok = result.ok && text.length > 0;
    const headline = ok ? firstLine(text) : result.error || (result.aborted ? "Stopped" : "The worker finished without producing an update");

    const update = {
      id: genId("up"),
      workerId: worker.id,
      workerName: worker.name,
      icon: worker.icon,
      at: Date.now(),
      durationMs: Date.now() - startedAt,
      status: ok ? "ok" : "error",
      headline: headline.slice(0, 160),
      body: ok ? text : (result.error || headline),
      toolsUsed: events.slice(0, 40),
      reason,
      unread: true,
    };
    this.updates.unshift(update);
    await this.saveUpdates();

    Object.assign(worker, { lastRunAt: Date.now(), lastStatus: update.status, lastHeadline: update.headline, runCount: (worker.runCount || 0) + 1 });
    await this.save();

    this.emit("workers:update", update);
    this.emit("workers:run", { id: worker.id, status: "done", ok });
    this._changed();
    // Notify on every finish, manual runs included — a worker run is async and the user often
    // switches away while it works, so the desktop toast is how they learn it's done. (On Windows a
    // toast only appears once the app has set its AppUserModelId, which it now does at startup.)
    if (worker.notify) {
      try { this.notify({ title: `${worker.icon} ${worker.name}`, body: update.headline }); } catch {}
    }
    this._drain();
    return update;
  }

  // ---- updates feed ----

  listUpdates(limit = 100) {
    return this.updates.slice(0, limit);
  }

  unreadCount() {
    return this.updates.filter((u) => u.unread).length;
  }

  async markRead(ids) {
    const set = ids ? new Set(ids) : null;
    for (const u of this.updates) if (!set || set.has(u.id)) u.unread = false;
    await this.saveUpdates();
    this._changed();
    return { ok: true };
  }

  async clearUpdates() {
    this.updates = [];
    await this.saveUpdates();
    this._changed();
    return { ok: true };
  }
}

function firstLine(text) {
  return String(text).split("\n").map((l) => l.replace(/^[#*\-\s>]+/, "").trim()).find((l) => l) || "Update";
}

function summariseArgs(args) {
  if (!args || typeof args !== "object") return "";
  const v = args.url || args.query || args.path || args.command || args.selector || "";
  return String(v).slice(0, 120);
}

function workerSystemPrompt(worker, { previous, reason, root }) {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    `You are "${worker.name}", a scheduled worker inside Nutaan Code, running unattended on the user's own computer (${reason === "manual" ? "started by hand" : "on schedule"}).`,
    `Now: ${now.toLocaleString()} (${tz}). Today's date is ${now.toISOString().slice(0, 10)}.`,
    `Working folder: ${root}${worker.root ? " (the user's project)" : " (a scratch folder — you have no project open)"}.`,
    "Your job is given in the next message. Do the actual work now using your tools — web_search then web_fetch/browser_navigate to read the real page, browser_read_page to read forms and results, browser_click/browser_type to drive a search form, os_* to read files on this computer. Never answer from memory when a tool can get the live fact.",
    "The built-in browser panel keeps its own logins: if a site needs a sign-in you cannot complete, say so in one line and continue with what is reachable.",
    "There is nobody to answer questions: never ask the user anything, never wait for approval, never stop at 'I would need to…'. If a source is unreachable, try one alternative source, then report the gap honestly.",
    worker.readOnly
      ? "This worker is read-only: you cannot write files or run shell commands. Report what you would change instead of trying."
      : "This worker may edit files and run commands inside its working folder.",
    "OUTPUT FORMAT — your final message is the update the user reads on their desktop or phone:",
    "  line 1: a headline of at most 80 characters with the single most important fact (a number, a name, a status).",
    "  then 3–12 short lines of concrete findings: figures, names, dates, and the source URL for each fact.",
    "  if this is a recurring check, say what CHANGED since the previous run (below), or 'no change'.",
    "  if you could not verify something, one line saying what and why. Never invent a figure, a project, a headline or a price.",
    previous
      ? `PREVIOUS RUN (${new Date(previous.at).toLocaleString()}):\n${String(previous.body).slice(0, 2500)}`
      : "This is the first run — there is no previous update to compare against.",
  ].join("\n");
}

module.exports = { WorkerScheduler, TEMPLATES, LOOK_TOOLS, CHANGE_TOOLS, nextRunAt, describeSchedule };
