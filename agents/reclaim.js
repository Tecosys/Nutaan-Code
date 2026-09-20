// Reclaim — the main-process side of "free up space on this machine".
//
// It owns no filesystem work at all. Scanning and deleting are tens of thousands of synchronous
// stat calls; running them here would freeze the window (and did). They happen on a worker thread
// instead, and this class does the three things that must stay on the main side:
//
//   * remembering the last scan, because a selection is only meaningful against the scan it came
//     from — an id that was not in it cannot be deleted;
//   * checking that selection before anything is handed to the worker;
//   * holding the authorisation. Nothing is deleted unless the user pressed the button in the
//     review sheet: apply() refuses without the token that press produces, so no other code path
//     — the agent included — can reach the deleter.
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { deletable, isDenied, insideAllowed } = require("./reclaim-core");

const WORKER = path.join(__dirname, "reclaim-worker.js");
const AUTH_TTL_MS = 5 * 60_000;

class Reclaim {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.last = null;
    this.busy = false;
    this.auth = null; // { token, paths:Set, at }
  }

  // One job per worker: spawn, stream progress, resolve, exit. A scan that overruns is killed
  // rather than left holding a thread.
  runWorker(op, args, onProgress, timeoutMs) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(WORKER, { workerData: { op, args } });
      } catch (err) {
        return reject(err);
      }
      const timer = setTimeout(() => {
        try { worker.terminate(); } catch {}
        reject(new Error("the disk worker took too long and was stopped"));
      }, timeoutMs || 10 * 60_000);
      const finish = (fn, v) => { clearTimeout(timer); try { worker.terminate(); } catch {} fn(v); };
      worker.on("message", (msg) => {
        if (!msg) return;
        if (msg.type === "progress") { if (onProgress) onProgress(msg.payload); return; }
        if (msg.type === "done") return finish(resolve, msg.result);
        if (msg.type === "error") return finish(reject, new Error(msg.error));
      });
      worker.on("error", (err) => finish(reject, err));
      worker.on("exit", (code) => {
        if (code !== 0) finish(reject, new Error("the disk worker stopped unexpectedly"));
      });
    });
  }

  async scan({ budgetMs, includeApps = true, onProgress } = {}) {
    if (this.busy) throw new Error("a disk job is already running");
    this.busy = true;
    try {
      const result = await this.runWorker(
        "scan",
        { budgetMs, includeApps },
        onProgress,
        Math.max(60_000, (budgetMs || 90_000) * 3)
      );
      this.last = result;
      // A new scan invalidates any authorisation given against the old one.
      this.auth = null;
      return result;
    } finally {
      this.busy = false;
    }
  }

  // Resolve a selection against the last scan. Anything not in it, or not deletable, is refused
  // here and never reaches the worker.
  plan(paths) {
    const known = new Map();
    for (const g of this.last?.groups || []) {
      // The item's own kind wins: a bin entry inside an untyped group is still a bin entry.
      for (const i of g.items) known.set(i.id, { ...i, group: g.id, kind: i.kind || g.kind });
    }
    const items = [];
    const refused = [];
    for (const p of paths || []) {
      const item = known.get(p);
      if (!item) { refused.push({ path: p, reason: "not part of the last scan" }); continue; }
      if (item.kind === "apps" || item.kind === "trash" || item.kind === "system") { items.push(item); continue; }
      if (!deletable(item.path)) { refused.push({ path: p, reason: "outside your own files, or protected" }); continue; }
      items.push(item);
    }
    return { items, refused, bytes: items.reduce((n, i) => n + i.bytes, 0) };
  }

  // The review sheet calls this the moment the user confirms, and passes the token straight back
  // into apply(). It is bound to that exact set of paths and expires, so it cannot be replayed
  // against a different selection later.
  authorize(paths) {
    const { items, refused, bytes } = this.plan(paths);
    if (!items.length) return { ok: false, error: "nothing in that selection can be acted on", refused };
    this.auth = {
      token: "rc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10),
      paths: new Set(items.map((i) => i.id)),
      at: Date.now(),
    };
    return { ok: true, token: this.auth.token, count: items.length, bytes, refused };
  }

  async apply(paths, { onProgress, token } = {}) {
    const list = paths || [];
    const auth = this.auth;
    if (!auth || !token || token !== auth.token) {
      return { error: "not authorised — deletion only runs after you confirm it in the review window", freed: 0, removed: 0, failed: 0, results: [] };
    }
    if (Date.now() - auth.at > AUTH_TTL_MS) {
      this.auth = null;
      return { error: "that confirmation has expired — review the list and confirm again", freed: 0, removed: 0, failed: 0, results: [] };
    }
    const extra = list.filter((p) => !auth.paths.has(p));
    if (extra.length) {
      return { error: `${extra.length} item(s) were not part of what you confirmed`, freed: 0, removed: 0, failed: 0, results: [] };
    }
    if (this.busy) return { error: "a disk job is already running", freed: 0, removed: 0, failed: 0, results: [] };

    const { items, refused } = this.plan(list);
    if (!items.length) return { error: "nothing to remove", freed: 0, removed: 0, failed: 0, results: [], refused };

    this.busy = true;
    try {
      const res = await this.runWorker("apply", { items }, onProgress, 15 * 60_000);
      // Whatever went is no longer part of the scan, and the authorisation is spent.
      const goneSet = new Set((res.results || []).filter((r) => r.removed).map((r) => r.path));
      if (this.last) for (const g of this.last.groups) g.items = g.items.filter((i) => !goneSet.has(i.id));
      this.auth = null;
      return { ...res, refused: [...(res.refused || []), ...refused] };
    } catch (err) {
      return { error: err.message, freed: 0, removed: 0, failed: 0, results: [] };
    } finally {
      this.busy = false;
    }
  }

  // Uninstalling spawns the program's own uninstaller and waits — async, so it never blocks the
  // main thread the way a filesystem walk does.
  async uninstall(id) {
    const item = (this.last?.groups || []).flatMap((g) => (g.kind === "apps" ? g.items : [])).find((i) => i.id === id);
    if (!item) return { ok: false, error: "not in the last scan" };
    const { runUninstall } = require("./reclaim-core");
    return runUninstall(item);
  }
}

module.exports = { Reclaim, deletable, isDenied, insideAllowed };
