// Nutaan Swarm — one goal, a team of agents. The Planner reads the project and splits the goal
// into role-tagged tasks with dependencies; the roles run in parallel waves, each as its own
// headless agent with only the tools its job needs; every finished task posts its findings to
// a shared board that later tasks read; a final merge turns the board into one report.
//
//   Nutaan
//    ├─ Planner      reads the codebase, writes the plan
//    ├─ Developer    writes and edits code, runs commands
//    ├─ Browser QA   drives the built-in browser, screenshots, checks the real thing
//    ├─ Researcher   web + knowledge base, verifies facts across sources
//    ├─ Reviewer     reads diffs, runs tests and the static scanner, flags risk
//    └─ DevOps       builds, env, deploy, health checks
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_PARALLEL = 3;
const MAX_TASKS = 9;
const MAX_RUNS_KEPT = 30;

const READ_TOOLS = ["list_dir", "read_file", "search_files", "list_skills", "use_skill", "task_write", "memory_list", "memory_read"];
const BROWSER_TOOLS = ["browser_navigate", "browser_read_page", "browser_click", "browser_type", "browser_scroll", "browser_screenshot", "browser_resize", "browser_execute_script"];
const SHELL_TOOLS = ["run_command", "run_background", "check_background_task", "list_background_tasks", "stop_background_task"];
const WRITE_TOOLS = ["write_file", "edit_file"];
const WEB_TOOLS = ["web_search", "web_fetch", "map_route"];

const ROLES = {
  planner: {
    name: "Planner",
    icon: "🧭",
    color: "#c084fc",
    tools: [...READ_TOOLS, ...WEB_TOOLS, "kb_search"],
    brief: "You plan; you do not build. Read enough of the project to split the goal into concrete tasks for the team.",
  },
  developer: {
    name: "Developer",
    icon: "🛠️",
    color: "#60a5fa",
    tools: [...READ_TOOLS, ...WRITE_TOOLS, ...SHELL_TOOLS, ...WEB_TOOLS, "kb_search", "view_image", "generate_image"],
    brief: "You write and edit code in the project and run commands to make sure it builds. Prefer edit_file over write_file for existing files. Leave the tree in a working state.",
  },
  qa: {
    name: "Browser QA",
    icon: "🧪",
    color: "#4ade80",
    tools: [...READ_TOOLS, ...BROWSER_TOOLS, ...SHELL_TOOLS, "view_image"],
    brief: "You test the real thing. Start the dev server if it isn't running (run_background), open the page in the browser panel, read it, click through the flow, screenshot it at desktop and mobile sizes, and report exactly what works and what is broken with the evidence.",
  },
  researcher: {
    name: "Researcher",
    icon: "🔎",
    color: "#fb923c",
    tools: [...READ_TOOLS, ...WEB_TOOLS, ...BROWSER_TOOLS, "kb_search", "kb_add", "memory_write", "osint_http_recon", "osint_dns_recon"],
    brief: "You find out. Search the web, open the promising results in the browser panel and actually read them, cross-check facts across at least two sources, and cite the URL for every claim.",
  },
  reviewer: {
    name: "Reviewer",
    icon: "🧐",
    color: "#f472b6",
    tools: [...READ_TOOLS, "run_command", "vuln_static_scan", "web_search"],
    brief: "You review. Read what the Developer changed (git diff, the files named in the board), run the test suite and the static vulnerability scan, and report bugs, security issues and gaps with file:line references. Do not rewrite code — say precisely what should change.",
  },
  devops: {
    name: "DevOps",
    icon: "🚀",
    color: "#facc15",
    tools: [...READ_TOOLS, ...WRITE_TOOLS, ...SHELL_TOOLS, ...WEB_TOOLS, "browser_navigate", "browser_read_page", "browser_screenshot", "os_system_stats"],
    brief: "You make it run and ship. Build scripts, environment files, Docker/CI config, deploy commands, and a post-deploy health check with the actual URL opened in the browser panel.",
  },
};

