// "Today" — what this project actually needs right now, worked out from the project itself
// rather than a canned list. Every card carries the evidence it came from (the git line, the
// TODO count, the failing incident) so nothing on the landing screen is made up.
//
// Two passes: a deterministic one that reads the repo and always produces something, and an
// optional model pass that may add a few more cards — but only citing facts from the signals
// it was given. If the model is unreachable or drifts, the deterministic cards stand alone.
const fs = require("node:fs/promises");
const path = require("node:path");
const { exec } = require("node:child_process");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", "__pycache__", ".venv", "venv", "target", "vendor", ".cache"]);
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cs|php|swift|vue|svelte|html|css|scss|sql|sh)$/i;
const MAX_FILES_SCANNED = 1500;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function run(cmd, cwd, timeout = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || "") });
    });
  });
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

function daysAgo(ts) {
  return Math.floor((Date.now() - ts) / 86_400_000);
}

async function gitSignals(root) {
  const g = { isRepo: false };
  const inside = await run("git rev-parse --is-inside-work-tree", root);
  if (!inside.ok || !/true/.test(inside.out)) return g;
  g.isRepo = true;
  const status = await run("git status --porcelain=v1 -b", root);
  const lines = status.out.split(/\r?\n/).filter(Boolean);
  const head = lines.shift() || "";
  g.branch = (/^## ([^\s.]+)/.exec(head) || [])[1] || "";
  g.ahead = Number((/ahead (\d+)/.exec(head) || [])[1] || 0);
  g.behind = Number((/behind (\d+)/.exec(head) || [])[1] || 0);
  g.noUpstream = !/\.\.\./.test(head);
  g.changed = lines.map((l) => ({ code: l.slice(0, 2).trim(), file: l.slice(3).trim() }));
  g.changedCount = g.changed.length;
  g.untracked = g.changed.filter((c) => c.code === "??").length;
  const last = await run('git log -1 --format=%ct%n%s%n%an', root);
  if (last.ok && last.out.trim()) {
    const [ts, subject, author] = last.out.trim().split("\n");
    g.lastCommit = { at: Number(ts) * 1000, subject: subject || "", author: author || "", daysAgo: daysAgo(Number(ts) * 1000) };
  }
  const stash = await run("git stash list", root);
  g.stashes = stash.ok ? stash.out.split(/\r?\n/).filter(Boolean).length : 0;
  const today = await run('git log --since="midnight" --oneline', root);
  g.commitsToday = today.ok ? today.out.split(/\r?\n/).filter(Boolean).length : 0;
  const week = await run('git log --since="7 days ago" --oneline', root);
  g.commitsThisWeek = week.ok ? week.out.split(/\r?\n/).filter(Boolean).length : 0;
  return g;
}

async function scanTree(root) {
  const res = { files: 0, codeFiles: 0, testFiles: 0, todos: [], largestFiles: [], hasReadme: false, hasCi: false, hasLint: false, hasEnv: false, hasEnvExample: false, hasGitignore: false, envMissingKeys: [] };
  let scanned = 0;
  async function walk(dir, depth) {
    if (scanned > MAX_FILES_SCANNED || depth > 6) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (scanned > MAX_FILES_SCANNED) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) {
          if (e.name === ".github" && depth === 0) res.hasCi = await exists(path.join(dir, e.name, "workflows"));
          continue;
        }
        await walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      scanned++;
      res.files++;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (depth === 0) {
        if (/^readme(\.md|\.txt)?$/i.test(e.name)) res.hasReadme = true;
        if (/^\.(eslintrc|prettierrc)|^(eslint|prettier|biome|ruff|\.flake8|pylintrc)/i.test(e.name)) res.hasLint = true;
        if (e.name === ".env") res.hasEnv = true;
        if (/^\.env\.(example|sample|template)$/.test(e.name)) res.hasEnvExample = true;
        if (e.name === ".gitignore") res.hasGitignore = true;
        if (/^(\.gitlab-ci\.yml|Jenkinsfile|\.travis\.yml|azure-pipelines\.yml)$/.test(e.name)) res.hasCi = true;
      }
      if (!CODE_EXT.test(e.name)) continue;
      res.codeFiles++;
      if (/\.(test|spec)\.|(^|\/)(tests?|__tests__|spec)\//i.test(rel)) res.testFiles++;
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      if (stat.size > 400_000) continue;
      res.largestFiles.push({ file: rel, kb: Math.round(stat.size / 1024) });
      if (res.todos.length < 60) {
        try {
          const text = await fs.readFile(full, "utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length && res.todos.length < 60; i++) {
            // Only real comment markers — the word "todo" in prose or a string is not a task.
            const m = /(?:\/\/|#|\/\*|^\s*\*|<!--|--)\s*(TODO|FIXME|HACK|XXX)\b[:\s-]*(.{0,80})/.exec(lines[i]);
            if (m) res.todos.push({ file: rel, line: i + 1, kind: m[1], text: m[2].trim() });
          }
        } catch {}
      }
    }
  }
  await walk(root, 0);
  res.largestFiles.sort((a, b) => b.kb - a.kb);
  res.largestFiles = res.largestFiles.slice(0, 3);
  if (res.hasEnv && res.hasEnvExample) {
    const keys = async (f) => {
      try { return new Set((await fs.readFile(path.join(root, f), "utf8")).split("\n").map((l) => (/^\s*([A-Z0-9_]+)\s*=/.exec(l) || [])[1]).filter(Boolean)); } catch { return new Set(); }
    };
    const [env, example] = await Promise.all([keys(".env"), keys(".env.example").then(async (s) => s.size ? s : keys(".env.sample"))]);
    res.envMissingKeys = [...example].filter((k) => !env.has(k)).slice(0, 8);
  }
  return res;
}

async function packageSignals(root) {
  const pkg = await readJson(path.join(root, "package.json"));
  const out = { kind: null, scripts: {}, name: null };
  if (pkg) {
    out.kind = "node";
    out.name = pkg.name || null;
    out.scripts = pkg.scripts || {};
    out.depCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
    out.hasTestScript = !!(out.scripts.test && !/no test specified/.test(out.scripts.test));
    out.hasLintScript = !!out.scripts.lint;
    out.hasBuildScript = !!out.scripts.build;
    out.devScript = out.scripts.dev ? "npm run dev" : out.scripts.start ? "npm start" : null;
    const lock = await fs.stat(path.join(root, "package-lock.json")).catch(() => null);
    const pj = await fs.stat(path.join(root, "package.json")).catch(() => null);
    out.lockStale = !!(lock && pj && pj.mtimeMs - lock.mtimeMs > 60_000);
    out.hasNodeModules = await exists(path.join(root, "node_modules"));
  } else if (await exists(path.join(root, "pyproject.toml")) || await exists(path.join(root, "requirements.txt"))) {
    out.kind = "python";
    out.hasTestScript = await exists(path.join(root, "tests")) || await exists(path.join(root, "test"));
  } else if (await exists(path.join(root, "go.mod"))) {
    out.kind = "go";
    out.hasTestScript = true;
  } else if (await exists(path.join(root, "Cargo.toml"))) {
    out.kind = "rust";
    out.hasTestScript = true;
  }
  return out;
}

async function collectSignals(root, extra = {}) {
  const [git, tree, pkg] = await Promise.all([gitSignals(root), scanTree(root), packageSignals(root)]);
  return {
    root,
    name: pkg.name || path.basename(root),
    date: new Date().toISOString().slice(0, 10),
    weekday: new Date().toLocaleDateString(undefined, { weekday: "long" }),
    git,
    tree,
    pkg,
    incidents: extra.incidents || [],
    workers: extra.workers || [],
    updatesToday: extra.updatesToday || [],
    lastChat: extra.lastChat || null,
  };
}

// Deterministic cards — each `why` is a fact from the signals, shown on the card.
function deterministicCards(s) {
  const cards = [];
  const add = (c) => { if (cards.length < 8 && !cards.some((x) => x.id === c.id)) cards.push({ kind: "todo", ...c }); };
  const g = s.git, t = s.tree, p = s.pkg;

  for (const inc of s.incidents.filter((i) => i.status === "detected" || i.status === "needs-human").slice(0, 2)) {
    add({ id: "incident-" + inc.id, kind: "fix", title: "Fix: " + inc.title.slice(0, 60), why: `Detected ${timeAgo(inc.detectedAt)} in ${inc.source}${inc.occurrences > 1 ? ` · seen ${inc.occurrences}×` : ""}`,
      prompt: `Something broke in this project and the workspace monitor caught it: "${inc.title}". Evidence:\n${inc.evidence.slice(0, 1500)}\n\nReproduce it, find the root cause, patch it, run the tests/build, and verify it in the browser if it's a web app.` });
  }

  if (s.lastChat?.openTasks?.length) {
    const first = s.lastChat.openTasks[0];
    add({ id: "resume", kind: "resume", title: "Resume: " + first.slice(0, 60), why: `${s.lastChat.openTasks.length} unfinished item${s.lastChat.openTasks.length === 1 ? "" : "s"} on the last chat's checklist`,
      prompt: `Continue the unfinished work from our last chat in this project. The checklist still had these open:\n${s.lastChat.openTasks.map((x) => "- " + x).join("\n")}\n\nPick up from the first one, check what was already done in the code, and finish them.` });
  }

  if (g.isRepo && g.changedCount > 0) {
    const files = g.changed.slice(0, 4).map((c) => c.file).join(", ");
    const old = g.lastCommit ? ` · last commit ${g.lastCommit.daysAgo === 0 ? "today" : g.lastCommit.daysAgo + "d ago"}` : "";
    add({ id: "uncommitted", kind: "git", title: `Review and commit ${g.changedCount} changed file${g.changedCount === 1 ? "" : "s"}`, why: `${files}${g.changedCount > 4 ? ` +${g.changedCount - 4} more` : ""}${old}`,
      prompt: `There are ${g.changedCount} uncommitted changes in this project (${files}${g.changedCount > 4 ? ", …" : ""}). Review the diff (git diff and git status), check nothing is broken, then write a good commit message and commit them. If some changes clearly don't belong together, split them into separate commits.` });
  }
  if (g.isRepo && g.ahead > 0) {
    add({ id: "push", kind: "git", title: `Push ${g.ahead} commit${g.ahead === 1 ? "" : "s"} to ${g.branch || "the remote"}`, why: `Local branch is ${g.ahead} ahead of its upstream`, prompt: `This branch is ${g.ahead} commits ahead of the remote. Push it, and tell me if the push is rejected.` });
  }
  if (g.isRepo && g.behind > 0) {
    add({ id: "pull", kind: "git", title: `Pull ${g.behind} new commit${g.behind === 1 ? "" : "s"} from the remote`, why: `Branch is ${g.behind} behind upstream`, prompt: `The remote has ${g.behind} commits this branch doesn't. Pull (rebase) them, resolve any conflicts, and summarise what changed upstream.` });
  }
  if (g.isRepo && g.stashes > 0) {
    add({ id: "stash", kind: "git", title: `${g.stashes} stash${g.stashes === 1 ? "" : "es"} waiting`, why: "git stash list is not empty", prompt: `There are ${g.stashes} stashes in this repo. Show me what each contains and whether it's still relevant; apply the ones that are and drop the rest after I confirm.` });
  }

  if (t.todos.length) {
    const top = t.todos[0];
    add({ id: "todos", kind: "code", title: `Clear ${t.todos.length}${t.todos.length >= 60 ? "+" : ""} TODO/FIXME comment${t.todos.length === 1 ? "" : "s"}`, why: `e.g. ${top.file}:${top.line} — ${top.kind} ${top.text.slice(0, 50)}`,
      prompt: `This project has ${t.todos.length} TODO/FIXME/HACK comments. Start with these:\n${t.todos.slice(0, 8).map((x) => `- ${x.file}:${x.line} ${x.kind} ${x.text}`).join("\n")}\n\nFor each: either do it, or explain why it should stay and remove the comment if it's obsolete.` });
  }

  if (p.kind === "node" && !p.hasTestScript) {
    add({ id: "no-tests", kind: "quality", title: "Add a test setup and first tests", why: "package.json has no working test script" + (t.testFiles ? ` (but ${t.testFiles} test-like files exist)` : ""), prompt: `This project has no working test script in package.json${t.testFiles ? `, although ${t.testFiles} test-like files exist` : ""}. Set up a test runner that fits the stack, add tests for the most important module, and wire \`npm test\`.` });
  } else if (t.codeFiles > 20 && t.testFiles === 0) {
    add({ id: "no-tests", kind: "quality", title: "Write the first tests", why: `${t.codeFiles} code files, 0 test files`, prompt: `There are ${t.codeFiles} source files and no tests. Find the riskiest, most central module and write tests for it first.` });
  } else if (p.hasTestScript) {
    add({ id: "run-tests", kind: "quality", title: "Run the test suite", why: `npm test → ${String(p.scripts.test).slice(0, 50)}`, prompt: "Run the test suite and fix anything that fails. Report what was failing and why." });
  }

  if (p.kind === "node" && p.lockStale) add({ id: "lock", kind: "deps", title: "package.json changed after the lockfile", why: "package-lock.json is older than package.json", prompt: "package.json was edited after package-lock.json was last written. Run npm install, check nothing broke, and commit the updated lockfile." });
  if (p.kind === "node" && !p.hasNodeModules) add({ id: "install", kind: "deps", title: "Install dependencies", why: "node_modules is missing", prompt: "node_modules is missing. Run the install for this project's package manager, then start it and confirm it runs." });
  if (t.envMissingKeys.length) add({ id: "env", kind: "config", title: `.env is missing ${t.envMissingKeys.length} key${t.envMissingKeys.length === 1 ? "" : "s"}`, why: t.envMissingKeys.slice(0, 4).join(", "), prompt: `.env is missing these keys that .env.example declares: ${t.envMissingKeys.join(", ")}. Work out what each one is for from the code, and tell me exactly what value each needs.` });
  if (!t.hasReadme && t.codeFiles > 5) add({ id: "readme", kind: "docs", title: "Write a README", why: "No README in the project root", prompt: "This project has no README. Read the code and write one: what it is, how to run it, how it's structured, and how to contribute." });
  if (!t.hasGitignore && g.isRepo) add({ id: "gitignore", kind: "config", title: "Add a .gitignore", why: "Repo has no .gitignore", prompt: "This repo has no .gitignore. Add one that fits the stack and check whether anything that shouldn't be tracked (node_modules, .env, build output) already is." });
  if (!t.hasCi && g.isRepo && p.hasTestScript) add({ id: "ci", kind: "config", title: "Set up CI to run the tests", why: "Tests exist but no CI workflow found", prompt: "There's a test script but no CI. Add a GitHub Actions workflow that installs, lints (if a lint script exists) and runs the tests on every push and PR." });
  if (p.kind === "node" && !p.hasLintScript && !t.hasLint && t.codeFiles > 10) add({ id: "lint", kind: "quality", title: "Add linting", why: "No lint config or lint script", prompt: "Add a linter and formatter that fit this stack, run them, and fix what they find (without changing behaviour)." });

  if (g.isRepo && g.lastCommit && g.lastCommit.daysAgo >= 7 && g.changedCount === 0) add({ id: "stale", kind: "resume", title: "Pick this project back up", why: `Last commit ${g.lastCommit.daysAgo} days ago: "${g.lastCommit.subject.slice(0, 50)}"`, prompt: `The last commit here was ${g.lastCommit.daysAgo} days ago ("${g.lastCommit.subject}"). Read the recent history and the README, tell me where the project stands, and suggest the single most valuable next thing to build.` });
  if (p.devScript && cards.length < 8) add({ id: "run", kind: "run", title: "Run it and check the UI", why: `${p.devScript} is available`, prompt: `Start the app with \`${p.devScript}\` in the background, open it in the browser panel, screenshot it at desktop and mobile sizes, and report anything broken or ugly.` });

  for (const w of s.workers.filter((w) => w.dueToday).slice(0, 2)) add({ id: "worker-" + w.id, kind: "worker", title: `${w.icon} ${w.name} runs at ${w.time}`, why: w.lastHeadline ? `Last: ${w.lastHeadline.slice(0, 60)}` : "Scheduled worker", prompt: `__run_worker__:${w.id}` });

  return cards;
}

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

// Optional model pass: given the signals and the deterministic cards, propose up to 3 more,
// each with a `why` that quotes a fact from the signals. Strict, so it cannot invent.
async function modelCards(complete, signals, existing) {
  const facts = {
    project: signals.name,
    date: signals.date,
    git: signals.git.isRepo ? { branch: signals.git.branch, changedCount: signals.git.changedCount, changedFiles: signals.git.changed.slice(0, 12).map((c) => c.file), ahead: signals.git.ahead, behind: signals.git.behind, lastCommit: signals.git.lastCommit, commitsThisWeek: signals.git.commitsThisWeek } : null,
    stack: signals.pkg.kind,
    scripts: Object.keys(signals.pkg.scripts || {}),
    files: signals.tree.files,
    codeFiles: signals.tree.codeFiles,
    testFiles: signals.tree.testFiles,
    todos: signals.tree.todos.slice(0, 12),
    largestFiles: signals.tree.largestFiles,
    hasReadme: signals.tree.hasReadme,
    hasCi: signals.tree.hasCi,
    openIncidents: signals.incidents.slice(0, 3).map((i) => ({ title: i.title, source: i.source })),
    lastChatOpenTasks: signals.lastChat?.openTasks || [],
    lastChatTitle: signals.lastChat?.title || null,
  };
  const text = await complete({
    system: "You suggest what a developer should do today in their project. You are given FACTS about the project and the suggestions already made. Propose up to 3 ADDITIONAL, different, specific suggestions. Each must be justified by a fact in FACTS — put that fact, quoted or paraphrased with its numbers/filenames, in `why`. If the facts don't support anything new, return an empty list. Never invent files, numbers, or problems. Reply with JSON only: {\"cards\":[{\"title\":\"<max 60 chars, imperative>\",\"why\":\"<the fact>\",\"prompt\":\"<the full instruction to give the coding agent, 1-3 sentences, naming the files/commands>\"}]}",
    user: `FACTS:\n${JSON.stringify(facts, null, 1)}\n\nALREADY SUGGESTED:\n${existing.map((c) => "- " + c.title).join("\n") || "(none)"}`,
    maxTokens: 700,
  });
  const m = /\{[\s\S]*\}/.exec(text || "");
  if (!m) return [];
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(parsed.cards)) return [];
  return parsed.cards
    .filter((c) => c && typeof c.title === "string" && typeof c.prompt === "string" && typeof c.why === "string" && c.why.length > 8)
    .slice(0, 3)
    .map((c, i) => ({ id: "ai-" + i, kind: "idea", title: c.title.slice(0, 70), why: c.why.slice(0, 140), prompt: c.prompt.slice(0, 600), fromModel: true }));
}