// Outcome → the shape of team that usually delivers it. The Planner adapts these to what is
// actually in the project; they are a starting point, not a script.
const OUTCOME_PLAYBOOKS = {
  "build a saas": "Researcher: target user + 3 comparable products + stack recommendation. Developer: scaffold app, auth, a billing stub, landing page, README. Browser QA: sign-up → dashboard smoke test. Reviewer: security + gaps. DevOps: run scripts, env template, deploy config.",
  "fix production": "Researcher: reproduce from logs/URL, pin the failing step. Developer: minimal patch with a test. Browser QA: verify the fixed flow in the browser. Reviewer: regression risk. DevOps: deploy + health check.",
  "launch website": "Developer: build/finish the pages. Researcher: SEO title/meta/OG copy and a launch checklist. Browser QA: responsive check at desktop/mobile, links, forms. DevOps: build + deploy + verify the live URL.",
  "create marketing campaign": "Researcher: audience, competitors' messaging, 5 angles. Developer: landing page + 3 email templates + social post copy files. Reviewer: copy review for claims and consistency.",
  "research competitors": "One Researcher per competitor (pricing, features, positioning, recent news, weaknesses) in parallel. Reviewer: merge into a comparison table + where we win.",
  "set up crm": "Researcher: fit-for-purpose options (HubSpot, Twenty, Attio, self-hosted) with pricing. Developer: schema/contacts model + import script + integration stubs. Browser QA: walk through the configured CRM in the browser.",
  "deploy application": "DevOps: build, env, deploy command/config for the target (Vercel/Netlify/Docker/VPS). Browser QA: open the live URL and verify. Reviewer: secrets/config exposure check.",
  "plan a trip": "One Researcher per leg of the cost. Researcher A (travel): shortest route and total distance via maps, plus the actual trains for each leg — train name and number, class fares, current availability/waitlist and confirmation chance — with the source URL. Researcher B (local transport): car rental and cab fares between and within the destinations from InDrive/Ola/Uber, per km and estimated totals. Researcher C (stay): hotels at each stop with real per-night prices and review scores, a budget and a comfortable pick each. Researcher D (food): realistic daily food cost per person at each stop. Reviewer: merge every leg into one itinerary with a clear day-by-day plan and a costed table (low-cost total and comfortable total), every figure carrying its source. Open the promising pages in the browser and read the real numbers — never invent a fare, a train number or a price.",
};

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// One short human line for a tool call — "Searched X", "Read Y", "Ran Z", "Opened <url>" — the
// step trail the UI shows under each agent. Kept generic so any tool renders as something readable.
function stepLabel(name, args = {}) {
  const a = args || {};
  const first = (v) => (typeof v === "string" ? v : "");
  switch (name) {
    case "search_files": return `Searched ${first(a.query || a.pattern) || "files"}`;
    case "read_file": return `Read ${first(a.path) || "a file"}`;
    case "list_dir": return `Listed ${first(a.path) || "a folder"}`;
    case "write_file": return `Wrote ${first(a.path) || "a file"}`;
    case "edit_file": return `Edited ${first(a.path) || "a file"}`;
    case "run_command": case "run_background": return `Ran ${first(a.command).slice(0, 60) || "a command"}`;
    case "web_search": return `Searched the web: ${first(a.query).slice(0, 60)}`;
    case "web_fetch": return `Fetched ${first(a.url).slice(0, 60)}`;
    case "browser_navigate": return `Opened ${first(a.url).slice(0, 60)}`;
    case "browser_read_page": return "Read the page";
    case "browser_click": return `Clicked ${first(a.selector || a.text).slice(0, 40)}`;
    case "browser_screenshot": return "Took a screenshot";
    case "kb_search": return `Searched the knowledge base: ${first(a.query).slice(0, 50)}`;
    case "vuln_static_scan": return "Ran the vulnerability scan";
    default: {
      if (name && name.startsWith("mcp__")) return name.replace(/^mcp__/, "").replace(/__/g, " · ").replace(/-/g, " ");
      return String(name || "worked").replace(/_/g, " ");
    }
  }
}

function extractJson(text) {
  const s = String(text || "");
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidates = [fence && fence[1], s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1), s];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
  }
  return null;
}

function playbookFor(goal) {
  const g = String(goal || "").toLowerCase();
  for (const [k, v] of Object.entries(OUTCOME_PLAYBOOKS)) {
    const words = k.split(" ");
    if (words.every((w) => g.includes(w))) return v;
  }
  if (/\b(saas|startup|product|mvp)\b/.test(g)) return OUTCOME_PLAYBOOKS["build a saas"];
  if (/\b(prod|production|broken|down|crash|500|outage|bug)\b/.test(g)) return OUTCOME_PLAYBOOKS["fix production"];
  if (/\b(launch|website|site|landing)\b/.test(g)) return OUTCOME_PLAYBOOKS["launch website"];
  if (/\b(marketing|campaign|ads?|newsletter)\b/.test(g)) return OUTCOME_PLAYBOOKS["create marketing campaign"];
  if (/\b(competitor|competition|compare|vs\.?)\b/.test(g)) return OUTCOME_PLAYBOOKS["research competitors"];
  if (/\bcrm\b/.test(g)) return OUTCOME_PLAYBOOKS["set up crm"];
  if (/\b(deploy|ship|release|host)\b/.test(g)) return OUTCOME_PLAYBOOKS["deploy application"];
  if (/\b(trip|travel|itinerary|tour|vacation|holiday|yatra|ghumne|jana hai|kharcha|budget)\b/.test(g) || /\b(se|to|from)\b.*\b(jana|reach|route|distance)\b/.test(g)) return OUTCOME_PLAYBOOKS["plan a trip"];
  return null;
}

class Swarm {
  constructor({ userDataDir, runHeadless, complete, emit, log = () => {} }) {
    this.file = path.join(userDataDir, "swarm-runs.json");
    this.runHeadless = runHeadless;
    this.complete = complete;
    this.emit = emit;
    this.log = log;
    this.runs = new Map(); // live runs, runId -> run
    this.history = [];
    this.loaded = false;
  }