class Today {
  constructor({ userDataDir, complete, log = () => {} }) {
    this.file = path.join(userDataDir, "today-cache.json");
    this.complete = complete;
    this.log = log;
    this.cache = null;
  }

  async _cache() {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { this.cache = {}; }
    if (!this.cache || typeof this.cache !== "object") this.cache = {};
    return this.cache;
  }

  async build(root, extra = {}, { force = false, useModel = true } = {}) {
    const signals = await collectSignals(root, extra);
    const cards = deterministicCards(signals);
    const fingerprint = JSON.stringify({ d: signals.date, g: [signals.git.changedCount, signals.git.ahead, signals.git.behind, signals.git.lastCommit?.at], t: [signals.tree.todos.length, signals.tree.testFiles, signals.tree.codeFiles], inc: signals.incidents.length, ids: cards.map((c) => c.id) });
    const cache = await this._cache();
    const key = path.resolve(root);
    const hit = cache[key];
    let extras = [];
    if (!force && hit && hit.fingerprint === fingerprint && Date.now() - hit.at < CACHE_TTL_MS) {
      extras = hit.extras || [];
    } else if (useModel && this.complete) {
      try { extras = await modelCards(this.complete, signals, cards); } catch (e) { this.log("today model pass skipped: " + e.message); }
      cache[key] = { fingerprint, at: Date.now(), extras };
      await fs.mkdir(path.dirname(this.file), { recursive: true }).catch(() => {});
      await fs.writeFile(this.file, JSON.stringify(cache), "utf8").catch(() => {});
    }
    const all = [...cards, ...extras].slice(0, 8);
    return {
      root,
      date: signals.date,
      weekday: signals.weekday,
      name: signals.name,
      headline: headlineFor(signals, all),
      cards: all,
      signals: {
        branch: signals.git.branch || null,
        changed: signals.git.changedCount || 0,
        ahead: signals.git.ahead || 0,
        behind: signals.git.behind || 0,
        lastCommit: signals.git.lastCommit || null,
        commitsThisWeek: signals.git.commitsThisWeek || 0,
        todos: signals.tree.todos.length,
        codeFiles: signals.tree.codeFiles,
        testFiles: signals.tree.testFiles,
        stack: signals.pkg.kind,
        incidents: signals.incidents.length,
      },
    };
  }
}

function headlineFor(s, cards) {
  const g = s.git;
  const bits = [];
  if (g.isRepo) {
    if (g.changedCount) bits.push(`${g.changedCount} uncommitted`);
    if (g.ahead) bits.push(`${g.ahead} to push`);
    if (g.behind) bits.push(`${g.behind} to pull`);
    if (g.lastCommit) bits.push(`last commit ${g.lastCommit.daysAgo === 0 ? "today" : g.lastCommit.daysAgo + "d ago"}`);
  }
  if (s.tree.todos.length) bits.push(`${s.tree.todos.length}${s.tree.todos.length >= 60 ? "+" : ""} TODOs`);
  if (s.incidents.length) bits.push(`${s.incidents.length} open incident${s.incidents.length === 1 ? "" : "s"}`);
  if (!bits.length) return cards.length ? "A clean tree — here's what would move it forward." : "All quiet. Nothing is waiting on you here.";
  return bits.join(" · ");
}

module.exports = { Today, collectSignals, deterministicCards };