  async load() {
    try { this.history = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { this.history = []; }
    if (!Array.isArray(this.history)) this.history = [];
    this.loaded = true;
  }

  async _persist(run) {
    const snapshot = this._view(run);
    const idx = this.history.findIndex((r) => r.id === run.id);
    if (idx >= 0) this.history[idx] = snapshot; else this.history.unshift(snapshot);
    if (this.history.length > MAX_RUNS_KEPT) this.history.splice(MAX_RUNS_KEPT);
    await fs.mkdir(path.dirname(this.file), { recursive: true }).catch(() => {});
    await fs.writeFile(this.file, JSON.stringify(this.history, null, 2), "utf8").catch(() => {});
  }

  roles() {
    return Object.fromEntries(Object.entries(ROLES).map(([id, r]) => [id, { id, name: r.name, icon: r.icon, color: r.color }]));
  }

  list() {
    return [...this.runs.values()].map((r) => this._view(r)).concat(this.history.filter((h) => !this.runs.has(h.id)));
  }

  get(runId) {
    const live = this.runs.get(runId);
    return live ? this._view(live) : this.history.find((h) => h.id === runId) || null;
  }

  _view(run) {
    return {
      id: run.id,
      goal: run.goal,
      root: run.root,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt || null,
      plan: run.plan ? { summary: run.plan.summary, tasks: run.plan.tasks.map((t) => ({ id: t.id, role: t.role, title: t.title, dependsOn: t.dependsOn })) } : null,
      tasks: run.tasks.map((t) => ({ id: t.id, role: t.role, roleName: ROLES[t.role]?.name || t.role, icon: ROLES[t.role]?.icon || "🤖", color: ROLES[t.role]?.color, title: t.title, status: t.status, currentTool: t.currentTool || null, toolCount: t.toolCount || 0, steps: t.steps || [], startedAt: t.startedAt || null, endedAt: t.endedAt || null, findings: t.findings || null, error: t.error || null })),
      report: run.report || null,
      error: run.error || null,
    };
  }

  _event(run, type, extra = {}) {
    try { this.emit("swarm:event", { runId: run.id, type, ...extra, run: this._view(run) }); } catch {}
  }

  stop(runId) {
    const run = this.runs.get(runId);
    if (!run) return { ok: false, error: "No live run " + runId };
    run.controller.abort();
    for (const t of run.tasks) if (t.controller) t.controller.abort();
    return { ok: true };
  }

  // Kicks off a run and returns its id at once; progress arrives as swarm:event.
  start({ goal, root, model }) {
    if (!this.loaded) this.load().catch(() => {});
    const run = {
      id: genId("sw"),
      goal: String(goal || "").trim(),
      root,
      model: model || undefined,
      status: "planning",
      startedAt: Date.now(),
      controller: new AbortController(),
      plan: null,
      tasks: [],
      board: [], // { taskId, role, title, findings }
      report: null,
    };
    if (!run.goal) throw new Error("A goal is required");
    this.runs.set(run.id, run);
    this._execute(run).catch((err) => {
      run.status = "failed";
      run.error = err.message;
      run.endedAt = Date.now();
      this._event(run, "error", { message: err.message });
      this._persist(run);
    }).finally(() => {
      setTimeout(() => this.runs.delete(run.id), 60_000);
    });
    return { runId: run.id };
  }

  async _execute(run) {
    this._event(run, "start");

    // 1. Plan
    const plannerTask = { id: "plan", role: "planner", title: "Plan the work", status: "running", startedAt: Date.now(), toolCount: 0 };
    run.tasks.push(plannerTask);
    this._event(run, "task-start", { taskId: plannerTask.id });
    const planText = await this._runRole(run, plannerTask, plannerPrompt(run));
    if (run.controller.signal.aborted) return this._finish(run, "stopped");

    let plan = extractJson(planText);
    if (!plan || !Array.isArray(plan.tasks) || !plan.tasks.length) {
      // The model narrated instead of emitting JSON — one cheap fix-up call, then a fallback.
      const fixed = await this.complete({
        system: "Convert the following plan into strict JSON matching {\"summary\":string,\"tasks\":[{\"id\":string,\"role\":\"developer\"|\"qa\"|\"researcher\"|\"reviewer\"|\"devops\",\"title\":string,\"instructions\":string,\"dependsOn\":string[]}]}. Output JSON only.",
        user: planText || `Goal: ${run.goal}`,
        model: run.model,
      }).catch(() => "");
      plan = extractJson(fixed);
    }
    if (!plan || !Array.isArray(plan.tasks) || !plan.tasks.length) {
      // No usable plan. Fall back to a single agent — a Researcher for a real-world/research goal
      // (a trip, a market question), a Developer for a codebase goal — so a non-code goal is never
      // handed to a Developer that has no way to do it.
      const research = playbookFor(run.goal) === OUTCOME_PLAYBOOKS["plan a trip"] || playbookFor(run.goal) === OUTCOME_PLAYBOOKS["research competitors"] || /\b(trip|travel|itinerary|research|find out|compare|kharcha|budget|price|cost)\b/i.test(run.goal);
      const role = research ? "researcher" : "developer";
      plan = { summary: `Single ${role} pass (the planner produced no usable plan).`, tasks: [{ id: "t1", role, title: run.goal.slice(0, 80), instructions: run.goal, dependsOn: [] }] };
    }
    plan.tasks = plan.tasks.slice(0, MAX_TASKS).map((t, i) => ({
      id: String(t.id || "t" + (i + 1)),
      role: ROLES[t.role] && t.role !== "planner" ? t.role : "developer",
      title: String(t.title || t.instructions || "Task " + (i + 1)).slice(0, 120),
      instructions: String(t.instructions || t.title || ""),
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
    }));
    // Drop dependencies on ids that don't exist, and self-references, so nothing waits forever.
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const t of plan.tasks) t.dependsOn = t.dependsOn.filter((d) => ids.has(d) && d !== t.id);
    run.plan = plan;
    plannerTask.status = "done";
    plannerTask.endedAt = Date.now();
    plannerTask.findings = plan.summary || "";
    for (const t of plan.tasks) run.tasks.push({ ...t, status: "pending", toolCount: 0 });
    run.status = "running";
    this._event(run, "plan");

    // 2. Waves — everything whose dependencies are done runs together, at most one of them
    // holding the (single) browser panel at a time.
    const isDone = (id) => run.tasks.find((t) => t.id === id)?.status === "done";
    while (!run.controller.signal.aborted) {
      const pending = run.tasks.filter((t) => t.status === "pending");
      if (!pending.length) break;
      const ready = pending.filter((t) => t.dependsOn.every(isDone));
      if (!ready.length) {
        // Remaining tasks depend on something that failed — mark and move on.
        for (const t of pending) { t.status = "skipped"; t.error = "A task it depends on did not finish"; }
        break;
      }
      const wave = [];
      let browserTaken = false;
      for (const t of ready) {
        if (wave.length >= MAX_PARALLEL) break;
        const usesBrowser = ROLES[t.role].tools.some((n) => BROWSER_TOOLS.includes(n));
        if (usesBrowser && browserTaken) continue;
        if (usesBrowser) browserTaken = true;
        wave.push(t);
      }
      if (!wave.length) wave.push(ready[0]);
      await Promise.all(wave.map((t) => this._runTask(run, t)));
    }
    if (run.controller.signal.aborted) return this._finish(run, "stopped");

    // 3. Merge
    run.status = "merging";
    this._event(run, "merge-start");
    run.report = await this._merge(run);
    return this._finish(run, "done");
  }

  async _runTask(run, task) {
    task.status = "running";
    task.startedAt = Date.now();
    this._event(run, "task-start", { taskId: task.id });
    const text = await this._runRole(run, task, taskPrompt(run, task));
    task.endedAt = Date.now();
    if (run.controller.signal.aborted) { task.status = "stopped"; return; }
    if (task.error) {
      task.status = "failed";
    } else {
      task.status = "done";
      task.findings = text;
      run.board.push({ taskId: task.id, role: task.role, title: task.title, findings: text });
    }
    this._event(run, "task-done", { taskId: task.id });
  }

  async _runRole(run, task, prompt) {
    const role = ROLES[task.role];
    task.controller = new AbortController();
    const onAbort = () => task.controller.abort();
    run.controller.signal.addEventListener("abort", onAbort, { once: true });
    const result = await this.runHeadless({
      root: run.root,
      model: run.model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      allowedTools: new Set(role.tools),
      readOnly: false,
      maxIterations: task.role === "planner" ? 18 : 40,
      controller: task.controller,
      onEvent: (channel, data) => {
        if (channel === "agent:tool-start") {
          task.currentTool = data.name;
          task.toolCount = (task.toolCount || 0) + 1;
          // Keep a running list of what this agent actually did, one readable line per tool call,
          // so the UI can show the same expandable step trail Claude Code does. Capped so a long
          // task cannot grow the run snapshot without bound.
          if (!task.steps) task.steps = [];
          task.steps.push(stepLabel(data.name, data.args));
          if (task.steps.length > 60) task.steps.splice(0, task.steps.length - 60);
          this._event(run, "task-tool", { taskId: task.id, tool: data.name, args: data.args });
        }
        if (channel === "agent:tool-result") task.currentTool = null;
        if (channel === "agent:model-switched") this._event(run, "task-note", { taskId: task.id, note: `switched model to ${data.to}` });
      },
    });
    run.controller.signal.removeEventListener("abort", onAbort);
    task.controller = null;
    task.currentTool = null;
    if (!result.ok) task.error = result.error || (result.aborted ? "Stopped" : "No output");
    return String(result.text || "").trim();
  }

  async _merge(run) {
    const boardText = run.board.map((b) => `## ${ROLES[b.role]?.name || b.role} — ${b.title}\n${b.findings}`).join("\n\n");
    const failed = run.tasks.filter((t) => t.status === "failed" || t.status === "skipped").map((t) => `- ${ROLES[t.role]?.name}: ${t.title} — ${t.error || t.status}`).join("\n");
    const text = await this.complete({
      model: run.model,
      system: [
        "You are the lead of a team of agents inside Nutaan Code. The team just worked on one goal; below is what each agent reported.",
        "Write the final report for the user in Markdown. Be concrete and honest — only claim what an agent actually reported doing or verifying; if something was not verified, say so.",
        "Sections: `## Outcome` (one paragraph: is the goal achieved, partly, or not), `## What was done` (bullets, each prefixed with the role that did it), `## Verified` (what QA/Reviewer actually checked and the result), `## Files changed` (if any were named), `## Still open` (gaps, risks, the next step). Keep it under 500 words.",
      ].join("\n"),
      user: `GOAL: ${run.goal}\n\nPLAN: ${run.plan?.summary || ""}\n\n${boardText || "(no agent produced findings)"}\n\n${failed ? "TASKS THAT DID NOT FINISH:\n" + failed : ""}`,
    }).catch((e) => `The merge step failed (${e.message}). Raw findings:\n\n${boardText}`);
    return text;
  }

  async _finish(run, status) {
    run.status = status;
    run.endedAt = Date.now();
    this._event(run, status === "done" ? "done" : "stopped");
    await this._persist(run);
    return run;
  }
}

function projectLine(run) {
  return run.root ? `Project root: ${run.root} (all file tools are scoped to it).` : "No project is open — work in the scratch folder given as root.";
}

function plannerPrompt(run) {
  const playbook = playbookFor(run.goal);
  return {
    system: [
      "You are the Planner of Nutaan Swarm, a team of specialised agents: developer (writes code, runs commands), qa (drives the built-in browser to test the real app), researcher (web + sources), reviewer (reads diffs, runs tests and the vulnerability scanner), devops (build, env, deploy, health check).",
      ROLES.planner.brief,
      projectLine(run),
      `Now: ${new Date().toLocaleString()}.`,
      "If the goal is about this codebase, first look at the project (list_dir, read the README/package.json/entry files, search the relevant code) so the plan reflects what is actually there. If the goal is NOT about the code — a trip, a research question, a market study, a report, a real-world plan — do NOT explore the repo at all; plan the work directly. Never force a real-world goal into a codebase.",
      playbook ? `A team shape that usually delivers this kind of outcome:\n${playbook}\nAdapt it to the goal; drop roles that add nothing.` : "",
      `Then reply with ONLY a JSON object, in a \`\`\`json fence, of the form {"summary": "<2-3 sentences: what will be built/changed and how it will be verified>", "tasks": [{"id": "t1", "role": "developer|qa|researcher|reviewer|devops", "title": "<short>", "instructions": "<specific, self-contained instructions naming files, commands, URLs>", "dependsOn": ["t0"]}]}.`,
      `Rules: 2 to ${MAX_TASKS} tasks. Tasks with no dependency between them run in parallel, so split independent work. Verification (qa or reviewer) must depend on the work it verifies. Every task's instructions must be actionable without reading the others. Do not include a planner task.`,
    ].filter(Boolean).join("\n"),
    user: `GOAL: ${run.goal}`,
  };
}

function taskPrompt(run, task) {
  const role = ROLES[task.role];
  const deps = run.board.filter((b) => task.dependsOn.includes(b.taskId));
  const others = run.board.filter((b) => !task.dependsOn.includes(b.taskId));
  const boardBlock = (list, label) => list.length
    ? `${label}:\n` + list.map((b) => `--- ${ROLES[b.role]?.name || b.role}: ${b.title} ---\n${String(b.findings).slice(0, 4000)}`).join("\n\n")
    : "";
  return {
    system: [
      `You are the ${role.name} in Nutaan Swarm, a team of agents working on one goal on the user's computer. ${role.brief}`,
      projectLine(run),
      `Now: ${new Date().toLocaleString()}.`,
      `TEAM GOAL: ${run.goal}`,
      `PLAN: ${run.plan?.summary || ""}`,
      `Your teammates: ${run.plan.tasks.map((t) => `${ROLES[t.role]?.name} → ${t.title}`).join("; ")}. Do only your own task — someone else owns the rest.`,
      "Nobody is watching: never ask a question, never wait for approval, never stop at a plan. Use task_write to keep a checklist if the task has several steps. If you are blocked, try one alternative and then report the block precisely.",
      "When you finish, your final message is your report to the team (under 400 words): `What I did`, `What I found / verified` (with evidence: file paths, command output, URLs, screenshots described), `Files changed` (paths), `Open issues`. Only report what you actually did.",
      boardBlock(deps, "FINDINGS FROM THE TASKS YOU DEPEND ON"),
      boardBlock(others, "OTHER FINDINGS SO FAR (for context)"),
    ].filter(Boolean).join("\n\n"),
    user: `YOUR TASK (${task.id}): ${task.title}\n\n${task.instructions}`,
  };
}

module.exports = { Swarm, ROLES, OUTCOME_PLAYBOOKS, playbookFor };
