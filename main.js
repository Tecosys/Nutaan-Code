const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { exec, spawn, spawnSync } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const arsenal = require("./arsenal");
const mitmManager = require("./arsenal/mitm");
const gatewayManager = require("./arsenal/gateway");
const { ToolRegistry } = require("./tools/registry");

// Electron derives userData from app.getName(), which is package.json's `name` when run from
// source ("nutaan-code") but `productName` once packaged ("Nutaan Code"). Left alone, the
// installed build and a dev run keep entirely separate projects, chats and API keys, and a user
// upgrading from one to the other silently loses everything. Pin it to one name in both.
const CANONICAL_STORE_DIR = path.join(app.getPath("appData"), "Nutaan Code");
const LEGACY_STORE_DIR = path.join(app.getPath("appData"), "nutaan-code");
app.setPath("userData", CANONICAL_STORE_DIR);

// Windows shows the taskbar icon for whatever "app" it thinks owns the window; without an explicit
// AppUserModelID a dev run is just "electron.exe" and gets Electron's default icon instead of ours.
// Pinning it to the packaged appId makes the taskbar and window use the Nutaan mark in both.
if (process.platform === "win32") { try { app.setAppUserModelId("com.tecosys.nutaancode"); } catch {} }

const STORE_PATH = path.join(CANONICAL_STORE_DIR, "settings.json");
const LEGACY_STORE_PATH = path.join(LEGACY_STORE_DIR, "settings.json");

// One-time adoption of a store left under the old directory name. Whichever file was written
// most recently is the one actually in use, so that one wins; anything it displaces is kept as
// .bak rather than deleted, because this runs before anyone can confirm it guessed right.
(function adoptLegacyStore() {
  const fsSync = require("node:fs");
  try {
    if (!fsSync.existsSync(LEGACY_STORE_PATH)) return;
    const legacy = fsSync.statSync(LEGACY_STORE_PATH);
    if (fsSync.existsSync(STORE_PATH)) {
      if (fsSync.statSync(STORE_PATH).mtimeMs >= legacy.mtimeMs) return;
      fsSync.copyFileSync(STORE_PATH, STORE_PATH + ".bak");
    }
    fsSync.mkdirSync(CANONICAL_STORE_DIR, { recursive: true });
    fsSync.copyFileSync(LEGACY_STORE_PATH, STORE_PATH);
    console.log("[store] adopted settings from the legacy directory");
  } catch (err) {
    console.error("[store] could not adopt legacy settings:", err.message);
  }
})();
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_AGENT_ITERATIONS = 50;
const BROWSER_ACTION_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_TOKENS = 16_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
// The conversation is only part of a request: the tool schemas and the standing system messages
// add several thousand tokens on top of whatever this counts, and every tool round-trip pays it
// again. Compacting at 32k keeps a long session's per-call cost roughly halved.
const COMPACT_THRESHOLD_TOKENS = 32_000;
const KEEP_RECENT_MESSAGES = 10;

// Every model is reached through one endpoint on nutaan.com, authenticated with the user's own
// nutaan.com API key. The model-provider credential lives server-side there and never ships in
// this app. Advanced users can still point Server URL at any OpenAI-compatible endpoint in
// Settings, in which case their own key for that endpoint is used instead.
const NUTAAN_API_BASE = "https://nutaan.com/api";
const NUTAAN_LLM_BASE = `${NUTAAN_API_BASE}/v1`;
const FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b";

// No model-provider credential ships inside this app — that is the entire point of the gateway.
// Requests go to nutaan.com authenticated with the user's own API key, and the provider keys
// live server-side. A user who wants to bring their own endpoint can still set Server URL in
// Settings, in which case their key for that endpoint is used instead.
async function activeBackend({ baseUrl, apiKey, nutaanKey, customProviders, modelProviderId }) {
  // A user-managed provider selected for this specific model wins: route straight to its own
  // OpenAI-compatible endpoint with its own key. This is what lets one account mix Nutaan-managed
  // models with the user's own OpenAI / OpenRouter / Together / NVIDIA / Azure / … keys.
  if (modelProviderId && Array.isArray(customProviders)) {
    const prov = customProviders.find((p) => p && p.id === modelProviderId);
    if (prov && String(prov.baseUrl || "").trim()) {
      return { baseUrl: String(prov.baseUrl).trim(), apiKey: String(prov.apiKey || "").trim() };
    }
  }
  const custom = String(baseUrl || "").trim();
  if (custom) return { baseUrl: custom, apiKey: String(apiKey || "").trim() };
  return { baseUrl: NUTAAN_LLM_BASE, apiKey: String(nutaanKey || "").trim() };
}

let win;
const pendingPermissions = new Map();
const pendingBrowserActions = new Map();
let agentAbort = null;

function resolveSafe(root, relPath) {
  const target = path.resolve(root, relPath || ".");
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    throw new Error(`Path "${relPath}" escapes the project folder`);
  }
  return target;
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: "Nutaan Code",
    // The .ico carries all the Windows sizes, so the taskbar and window get a crisp mark; other
    // platforms use the PNG.
    icon: path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : "logo.png"),
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      // A screen recording minimises this window on purpose, and a throttled renderer would stall
      // the timers and the frame loop the Demo Studio records and exports with.
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Belt-and-suspenders for the taskbar icon: a dev run is electron.exe, and Windows will happily
  // keep showing Electron's own icon there. Setting it again after the window exists, from the
  // native image, forces the taskbar button to adopt the Nutaan mark. (The packaged .exe embeds it,
  // so this matters mainly when running from source.)
  if (process.platform === "win32") {
    try {
      const { nativeImage } = require("electron");
      const ico = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.ico"));
      if (!ico.isEmpty()) win.setIcon(ico);
    } catch {}
  }
  win.webContents.on("console-message", (event) => {
    const levels = ["LOG", "WARN", "ERROR"];
    console.log(`[renderer:${levels[event.level] || event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ---------- Storage cleanup (Nutaan Code cleans up after itself) ----------
// Clears only regenerable junk: the auto-updater's stacked download cache, the app's own HTTP/GPU
// caches, the redundant legacy userData caches, and stale OS temp — NEVER settings, chats, the
// knowledge base, memory, or the browser logins under Partitions.
const CACHE_SUBDIRS = ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "DawnCache", "ShaderCache", "GraphiteDawnCache", "Shared Dictionary", "blob_storage"];

function dirSizeSync(dir) {
  let total = 0;
  try {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      try { total += e.isDirectory() ? dirSizeSync(fp) : fsSync.statSync(fp).size; } catch {}
    }
  } catch {}
  return total;
}
function sizeOf(target) {
  let st;
  try { st = fsSync.lstatSync(target); } catch { return 0; }
  return st.isDirectory() ? dirSizeSync(target) : st.size;
}

// Delete a tree one entry at a time rather than with a recursive rmSync. On a live desktop there
// is always some locked file — held open by this very app, or by another running program — and a
// recursive rm gives up at the first one and takes the whole sweep down with it. Walking the tree
// ourselves means everything that *can* go, goes, and we learn why the rest stayed.
function rmTree(target) {
  let st;
  try { st = fsSync.lstatSync(target); } catch (err) { return err.code === "ENOENT" ? null : err; }
  if (st.isDirectory() && !st.isSymbolicLink()) {
    let firstErr = null;
    try {
      for (const name of fsSync.readdirSync(target)) {
        const err = rmTree(path.join(target, name));
        if (err && !firstErr) firstErr = err;
      }
    } catch (err) { return err; }
    if (firstErr) return firstErr;
    try { fsSync.rmdirSync(target); return null; } catch (err) { return err; }
  }
  try { fsSync.unlinkSync(target); return null; } catch (err) {
    // Windows refuses to unlink a read-only file until the flag comes off.
    try { fsSync.chmodSync(target, 0o666); fsSync.unlinkSync(target); return null; } catch (retryErr) { return retryErr; }
  }
}

// Before touching anything in the shared OS temp folder that isn't ours, rename it out of the way
// first. Windows won't rename a directory another program still has open, so a rename that
// succeeds proves nothing is using it — and one that fails lets us skip the entry completely
// instead of half-deleting some other app's working files.
// A rename only proves the folder itself is free; a program running out of a subfolder renames
// away happily and then loses its files one by one. So walk the tree first and try to open each
// file for writing — Windows refuses that for anything a running process holds open. One locked
// file means the whole entry still belongs to something, and we leave all of it alone rather
// than deleting the unlocked half. (POSIX has no such locking, but there deleting a file out
// from under a running program is harmless anyway.)
const LOCK_PROBE_BUDGET = 5000;
function firstLockedFile(target, budget = { left: LOCK_PROBE_BUDGET }) {
  let st;
  try { st = fsSync.lstatSync(target); } catch { return null; }
  if (st.isSymbolicLink()) return null;
  if (st.isDirectory()) {
    let entries;
    try { entries = fsSync.readdirSync(target); } catch { return target; }
    for (const name of entries) {
      if (--budget.left <= 0) return null; // a huge tree is not worth stalling the whole cleanup over
      const hit = firstLockedFile(path.join(target, name), budget);
      if (hit) return hit;
    }
    return null;
  }
  // A read-only file is not a locked one, and opening it for writing would wrongly say it is.
  if (!(st.mode & 0o200)) return null;
  try { fsSync.closeSync(fsSync.openSync(target, "r+")); return null; }
  catch (err) { return err.code === "EBUSY" || err.code === "EPERM" ? target : null; }
}
function claimForDeletion(target) {
  const claimed = target + ".nutaan-gc";
  try { fsSync.rmSync(claimed, { recursive: true, force: true }); } catch {}
  try { fsSync.renameSync(target, claimed); return { path: claimed, err: null }; }
  catch (err) { return { path: null, err }; }
}

function whyItStayed(err) {
  if (!err) return null;
  if (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES") return "in use by a running program";
  if (err.code === "ENOTEMPTY") return "its owner wrote new files while we were cleaning";
  return err.code ? err.code.toLowerCase() : err.message;
}

function updaterCacheDir() {
  const name = app.getName();
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), name + "-updater");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", name + "-updater");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), name + "-updater");
}

// The app's own HTTP and code caches are open handles inside this very process, so deleting the
// files underneath them just fails. Asking Chromium to drop them is the only thing that actually
// frees that space while the app is running. Caches only — never clearStorageData, which would
// sign the user out of every site in the browser panel.
async function releaseLiveCaches() {
  const { session } = require("electron");
  const sessions = [session.defaultSession];
  try { sessions.push(session.fromPartition("persist:nutaan-browser")); } catch {}
  for (const ses of sessions) {
    try { await ses.clearCache(); } catch {}
    try { await ses.clearCodeCaches({}); } catch {}
  }
}

const mb1 = (n) => Math.round(n * 10) / 10;

async function cleanupStorage({ dryRun = false, includeTemp = true } = {}) {
  const appCaches = [];
  for (const base of [CANONICAL_STORE_DIR, LEGACY_STORE_DIR]) {
    for (const c of CACHE_SUBDIRS) appCaches.push({ label: "Cache: " + path.basename(base) + "/" + c, dir: path.join(base, c) });
  }
  // Sizes read before Chromium drops its caches, so what it releases still counts as freed —
  // measure after and the folder is already empty and the saving belongs to nobody.
  const sizeBefore = new Map();
  if (!dryRun) {
    for (const c of appCaches) sizeBefore.set(c.dir, sizeOf(c.dir));
    try { await releaseLiveCaches(); } catch {}
  }
  const items = [];

  // Every number here is measured, never assumed. A delete can half-succeed or fail outright, so
  // the size read going in says nothing about what was freed — only the size left behind does.
  const sweep = (label, target, { probeFirst = false } = {}) => {
    const preMeasured = sizeBefore.get(target);
    if (!target || (preMeasured == null && !fsSync.existsSync(target))) return;
    const beforeMB = (preMeasured != null ? preMeasured : sizeOf(target)) / 1048576;
    if (beforeMB < 0.05) return;
    const item = { label, path: target, mb: mb1(beforeMB), freedMB: 0, removed: false };
    items.push(item);
    if (dryRun) return;
    let victim = target;
    if (probeFirst) {
      const locked = firstLockedFile(target);
      if (locked) {
        item.error = "in use by a running program";
        item.leftMB = item.mb;
        return;
      }
      const claim = claimForDeletion(target);
      if (!claim.path) { item.error = whyItStayed(claim.err); item.leftMB = item.mb; return; }
      victim = claim.path;
    }
    const err = rmTree(victim);
    const afterMB = sizeOf(victim) / 1048576;
    item.freedMB = mb1(Math.max(0, beforeMB - afterMB));
    item.removed = !err && !fsSync.existsSync(victim);
    if (err) {
      item.error = whyItStayed(err);
      item.leftMB = mb1(afterMB);
      // Put a claimed-but-undeletable entry back under its real name so we leave no litter.
      if (victim !== target && fsSync.existsSync(victim)) { try { fsSync.renameSync(victim, target); } catch {} }
    }
  };

  sweep("Update download cache", updaterCacheDir());
  for (const c of appCaches) sweep(c.label, c.dir);
  if (includeTemp) {
    const tmp = os.tmpdir();
    const cutoff = Date.now() - 7 * 86400000;
    let entries = [];
    try { entries = fsSync.readdirSync(tmp, { withFileTypes: true }); } catch {}
    for (const e of entries) {
      if (e.name.endsWith(".nutaan-gc")) continue;
      const fp = path.join(tmp, e.name);
      let st;
      try { st = fsSync.statSync(fp); } catch { continue; }
      const ours = /nutaan|electron/i.test(e.name);
      if (!ours && st.mtimeMs >= cutoff) continue;
      sweep("Temp: " + e.name, fp, { probeFirst: !ours });
    }
  }

  const scannedMB = mb1(items.reduce((s, i) => s + i.mb, 0));
  const freedMB = dryRun ? 0 : mb1(items.reduce((s, i) => s + (i.freedMB || 0), 0));
  const blocked = items.filter((i) => i.error);
  const blockedMB = mb1(blocked.reduce((s, i) => s + (i.leftMB || 0), 0));
  const reasons = [...new Set(blocked.map((i) => i.error))].join("; ");
  const summary = dryRun
    ? `Up to ${scannedMB} MB across ${items.length} location(s) looks reclaimable. Some of it may be locked by running programs, so the real figure is only known after actually cleaning — do not promise this number.`
    : `Freed ${freedMB} MB.` +
      (blocked.length
        ? ` ${blockedMB} MB in ${blocked.length} location(s) could NOT be removed (${reasons}) and is still on disk — report that plainly and never count it as freed.`
        : "");
  return {
    dryRun,
    freedMB,
    scannedMB,
    count: items.length,
    blockedCount: blocked.length,
    blockedMB,
    summary,
    items: items.sort((a, b) => (b.freedMB || b.mb) - (a.freedMB || a.mb)).slice(0, 40),
  };
}

// On startup, prune stale update downloads so the updater cache can't quietly grow to gigabytes
// (a truly-pending update just downloaded is recent and kept).
function pruneUpdaterCacheOnStartup() {
  const dir = updaterCacheDir();
  try {
    const cutoff = Date.now() - 2 * 86400000;
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      try { if (fsSync.statSync(fp).mtimeMs < cutoff) rmTree(fp); } catch {}
    }
  } catch {}
}


// ---------- Configured tools (MCP servers, other agents, signed-in web tools) ----------
// Whatever the user switched on in Tools becomes callable by the agent. The registry owns the
// connections and the naming; everything below is the wiring into this process.

let toolsSender = null; // the renderer running the current turn, for session-tool actions
const pendingSessionActions = new Map();
let sessionActionSeq = 0;
const SESSION_ACTION_TIMEOUT_MS = 60_000;

function requestSessionAction(payload) {
  const sender = toolsSender;
  if (!sender) return Promise.resolve({ ok: false, error: "The app window is not ready to open a tool yet." });
  const id = "sess" + ++sessionActionSeq;
  return new Promise((resolve) => {
    pendingSessionActions.set(id, resolve);
    sender.send("agent:tool-session-action", { id, ...payload });
    setTimeout(() => {
      if (pendingSessionActions.has(id)) {
        pendingSessionActions.delete(id);
        resolve({ ok: false, error: `${payload.name} did not respond in time.` });
      }
    }, SESSION_ACTION_TIMEOUT_MS);
  });
}

ipcMain.on("agent:tool-session-response", (_e, { id, result }) => {
  const resolve = pendingSessionActions.get(id);
  if (resolve) {
    resolve(result);
    pendingSessionActions.delete(id);
  }
});

// Settings are read from disk on demand rather than cached: the user can change a tool in the
// same breath as using it, and a stale copy here would silently ignore that.
let settingsCache = {};
async function refreshSettingsCache() {
  settingsCache = await readStore();
  return settingsCache;
}

const toolRegistry = new ToolRegistry({
  getSettings: () => settingsCache,
  saveSettings: async (next) => {
    settingsCache = next;
    await writeStore(next);
  },
  openBrowser: async (url) => shell.openExternal(url),
  runSessionAction: (payload) => requestSessionAction(payload),
  onStatusChange: () => {
    try { win?.webContents.send("tools:status", toolRegistry.status()); } catch {}
  },
});

ipcMain.handle("tools:status", async () => {
  await refreshSettingsCache();
  return toolRegistry.status();
});

ipcMain.handle("tools:set-enabled", async (_e, id, enabled) => {
  const store = await refreshSettingsCache();
  const custom = (store.customTools || []).find((c) => c.id === id);
  if (custom) {
    custom.enabled = Boolean(enabled);
    await writeStore(store);
  } else {
    const tools = { ...(store.tools || {}) };
    tools[id] = { ...(tools[id] || {}), enabled: Boolean(enabled) };
    await writeStore({ ...store, tools });
  }
  await refreshSettingsCache();
  if (enabled) await toolRegistry.connect(id).catch(() => {});
  else await toolRegistry.disconnect(id);
  return toolRegistry.status();
});

ipcMain.handle("tools:save-config", async (_e, id, config) => {
  const store = await refreshSettingsCache();
  const idx = (store.customTools || []).findIndex((c) => c.id === id);
  if (idx >= 0) {
    store.customTools[idx] = { ...store.customTools[idx], ...config, id };
    await writeStore(store);
  } else {
    const tools = { ...(store.tools || {}) };
    tools[id] = { ...(tools[id] || {}), config: { ...(tools[id]?.config || {}), ...config } };
    await writeStore({ ...store, tools });
  }
  await refreshSettingsCache();
  // Reconnect so a changed URL, command or key takes effect straight away instead of at restart.
  const entry = toolRegistry.entry(id);
  if (entry?.enabled && entry.def.kind === "mcp") await toolRegistry.connect(id).catch(() => {});
  return toolRegistry.status();
});

ipcMain.handle("tools:connect", async (_e, id) => {
  await refreshSettingsCache();
  return toolRegistry.connect(id);
});

ipcMain.handle("tools:authorize", async (_e, id) => {
  await refreshSettingsCache();
  try {
    await toolRegistry.authorize(id);
    return { ok: true, status: toolRegistry.status() };
  } catch (err) {
    return { ok: false, error: err.message, status: toolRegistry.status() };
  }
});

ipcMain.handle("tools:sign-out", async (_e, id) => {
  await refreshSettingsCache();
  await toolRegistry.signOut(id);
  return toolRegistry.status();
});

ipcMain.handle("tools:add-custom", async (_e, spec) => {
  const store = await refreshSettingsCache();
  const id = "custom-" + Date.now().toString(36);
  const customTools = [...(store.customTools || []), { ...spec, id, enabled: true }];
  await writeStore({ ...store, customTools });
  await refreshSettingsCache();
  await toolRegistry.connect(id).catch(() => {});
  return toolRegistry.status();
});

ipcMain.handle("tools:remove-custom", async (_e, id) => {
  const store = await refreshSettingsCache();
  await toolRegistry.disconnect(id);
  await writeStore({ ...store, customTools: (store.customTools || []).filter((c) => c.id !== id) });
  await refreshSettingsCache();
  return toolRegistry.status();
});

// Catalogue metadata the Tools panel renders — icons live on disk next to the app. `custom` is
// the form for adding an MCP server that is not in the catalogue.
ipcMain.handle("tools:catalog", () => {
  const { CATALOG, CUSTOM_TEMPLATE } = require("./tools/catalog");
  return {
    tools: CATALOG.map((t) => ({
      id: t.id, name: t.name, kind: t.kind, blurb: t.blurb, icon: t.icon, accent: t.accent,
      docs: t.docs || null, noApi: t.noApi || null, oauthNote: t.oauthNote || null,
      fields: t.fields || [], oauthFields: t.oauthFields || [], needsOAuth: t.auth === "oauth",
    })),
    custom: { name: CUSTOM_TEMPLATE.name, blurb: CUSTOM_TEMPLATE.blurb, icon: CUSTOM_TEMPLATE.icon, accent: CUSTOM_TEMPLATE.accent, fields: CUSTOM_TEMPLATE.fields },
  };
});
ipcMain.handle("storage:cleanup", (_e, opts) => cleanupStorage(opts || {}));

// Per-turn guidance for connected tools whose good use is a workflow, not a single call. Only the
// guidance for tools that are actually connected is sent, so it costs nothing when they are off.
function toolGuidance() {
  const parts = [];
  const nutaan = toolRegistry.status("nutaan");
  if (nutaan?.connected) {
    parts.push(
      "When you call nutaan_list_agents, the app already renders the agents as interactive cards " +
      "with a Use Agent button. So do NOT repeat the agents as a text list or table in your reply — " +
      "that duplicates the cards and buries them. Keep your reply to one short line (e.g. \"Here are " +
      "your real-estate agents — tap Use Agent on any card\") plus any genuinely new note. Placing a " +
      "call needs an agent whose caller number is actually rented on the account; if a call fails " +
      "with a caller-ID error, say plainly that the number must be rented/assigned in the Nutaan " +
      "dashboard — it is an account action, not something a retry fixes."
    );
  }
  const canva = toolRegistry.status("canva");
  if (canva?.connected) {
    parts.push(
      "The user's Canva account is connected. ANY request to make a carousel, a document, a " +
      "presentation, a poster, a social post — anything designable — goes through the Canva MCP " +
      "tools, directly. Do NOT open canva.com in the browser, do NOT drive the Canva website by " +
      "clicking, and do NOT use web tools to build the design: the MCP tools do it natively and far " +
      "better. The browser is only for reading a page the user linked, never for making the design.\n" +
      "Make ONE finished, stunning design and see it through — never stop at generate-design " +
      "candidates, and never hand back a list of blank candidate links. Real headline and body copy " +
      "on every page, a fitting image on each (upload-asset-from-url), a coherent look end to end.\n" +
      "\n" +
      "For a multi-page design — a carousel, a presentation, a multi-slide doc — do NOT use a brand " +
      "template unless the user named one. Brand-template IDs cannot be guessed: inventing one is " +
      "what fails with \"template not found\". Instead:\n" +
      "1. generate-design with a design_type that is inherently multi-page (e.g. \"presentation\", or " +
      "an Instagram/social carousel type) and a length that gives the number of slides you want. This " +
      "returns candidates with a job_id.\n" +
      "2. create-design-from-candidate (job_id + the candidate_id you pick) to get a real design_id.\n" +
      "3. start-editing-transaction on that design_id, then perform-editing-operations to fill EVERY " +
      "page with real content — headings, body text, and images (upload-asset-from-url first for an " +
      "image, then place it). perform-editing-operations takes a pages array, so set each slide's " +
      "content. Then commit-editing-transaction.\n" +
      "4. Give the design's Canva link, and offer export-design (PDF/PNG/MP4) to download it.\n" +
      "\n" +
      "Only if the user explicitly wants a brand template: call search-brand-templates FIRST and use a " +
      "real template ID from its results — never a made-up one.\n" +
      "Canva has no video-timeline or audio tools: do not promise clip editing or attaching audio — say " +
      "so plainly if asked."
    );
  }
  return parts.length ? parts.join("\n\n") : null;
}

app.whenReady().then(async () => {
  try {
    await gatewayManager.start({ port: 20128 });
  } catch (err) {
    console.warn("[omniroute] auto-start:", err.message);
  }
  createWindow();
  setTimeout(() => { try { pruneUpdaterCacheOnStartup(); } catch {} }, 4000);
  // Connect the user's tools in the background so they are ready by the time they are asked for.
  refreshSettingsCache().then(() => toolRegistry.sync()).catch(() => {});
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  setupAutoUpdate();
});

app.on("will-quit", () => {
  try { gatewayManager.stop(); } catch {}
  try { mitmManager.stop(); } catch {}
});

function setupAutoUpdate() {
  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    win?.webContents.send("app:update-status", { status: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    win?.webContents.send("app:update-status", { status: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    win?.webContents.send("app:update-status", { status: "not-available" });
  });
  autoUpdater.on("update-downloaded", (info) => {
    win?.webContents.send("app:update-status", { status: "downloaded", version: info.version });
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "Update ready",
        message: `Nutaan Code ${info.version} has been downloaded.`,
        detail: "Restart now to install it, or it'll install next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });
  autoUpdater.on("error", (err) => {
    console.log("[auto-update] error:", err.message);
    win?.webContents.send("app:update-status", { status: "error", message: err.message });
  });

  if (!app.isPackaged) return; // auto-checks only meaningful for installed builds, not `npm start`

  autoUpdater.checkForUpdates().catch((err) => console.log("[auto-update] check failed:", err.message));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000); // re-check every 4h for a long-running session
}

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:check-for-updates", async () => {
  if (!app.isPackaged) {
    return { ok: false, message: "Updates only run in the installed app, not in dev mode." };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    // electron-updater's error message can embed the raw HTTP response (headers, cookies, body) of a
    // failed feed request — never surface that verbatim in the UI. Keep just the first line/sentence.
    const short = String(err.message || "Update check failed").split("\n")[0].slice(0, 160);
    return { ok: false, message: short };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("store:get", async () => readStore());
ipcMain.handle("store:set", async (_e, data) => {
  await writeStore(data);
  return true;
});

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:open-external", async (_e, url) => {
  if (/^https?:\/\//.test(url)) await shell.openExternal(url);
});

ipcMain.handle("dialog:pick-file", async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [
      { name: "Images and text", extensions: ["png", "jpg", "jpeg", "gif", "webp", "txt", "md", "json", "csv", "log", "js", "ts", "py", "html", "css", "yml", "yaml"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const MAX_ATTACHMENT_CHARS = 24_000;

// Turns a file the user attached into something the *current* model can actually consume:
// text inline, an image as image_url when the model has eyes, and otherwise a description
// produced by a vision model. Attachments can live anywhere on disk, so unlike the agent's own
// file tools this is deliberately not scoped to the project root.
ipcMain.handle("attach:prepare", async (_e, payload) => {
  const filePath = String(payload?.filePath || "");
  const name = path.basename(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  try {
    const mime = IMAGE_MIME[ext];
    if (!mime) {
      const text = await fs.readFile(filePath, "utf8");
      return { ok: true, name, kind: "text", text: text.slice(0, MAX_ATTACHMENT_CHARS) };
    }
    const buffer = await fs.readFile(filePath);
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    if (canSeeImages(payload?.model)) return { ok: true, name, kind: "image", dataUrl };

    const backend = await activeBackend(payload || {});
    const described = await describeImage(backend.baseUrl, backend.apiKey, dataUrl, `This is an image file named ${name} that the user attached.`);
    if (!described) return { ok: false, error: "Couldn't read that image: no vision model was reachable." };
    return { ok: true, name, kind: "described-image", text: described.text, viewedBy: described.model };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Every install must be tied to a real nutaan.com account before it can be used. The key is
// checked against nutaan.com itself rather than pattern-matched locally, so a revoked or
// deactivated key stops working.
ipcMain.handle("nutaan:validate-key", async (_e, key) => {
  const trimmed = String(key || "").trim();
  if (!trimmed) return { ok: false, error: "Enter your nutaan.com API key to continue." };
  try {
    const res = await fetch(`${NUTAAN_API_BASE}/auth/me/verification`, {
      headers: { "X-API-Key": trimmed },
    });
    if (res.status === 401) {
      return { ok: false, error: "nutaan.com didn't recognize that key. Check it was pasted in full, or generate a new one in your nutaan.com settings." };
    }
    if (!res.ok) return { ok: false, error: `nutaan.com returned HTTP ${res.status}. Try again in a moment.` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, email: data.email || "" };
  } catch (err) {
    const causeCode = err.cause?.code;
    return { ok: false, error: `Couldn't reach nutaan.com${causeCode ? ` (${causeCode})` : ""}. Check your internet connection.` };
  }
});

// A model is image-only if the server tags it that way, or its output is image but not text —
// covers both this gateway's explicit `type: "image"` and any future/other shape using modalities.
function isImageOnlyModel(m) {
  if (m.type === "image") return true;
  if (Array.isArray(m.output_modalities) && m.output_modalities.includes("image") && !m.output_modalities.includes("text")) return true;
  return false;
}

const AZURE_API_VERSION = "2024-08-01-preview";

function isAzureEndpoint(baseUrl) {
  return /\.openai\.azure\.com/i.test(baseUrl || "");
}

// Azure OpenAI diverges from the plain OpenAI-compatible shape everything else here assumes:
// api-key header instead of Authorization: Bearer, a required api-version query param, and the
// deployment name baked into the URL path instead of picked via a model id.
function buildAuthHeaders(baseUrl, apiKey) {
  if (!apiKey) return {};
  return isAzureEndpoint(baseUrl) ? { "api-key": apiKey } : { Authorization: `Bearer ${apiKey}` };
}

function buildEndpointUrl(baseUrl, endpointPath) {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (isAzureEndpoint(baseUrl)) {
    const sep = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${endpointPath}${sep}api-version=${AZURE_API_VERSION}`;
  }
  return `${trimmed}${endpointPath}`;
}

function azureDeploymentName(baseUrl) {
  const m = baseUrl.match(/\/deployments\/([^/?]+)/i);
  return m ? decodeURIComponent(m[1]) : "azure-deployment";
}

async function fetchCatalog(baseUrl, apiKey) {
  if (isAzureEndpoint(baseUrl)) {
    // Azure's deployment-scoped endpoints don't expose a matching /models list — the "model" is
    // just whichever deployment the URL points at.
    const id = azureDeploymentName(baseUrl);
    return { models: [{ id }], defaultModel: id };
  }
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/models", {
    headers: buildAuthHeaders(baseUrl, apiKey),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || detail;
    } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  return {
    models: Array.isArray(data.data) ? data.data : [],
    // The Nutaan gateway names the model it wants clients to start on; other endpoints don't.
    defaultModel: data.default_model || "",
  };
}

async function fetchModels(baseUrl, apiKey) {
  return (await fetchCatalog(baseUrl, apiKey)).models;
}

// Embedding / reranking / document-parsing models share the same catalog but have no
// /chat/completions route, so offering them in the model picker only produces confusing errors.
const NON_CHAT_MODEL_RE = /embed|rerank|nemoretriever|nemotron-parse|reward|content-safety|safety-guard/i;

// Never infer that an unpriced model is free. Gateways such as OmniRoute/OpenRouter commonly
// expose a price object or an explicit free flag; accepting only those signals prevents a user
// who selected "free only" from accidentally sending work to a billable model.
function isExplicitlyFreeModel(model) {
  if (model?.free === true || model?.is_free === true || model?.tier === "free") return true;
  if (/:free$/i.test(String(model?.id || ""))) return true;
  const price = model?.pricing || model?.price || {};
  const values = [price.prompt, price.completion, price.input, price.output, price.request, price.image]
    .filter((value) => value !== undefined && value !== null);
  return values.length > 0 && values.every((value) => Number(value) === 0);
}

// The agent loop is useless without OpenAI-style tool calling, and the provider catalog lists
// far more models than actually support it — picking one of those produced a "Function <id>:
// Not supported" failure on every turn. This is the set that was probed and confirmed working,
// ordered strongest first so an automatic switch trades down rather than sideways.
// Ordered by how these actually behaved driving a real multi-turn agent loop over a real
// codebase, not by parameter count or vendor claims:
//   azure/model-router (gpt-5.6)  issued three tools in parallel and converged by turn 4
//   gemini flash                  fast first token, tool calling AND image input
//   nemotron-3-super              emits tool calls but never converged — 14 turns, no answer,
//                                 one tool per turn, and malformed arguments on turn 5
//   nemotron-3-ultra              39s to first token; correct, but unusable as a default
//   mistral-nemotron              answered in 2.7s at a small budget, then produced nothing in
//                                 167s at the real one — too inconsistent to rank highly
// ising-calibration is gone entirely: it answers in prose and never calls a tool, so it cannot
// drive the loop at all. It stays in VISION_MODELS, which needs no tool calling.
// Removed after testing rather than demoted — a model that cannot answer is worse than one that
// is merely absent, because picking it looks like the app is broken:
//   mistralai/mistral-nemotron      streamed nothing at all in 120s, twice
//   google/gemma-4-31b-it           timed out past 240s at every budget tried
//   nvidia/ising-calibration        replies in prose and never calls a tool
//   nvidia/nemotron-3-ultra-550b    39s to first token and frequent 503s
const AGENT_MODELS = [
  "azure/model-router",
  "gemini/gemini-3.7-flash",
  "azure/gpt-5-mini",
  "azure/Kimi-K2.6",
  "gemini/gemini-3.6-flash",
  "gemini/gemini-flash-latest",
  "azure/gpt-4.1-mini",
  "gemini/gemini-3.5-flash",
  "gemini/gemini-3.5-flash-lite",
  "nvidia/nemotron-3-super-120b-a12b",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "meta/llama-3.2-11b-vision-instruct",
  "google/diffusiongemma-26b-a4b-it",
  "poolside/laguna-xs-2.1",
];
const agentRank = (id) => {
  const i = AGENT_MODELS.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

// Probed with a real image rather than inferred from the model id: most models reject
// image_url content outright, and two of the three that accept it ("gemma-4-31b-it",
// "ising-calibration-1.5-31b") have nothing in their name to suggest they can see.
// Tried in order until one answers, so the fast and reliable ones come first. gemma-4-31b-it
// can read an image but timed out past 240s on repeated probes, so it sits last — reaching it
// at all means everything above it was unavailable.
const VISION_MODELS = [
  "gemini/gemini-3.7-flash",
  "gemini/gemini-3.6-flash",
  "gemini/gemini-flash-latest",
  "gemini/gemini-3.5-flash",
  "gemini/gemini-3.5-flash-lite",
  "meta/llama-3.2-11b-vision-instruct",
  // Reads images fine and answers in ~0.4s; it only failed the *agent* test, which needs tool
  // calling. Describing a picture does not.
  "nvidia/ising-calibration-1.5-31b",
];
const canSeeImages = (model) => VISION_MODELS.includes(model);

// Only the backends this app ships against are known to match AGENT_MODELS. A user-supplied
// endpoint gets its catalog listed as-is.
function isKnownBackend(baseUrl) {
  const u = String(baseUrl || "").replace(/\/$/, "");
  return u === NUTAAN_LLM_BASE;
}

ipcMain.handle("ai:list-models", async (_e, payload) => {
  const backend = await activeBackend(payload || {});
  try {
    const catalog = await fetchCatalog(backend.baseUrl, backend.apiKey);
    let models = catalog.models
      .filter((m) => isExplicitlyFreeModel(m) && !isImageOnlyModel(m) && !NON_CHAT_MODEL_RE.test(m.id))
      .map((m) => m.id);
    // Keep the picker truthful: every non-image chat model advertised by the selected backend
    // is shown. The live test marks which ones respond; the agent retry/fallback path still
    // handles models that later reject a tool call or are temporarily rate-limited.
    const imageModels = catalog.models.filter((m) => isExplicitlyFreeModel(m) && isImageOnlyModel(m)).map((m) => m.id);
    const defaultModel = catalog.defaultModel && models.includes(catalog.defaultModel)
      ? catalog.defaultModel
      : models.includes(FALLBACK_MODEL) ? FALLBACK_MODEL : models[0] || "";
    return { ok: true, models, imageModels, defaultModel };
  } catch (err) {
    // err.cause often carries the real reason for a network-level failure (DNS, proxy, TLS) that
    // err.message alone doesn't show — e.g. a corporate network blocking the server outright.
    const causeCode = err.cause?.code;
    return { ok: false, error: causeCode ? `${err.message} (${causeCode})` : err.message };
  }
});

// A deliberately tiny non-streaming completion verifies the route, credential, and model id.
// It is opt-in from Settings because even a one-token request can count against a provider quota.
ipcMain.handle("ai:test-models", async (_e, payload) => {
  const backend = await activeBackend(payload || {});
  const models = [...new Set((payload?.models || []).map(String).filter(Boolean))].slice(0, 500);
  if (!models.length) return { ok: true, results: [] };
  const testOne = async (model) => {
    try {
      const res = await fetch(buildEndpointUrl(backend.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders(backend.baseUrl, backend.apiKey) },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 2, temperature: 0, stream: false }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { model, ok: false, error: String(data?.error?.message || `HTTP ${res.status}`).slice(0, 160) };
      }
      return { model, ok: true };
    } catch (err) {
      return { model, ok: false, error: String(err.message || "Request failed").slice(0, 160) };
    }
  };
  // Three at a time makes a large catalog practical without creating a rate-limit burst.
  const results = [];
  for (let i = 0; i < models.length; i += 3) results.push(...await Promise.all(models.slice(i, i + 3).map(testOne)));
  return { ok: true, results };
});

ipcMain.handle("fs:list-dir", async (_e, root, relPath) => {
  const target = resolveSafe(root, relPath);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
});

ipcMain.handle("fs:read-file", async (_e, root, relPath) => {
  const target = resolveSafe(root, relPath);
  const stat = await fs.stat(target);
  if (stat.size > 1_000_000) throw new Error("File is too large to read (>1MB)");
  return fs.readFile(target, "utf8");
});

ipcMain.handle("fs:write-file", async (_e, root, relPath, content) => {
  const target = resolveSafe(root, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return true;
});

ipcMain.handle("fs:edit-file", async (_e, root, relPath, oldString, newString) => {
  const target = resolveSafe(root, relPath);
  const content = await fs.readFile(target, "utf8");
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) throw new Error("old_string not found in file");
  if (occurrences > 1) throw new Error(`old_string is not unique (${occurrences} matches) — include more context`);
  const updated = content.replace(oldString, newString);
  await fs.writeFile(target, updated, "utf8");
  return true;
});

// ---------- OSINT Arsenal (753+ tools & native recon) ----------

ipcMain.handle("arsenal:search", async (_e, options) => {
  return arsenal.searchTools(options);
});

ipcMain.handle("arsenal:get-categories", async () => {
  return arsenal.getCategories();
});

ipcMain.handle("arsenal:get-tool", async (_e, id) => {
  return arsenal.getToolById(id);
});

ipcMain.handle("arsenal:quick-recon", async (_e, target, type = "all") => {
  const out = { target };
  if (type === "all" || type === "dns") {
    try {
      out.dns = await arsenal.dnsRecon(target);
    } catch (e) {
      out.dnsError = e.message;
    }
  }
  if (type === "all" || type === "ip") {
    try {
      out.ip = await arsenal.ipLookup(target);
    } catch (e) {
      out.ipError = e.message;
    }
  }
  if (type === "all" || type === "subdomains") {
    try {
      out.subdomains = await arsenal.subdomainEnum(target);
    } catch (e) {
      out.subdomainError = e.message;
    }
  }
  if (type === "all" || type === "http") {
    try {
      out.http = await arsenal.httpRecon(target);
    } catch (e) {
      out.httpError = e.message;
    }
  }
  if (type === "all" || type === "dorks") {
    out.dorks = arsenal.generateDorks(target);
  }
  return out;
});

// ---------- Skills (Claude-Skills-style SKILL.md packs) ----------

const APP_SKILLS_DIR = path.join(__dirname, "skills");

function parseSkillFile(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { name: null, description: null, body: raw.trim() };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { name: meta.name || null, description: meta.description || null, body: match[2].trim() };
}

async function listSkillsIn(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(dir, entry.name, "SKILL.md");
    try {
      const raw = await fs.readFile(skillFile, "utf8");
      const { name, description } = parseSkillFile(raw);
      out.push({ id: entry.name, name: name || entry.name, description: description || "" });
    } catch {
      // no SKILL.md in this folder, skip
    }
  }
  return out;
}

function skillSearchDirs(root) {
  return [
    APP_SKILLS_DIR,
    path.join(os.homedir(), ".claude", "skills"), // Claude Code, if installed on this machine
    path.join(root, ".claude", "skills"), // Claude Code, project-level
    path.join(root, ".nutaan", "skills"), // Nutaan Code project-level (highest priority)
  ];
}

async function collectSkills(root) {
  const byId = new Map();
  for (const dir of skillSearchDirs(root)) {
    for (const s of await listSkillsIn(dir)) byId.set(s.id, s); // later dirs override earlier ones with the same id
  }
  return [...byId.values()];
}

async function readSkillBody(root, id) {
  for (const dir of skillSearchDirs(root).reverse()) {
    try {
      const raw = await fs.readFile(path.join(dir, id, "SKILL.md"), "utf8");
      return parseSkillFile(raw).body;
    } catch {
      // try next
    }
  }
  throw new Error(`No skill found with id "${id}"`);
}

// ---------- Memory (long-term, shared across every project) ----------
// Lives outside any project root at ~/.nutaan/memory/ — that's the whole point: a fact learned
// while working in one codebase should be available the next time you open a different one.
// Each entry is a markdown file with the same "---\nkey: value\n---\nbody" frontmatter as skills.

const MEMORY_DIR = path.join(os.homedir(), ".nutaan", "memory");
const MEMORY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

function memoryPath(id) {
  if (!MEMORY_ID_PATTERN.test(id || "")) throw new Error(`Invalid memory id "${id}" — use letters, numbers, - and _ only`);
  return resolveSafe(MEMORY_DIR, id + ".md");
}

async function listMemoryEntries() {
  let files;
  try {
    files = await fs.readdir(MEMORY_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith(".md")) continue;
    const id = f.name.slice(0, -3);
    try {
      const raw = await fs.readFile(path.join(MEMORY_DIR, f.name), "utf8");
      const { name, description, body } = parseSkillFile(raw);
      const typeMatch = raw.match(/^---\n[\s\S]*?\btype:\s*(\S+)/);
      out.push({ id, name: name || id, type: typeMatch ? typeMatch[1] : "note", description: description || body.slice(0, 80) });
    } catch {
      // skip unreadable file
    }
  }
  return out;
}

async function buildMemoryContext() {
  const entries = await listMemoryEntries();
  // Deliberately still returned when empty. Returning null on a fresh install meant the model
  // was never told memory existed, so it never wrote the first entry — and memory stayed empty
  // forever. The empty case is exactly when the instruction to start saving matters most.
  const index = entries.length
    ? "Existing entries:\n" + entries.map((e) => `- **${e.id}** (${e.type}): ${e.description}`).join("\n")
    : "You have not saved anything yet.";
  return (
    "You have persistent memory shared across every project on this machine, stored at ~/.nutaan/memory/ " +
    "(not scoped to the current project folder). " +
    index +
    "\n\nUse memory_read to load one in full when it's relevant to the current task. Use memory_write to save " +
    "durable facts worth remembering next time — user/project preferences, corrections about how to approach " +
    "this codebase or this person's workflow, cross-project conventions — not routine task details or anything " +
    "already obvious from the code itself. Update an existing entry (same id) instead of creating a near-duplicate."
  );
}

// A trip's route on real roads, from free OpenStreetMap services — Nominatim to turn each place
// name into a coordinate, OSRM to draw the driving route and measure it. No API key, so it works
// out of the box. The renderer draws the returned geometry on a Leaflet map; the leg distances are
// the honest numbers a costed itinerary is built on.
const geocodeCache = new Map();
async function geocodePlace(name) {
  const key = String(name).trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const res = await fetch(
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(name),
    { headers: { "User-Agent": "NutaanCode/1.0 (itinerary planner)" }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`Geocoding failed for "${name}" (HTTP ${res.status})`);
  const j = await res.json();
  if (!j[0]) { geocodeCache.set(key, null); return null; }
  const out = { name: j[0].display_name.split(",").slice(0, 2).join(",").trim(), lat: +j[0].lat, lon: +j[0].lon };
  geocodeCache.set(key, out);
  return out;
}

function decimate(points, max = 800) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

async function mapRoute(stops) {
  const names = stops.map((s) => String(s || "").trim()).filter(Boolean);
  if (names.length < 2) return { error: "Give at least two stops, in travel order." };
  // Geocode in series so Nominatim's one-request-a-second limit is respected.
  const points = [];
  for (const n of names) {
    let p;
    try { p = await geocodePlace(n); } catch (e) { return { error: e.message }; }
    if (!p) return { error: `Couldn't find "${n}" on the map. Try a more specific name (add the state or country).` };
    points.push({ query: n, ...p });
    await new Promise((r) => setTimeout(r, 1100));
  }
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(";");
  let route;
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(25_000) }
    );
    if (!res.ok) throw new Error(`Routing failed (HTTP ${res.status})`);
    const j = await res.json();
    route = j.routes && j.routes[0];
    if (!route) throw new Error(j.message || "No drivable route between these stops.");
  } catch (e) {
    return { error: e.message };
  }
  const legs = (route.legs || []).map((l, i) => ({
    from: points[i].name, to: points[i + 1].name,
    km: Math.round(l.distance / 1000), hours: +(l.duration / 3600).toFixed(1),
  }));
  return {
    ok: true,
    stops: points.map((p) => ({ name: p.name, query: p.query, lat: p.lat, lon: p.lon })),
    geometry: decimate(route.geometry.coordinates), // [lng,lat] pairs for the polyline
    totalKm: Math.round(route.distance / 1000),
    totalHours: +(route.duration / 3600).toFixed(1),
    legs,
  };
}

async function webFetch(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("web_fetch needs a full http(s):// URL");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();
  if (!contentType.includes("html")) {
    return { url: res.url, content: raw.slice(0, MAX_OUTPUT_CHARS) };
  }
  const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { url: res.url, title: titleMatch ? titleMatch[1].trim() : null, content: text.slice(0, MAX_OUTPUT_CHARS), raw };
}

// Stripping tags throws away the entire visual identity of a page — asked "use this site's
// brand colour", an index built from body text alone genuinely has no answer. Pulling the
// palette and fonts out of the markup keeps design questions answerable from the index.
function extractDesignTokens(rawHtml) {
  const counts = new Map();
  for (const m of rawHtml.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  for (const m of rawHtml.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) {
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const colours = [...counts.entries()]
    .filter(([hex]) => !/^(0{6}|f{6})$/.test(hex)) // pure black/white carry no brand signal
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([hex, n]) => `#${hex} (used ${n}×)`);

  const fonts = [...new Set(
    [...rawHtml.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)].map((m) => m[1].trim().replace(/\s+/g, " ").slice(0, 80))
  )].slice(0, 6);

  if (!colours.length && !fonts.length) return "";
  return (
    "\n\nDesign tokens found on this page (extracted from its stylesheets and markup):\n" +
    (colours.length ? `Colours, most used first: ${colours.join(", ")}\n` : "") +
    (fonts.length ? `Font stacks: ${fonts.join(" | ")}\n` : "")
  );
}

// ---------- Co-worker: the machine outside the project ----------
// The agent's file tools are deliberately sandboxed to the project root. These are not — they
// are how it acts as an assistant on the whole device: find a document, open an app, tidy a
// folder. Everything here is read-only or launches through the OS default handler; nothing
// deletes or overwrites, and anything that moves a file goes through the approval path.

const HOME = os.homedir();
// The whole home directory, not a handful of folders: measured at ~7,800 entries in ~120ms
// once the dependency and cache directories below are skipped, so there is no reason to make
// the user think about where a file happens to live.
const CO_WORKER_ROOTS = [HOME];
const CO_WORKER_SKIP = new Set([
  "node_modules", ".git", "AppData", "Library", ".cache", "$RECYCLE.BIN", "System Volume Information",
  ".venv", "venv", "__pycache__", "dist", "build", ".next", "out", "vendor", "target",
  ".gradle", ".m2", ".nuget", ".cargo", ".rustup", "go", "Application Data", "OneDriveTemp",
]);
const CO_WORKER_MAX_HITS = 80;
const CO_WORKER_MAX_DEPTH = 8;

// Resolves a user-facing path: absolute, ~-relative, or bare like "Downloads/report.pdf".
function resolveUserPath(p) {
  const raw = String(p || "").trim();
  if (!raw) throw new Error("No path given");
  if (raw.startsWith("~")) return path.join(HOME, raw.slice(1));
  if (path.isAbsolute(raw)) return raw;
  return path.join(HOME, raw);
}

async function coWorkerSearch(query, startPath, maxDepth = CO_WORKER_MAX_DEPTH, onProgress = null) {
  const roots = startPath ? [resolveUserPath(startPath)] : CO_WORKER_ROOTS;
  const needle = String(query || "").toLowerCase();
  const hits = [];
  let scanned = 0;
  let lastReport = 0;

  async function walk(dir, depth) {
    if (hits.length >= CO_WORKER_MAX_HITS || depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied on a system folder is normal, not an error worth reporting
    }
    for (const e of entries) {
      if (hits.length >= CO_WORKER_MAX_HITS) return;
      if (CO_WORKER_SKIP.has(e.name)) continue;
      scanned++;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(needle)) {
        let size = null;
        let modified = null;
        try {
          const st = await fs.stat(full);
          size = st.size;
          modified = st.mtime.toISOString();
        } catch {}
        hits.push({ path: full, name: e.name, isDir: e.isDirectory(), size, modified });
      }
      // Throttled to ~20/s: a disk walk visits thousands of entries and reporting each one
      // would spend more time posting messages than reading directories.
      if (onProgress && Date.now() - lastReport > 50) {
        lastReport = Date.now();
        onProgress({ scanned, found: hits.length, current: dir });
      }
      if (e.isDirectory() && !e.name.startsWith(".")) await walk(full, depth + 1);
    }
  }

  for (const r of roots) await walk(r, 0);
  hits.sort((a, b) => String(b.modified || "").localeCompare(String(a.modified || "")));
  if (onProgress) onProgress({ scanned, found: hits.length, current: null, done: true });
  return { query, searched: roots, hits, scanned, truncated: hits.length >= CO_WORKER_MAX_HITS };
}

const TEXTUAL_EXT = new Set([
  "txt", "md", "json", "csv", "tsv", "log", "xml", "yml", "yaml", "ini", "cfg", "conf",
  "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "php",
  "html", "css", "scss", "sh", "bat", "ps1", "sql", "env",
]);

// ---------- System resources (the numbers Task Manager / Activity Monitor shows) ----------
// "How much CPU is this actually using?" is a question about the whole machine, not the project,
// so it lives with the co-worker tools. Everything here is a pure read.

function capture(cmd, args, timeoutMs = 25_000) {
  return new Promise((resolve) => {
    let child;
    let out = "";
    let err = "";
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, out: "", err: e.message });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout?.on("data", (c) => { out += c; });
    child.stderr?.on("data", (c) => { err += c; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, out, err: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
  });
}

function cpuSnapshot() {
  return os.cpus().map((c) => {
    let total = 0;
    for (const k of Object.keys(c.times)) total += c.times[k];
    return { idle: c.times.idle, total };
  });
}

// Windows reports a process's CPU as lifetime processor-seconds, so a single reading is a
// lifetime average, not "what it's doing now". Sampling twice inside the same shell and dividing
// the delta by elapsed time and core count gives the live percentage Task Manager displays.
const WIN_STATS_PS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$cores = [Environment]::ProcessorCount",
  "$first = @{}",
  "foreach ($p in Get-Process) { if ($p.CPU -ne $null) { $first[$p.Id] = $p.CPU } }",
  "$t0 = Get-Date",
  "Start-Sleep -Milliseconds 700",
  "$elapsed = ((Get-Date) - $t0).TotalSeconds",
  "$rows = foreach ($p in Get-Process) {",
  "  $prev = $first[$p.Id]",
  "  $pct = 0.0",
  "  if ($prev -ne $null -and $p.CPU -ne $null -and $elapsed -gt 0) { $pct = (($p.CPU - $prev) / $elapsed / $cores) * 100 }",
  "  [pscustomobject]@{ n = $p.ProcessName; c = $pct; m = ($p.WorkingSet64 / 1MB) }",
  "}",
  "$procs = $rows | Group-Object n | ForEach-Object {",
  "  [pscustomobject]@{",
  "    name  = $_.Name",
  "    procs = $_.Count",
  "    cpu   = [Math]::Round((($_.Group | Measure-Object -Property c -Sum).Sum), 1)",
  "    memMB = [Math]::Round((($_.Group | Measure-Object -Property m -Sum).Sum), 1)",
  "  }",
  "} | Sort-Object -Property @{Expression='cpu';Descending=$true}, @{Expression='memMB';Descending=$true} | Select-Object -First 15",
  "$disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {",
  "  [pscustomobject]@{ drive = $_.DeviceID; totalGB = [Math]::Round($_.Size / 1GB, 1); freeGB = [Math]::Round($_.FreeSpace / 1GB, 1) }",
  "}",
  "[pscustomobject]@{ processes = @($procs); disks = @($disks) } | ConvertTo-Json -Depth 4 -Compress",
].join("\n");

function parseWinStats(text) {
  try {
    const parsed = JSON.parse(text);
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    return { processes: arr(parsed.processes), disks: arr(parsed.disks) };
  } catch {
    return { processes: [], disks: [] };
  }
}

// ps reports a live %CPU on both macOS and Linux; only the sort flag differs.
function parsePsStats(text, cores) {
  const merged = new Map();
  for (const line of String(text).trim().split(/\r?\n/)) {
    // The command comes last precisely because it is the one field that contains spaces.
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const raw = m[4].trim();
    // Linux brackets its kernel threads — [kworker/0:1] is a name, not a path to take apart.
    const name = raw.startsWith("[") ? raw.replace(/^\[|\]$/g, "") : path.basename(raw);
    // ps counts a fully-busy core as 100%; Task Manager counts a fully-busy machine as 100%.
    const cpu = parseFloat(m[2]) / (cores || 1);
    const memMB = parseInt(m[3], 10) / 1024;
    const prev = merged.get(name);
    if (prev) { prev.procs += 1; prev.cpu += cpu; prev.memMB += memMB; }
    else merged.set(name, { name, procs: 1, cpu, memMB });
  }
  return [...merged.values()]
    .map((p) => ({ ...p, cpu: Math.round(p.cpu * 10) / 10, memMB: Math.round(p.memMB * 10) / 10 }))
    .sort((a, b) => b.cpu - a.cpu || b.memMB - a.memMB)
    .slice(0, 15);
}

function parseDfStats(text) {
  const disks = [];
  for (const line of String(text).trim().split(/\r?\n/).slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || !f[0].startsWith("/")) continue;
    disks.push({
      drive: f[5],
      totalGB: Math.round((parseInt(f[1], 10) / 1048576) * 10) / 10,
      freeGB: Math.round((parseInt(f[3], 10) / 1048576) * 10) / 10,
    });
  }
  return disks;
}

async function systemStats() {
  const cores = os.cpus().length || 1;
  const before = cpuSnapshot();
  const startedAt = Date.now();

  let processes = [];
  let disks = [];
  let probeError = null;
  if (process.platform === "win32") {
    const res = await capture("powershell", ["-NoProfile", "-NonInteractive", "-Command", WIN_STATS_PS]);
    const parsed = parseWinStats(res.out);
    processes = parsed.processes;
    disks = parsed.disks;
    if (!processes.length) probeError = (res.err || "").trim().slice(0, 300) || "could not read the process list";
  } else {
    const psArgs = process.platform === "darwin"
      ? ["-Aceo", "pid=,pcpu=,rss=,comm=", "-r"]
      : ["-eo", "pid=,pcpu=,rss=,comm=", "--sort=-pcpu"];
    const [psRes, dfRes] = await Promise.all([capture("ps", psArgs), capture("df", ["-kP"])]);
    processes = parsePsStats(psRes.out, cores);
    disks = parseDfStats(dfRes.out);
    if (!processes.length) probeError = (psRes.err || "").trim().slice(0, 300) || "could not read the process list";
  }

  // The process probe above takes about a second, which doubles as the sampling window for
  // overall CPU. If it bailed out early, wait out the rest of the window so the reading still
  // means something — two snapshots taken milliseconds apart are noise, not a measurement.
  const elapsed = Date.now() - startedAt;
  if (elapsed < 500) await new Promise((r) => setTimeout(r, 500 - elapsed));
  const after = cpuSnapshot();
  const perCore = before.map((b, i) => {
    const a = after[i] || b;
    const dTotal = a.total - b.total;
    const dIdle = a.idle - b.idle;
    return dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 1000) / 10 : 0;
  });
  const cpuPercent = Math.round((perCore.reduce((s, v) => s + v, 0) / perCore.length) * 10) / 10;

  const totalMemMB = Math.round(os.totalmem() / 1048576);
  const freeMemMB = Math.round(os.freemem() / 1048576);
  const usedMemMB = totalMemMB - freeMemMB;

  // Nutaan Code's own share, split the way its internals are: browser, renderer, gpu, utility.
  const own = { processes: [], cpu: 0, memMB: 0 };
  try {
    for (const m of app.getAppMetrics()) {
      const cpu = Math.round(((m.cpu?.percentCPUUsage || 0) / cores) * 10) / 10;
      const memMB = Math.round(((m.memory?.workingSetSize || 0) / 1024) * 10) / 10;
      own.processes.push({ type: m.type, pid: m.pid, cpu, memMB });
      own.cpu = Math.round((own.cpu + cpu) * 10) / 10;
      own.memMB = Math.round((own.memMB + memMB) * 10) / 10;
    }
    own.processes.sort((a, b) => b.cpu - a.cpu || b.memMB - a.memMB);
  } catch {}

  const busiest = processes.slice(0, 3).map((p) => `${p.name} ${p.cpu}%`).join(", ");
  const summary =
    `CPU ${cpuPercent}% of ${cores} cores · RAM ${Math.round((usedMemMB / totalMemMB) * 100)}% used ` +
    `(${(usedMemMB / 1024).toFixed(1)} of ${(totalMemMB / 1024).toFixed(1)} GB)` +
    (busiest ? ` · busiest: ${busiest}` : "") +
    ` · Nutaan Code itself: ${own.cpu}% CPU, ${(own.memMB / 1024).toFixed(1)} GB across ${own.processes.length} processes.`;

  return {
    summary,
    cpu: {
      percent: cpuPercent,
      cores,
      perCore,
      loadAverage: process.platform === "win32" ? null : os.loadavg().map((n) => Math.round(n * 100) / 100),
    },
    memory: {
      totalMB: totalMemMB,
      usedMB: usedMemMB,
      freeMB: freeMemMB,
      percent: Math.round((usedMemMB / totalMemMB) * 1000) / 10,
    },
    topProcesses: processes,
    disks,
    app: own,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    ...(probeError ? { note: `Per-process figures unavailable: ${probeError}` } : {}),
  };
}

// Killing a process is the one co-worker action that can take the machine down with it, so the
// list of things we refuse is not advisory. lsass or csrss blue-screens Windows on the spot;
// systemd or launchd does the equivalent elsewhere. Nobody asking to "close that app" means one
// of these, so refuse rather than ask. explorer/Finder are deliberately absent — restarting the
// shell is a normal thing to want, and the OS brings them straight back.
const PROTECTED_PROCESSES = new Set([
  "system", "system idle process", "registry", "memory compression", "smss", "csrss", "wininit",
  "winlogon", "services", "lsass", "lsaiso", "svchost", "fontdrvhost", "dwm", "sihost", "ctfmon",
  "audiodg", "securityhealthservice", "msmpeng",
  "init", "systemd", "systemd-journald", "systemd-logind", "dbus-daemon", "kthreadd", "launchd",
  "kernel_task", "windowserver", "loginwindow", "coreaudiod", "mds", "mds_stores", "syslogd",
  "xorg", "wayland", "gnome-shell", "kwin_x11", "kwin_wayland", "pipewire", "pulseaudio",
]);

async function listProcesses() {
  if (process.platform === "win32") {
    const res = await capture("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-Process | Select-Object Id, ProcessName | ConvertTo-Json -Compress",
    ]);
    try {
      const parsed = JSON.parse(res.out);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ pid: p.Id, name: String(p.ProcessName || "") }));
    } catch {
      return [];
    }
  }
  const res = await capture("ps", ["-eo", "pid=,comm="]);
  return String(res.out).trim().split(/\r?\n/).map((line) => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const raw = m[2].trim();
    return { pid: parseInt(m[1], 10), name: raw.startsWith("[") ? raw.replace(/^\[|\]$/g, "") : path.basename(raw) };
  }).filter(Boolean);
}

// The whole app is one process tree — killing the GPU or a renderer child takes the window with
// it, so our own tree is off limits however it was addressed.
function ownPids() {
  const mine = new Set([process.pid, process.ppid].filter((n) => typeof n === "number"));
  try { for (const m of app.getAppMetrics()) mine.add(m.pid); } catch {}
  return mine;
}

async function killProcess({ pid, name, force = false }) {
  const wanted = String(name || "").trim().toLowerCase().replace(/\.exe$/, "");
  if (pid == null && !wanted) throw new Error("Give either a pid or a process name to close.");

  const all = await listProcesses();
  const mine = ownPids();
  let targets = pid != null
    ? all.filter((p) => p.pid === Number(pid))
    : all.filter((p) => p.name.toLowerCase().replace(/\.exe$/, "") === wanted);

  // Fall back to a substring match so "chrome" still finds "Google Chrome Helper".
  if (!targets.length && wanted) targets = all.filter((p) => p.name.toLowerCase().includes(wanted));

  if (!targets.length) {
    if (pid != null && !all.length) targets = [{ pid: Number(pid), name: "pid " + pid }]; // no listing available; trust the pid
    else return { ok: false, killed: [], error: pid != null ? `No running process with pid ${pid}.` : `Nothing running called "${name}".` };
  }

  const blocked = [];
  const doomed = [];
  for (const t of targets) {
    if (PROTECTED_PROCESSES.has(t.name.toLowerCase().replace(/\.exe$/, ""))) blocked.push({ ...t, reason: "a critical operating-system process — closing it would crash or freeze the machine" });
    else if (mine.has(t.pid)) blocked.push({ ...t, reason: "part of Nutaan Code itself — closing it would kill this conversation" });
    else doomed.push(t);
  }

  const killed = [];
  const failed = [];
  for (const t of doomed) {
    if (process.platform === "win32") {
      // /T takes the child processes with it, which is what "close this app" means for anything
      // Chromium-based or any program that spawns helpers.
      const args = ["/PID", String(t.pid), "/T"];
      if (force) args.push("/F");
      const res = await capture("taskkill", args, 10_000);
      if (res.ok) killed.push(t);
      else failed.push({ ...t, error: (res.err || res.out || "taskkill refused").trim().slice(0, 200) });
    } else {
      try { process.kill(t.pid, force ? "SIGKILL" : "SIGTERM"); killed.push(t); }
      catch (e) { failed.push({ ...t, error: e.code === "EPERM" ? "needs elevated permissions" : e.message }); }
    }
  }

  const parts = [];
  if (killed.length) parts.push(`Closed ${killed.map((t) => `${t.name} (pid ${t.pid})`).join(", ")}.`);
  if (failed.length) parts.push(`Could not close ${failed.map((t) => `${t.name} (${t.error})`).join(", ")}.`);
  if (blocked.length) {
    // Ten Chrome helpers refused for the same reason should read as one sentence, not ten.
    const byReason = new Map();
    for (const t of blocked) byReason.set(t.reason, (byReason.get(t.reason) || new Set()).add(t.name));
    for (const [reason, names] of byReason) parts.push(`Refused to touch ${[...names].join(", ")} — ${reason}.`);
  }
  if (!force && failed.length) parts.push("Retry with force:true to terminate it outright.");

  return {
    ok: killed.length > 0,
    killed,
    failed,
    blocked,
    summary: parts.join(" ") || "Nothing was closed.",
  };
}

// ---------- Document extraction (Excel / Word / PowerPoint / PDF), dependency-free ----------
// Office files are ZIP archives; read the central directory and inflate entries with the built-in
// zlib so the co-worker can actually read a spreadsheet or document instead of showing binary.
const zlib = require("node:zlib");

function unzip(buffer) {
  const files = new Map();
  // Locate the End of Central Directory record (scan back from the end).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return files;
  const count = buffer.readUInt16LE(eocd + 10);
  let off = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(off) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(off + 10);
    const compSize = buffer.readUInt32LE(off + 20);
    const fnLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    const localOff = buffer.readUInt32LE(off + 42);
    const name = buffer.toString("utf8", off + 46, off + 46 + fnLen);
    // Jump to the local header to find where the data actually starts.
    if (buffer.readUInt32LE(localOff) === 0x04034b50) {
      const lfn = buffer.readUInt16LE(localOff + 26);
      const lex = buffer.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lfn + lex;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      try {
        files.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
      } catch { /* skip an entry that won't inflate */ }
    }
    off += 46 + fnLen + extraLen + commentLen;
  }
  return files;
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
}

function extractDocx(buf) {
  const doc = unzip(buf).get("word/document.xml");
  if (!doc) return "";
  const xml = doc.toString("utf8");
  // Walk the document in order: emit text nodes (<w:t>), a newline per paragraph end / <w:br>,
  // a tab per <w:tab/>, and ignore everything else (table properties, styles, etc.).
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
  let m, out = "";
  while ((m = re.exec(xml))) {
    if (m[1] != null) out += decodeXmlEntities(m[1]);
    else if (m[0] === "</w:p>") out += "\n";
    else if (/tab/.test(m[0])) out += "\t";
    else out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractXlsx(buf) {
  const zip = unzip(buf);
  // Shared strings table.
  const shared = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) {
    const sx = ss.toString("utf8");
    const sre = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = sre.exec(sx))) {
      const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let t, s = "";
      while ((t = tre.exec(m[1]))) s += decodeXmlEntities(t[1]);
      shared.push(s);
    }
  }
  const sheets = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const parts = [];
  for (const key of sheets) {
    const sx = zip.get(key).toString("utf8");
    const rows = [];
    const rre = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rre.exec(sx))) {
      const cells = [];
      const cre = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
      let cm;
      while ((cm = cre.exec(rm[1]))) {
        const attrs = cm[1] != null ? cm[1] : cm[3] || "";
        const inner = cm[2] || "";
        const tm = /\bt="([^"]+)"/.exec(attrs);
        const type = tm ? tm[1] : "";
        let val = "";
        if (type === "s") {
          const v = /<v>(\d+)<\/v>/.exec(inner);
          val = v ? shared[+v[1]] || "" : "";
        } else if (type === "inlineStr" || type === "str") {
          const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
          if (t) val = decodeXmlEntities(t[1]);
          else { const v = /<v>([\s\S]*?)<\/v>/.exec(inner); val = v ? decodeXmlEntities(v[1]) : ""; }
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          val = v ? decodeXmlEntities(v[1]) : "";
        }
        cells.push(val);
      }
      rows.push(cells.join("\t"));
    }
    if (rows.length) parts.push((sheets.length > 1 ? `# ${key.split("/").pop()}\n` : "") + rows.join("\n"));
  }
  return parts.join("\n\n").trim();
}

function extractPptx(buf) {
  const zip = unzip(buf);
  const slides = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => (+a.match(/(\d+)/)[1]) - (+b.match(/(\d+)/)[1]));
  const parts = [];
  slides.forEach((key, i) => {
    const sx = zip.get(key).toString("utf8");
    const tre = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m, txt = [];
    while ((m = tre.exec(sx))) txt.push(decodeXmlEntities(m[1]));
    if (txt.length) parts.push(`--- Slide ${i + 1} ---\n` + txt.join("\n"));
  });
  return parts.join("\n\n").trim();
}

function extractPdf(buf) {
  // Best-effort text: inflate content streams and pull the strings drawn by Tj/TJ operators.
  // Works for normal (text-based) PDFs; scanned/image PDFs have no text to extract.
  let text = "";
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  const grab = (s) => {
    let out = "";
    const tj = /\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\]]|\\.)*)\]\s*TJ/g;
    let t;
    while ((t = tj.exec(s))) {
      const body = t[1] != null ? t[1] : (t[2] || "").replace(/\(((?:[^()\\]|\\.)*)\)/g, "$1").replace(/-?\d+(\.\d+)?/g, "");
      out += body.replace(/\\[nrt]/g, " ").replace(/\\([()\\])/g, "$1");
    }
    return out;
  };
  while ((m = re.exec(buf.toString("latin1")))) {
    const raw = Buffer.from(m[1], "latin1");
    let s = null;
    try { s = zlib.inflateSync(raw).toString("latin1"); } catch { s = raw.toString("latin1"); }
    if (/BT|Tj|TJ/.test(s)) text += grab(s) + "\n";
  }
  // Drop hex-glyph tokens from subset-font runs we can't decode without the font map, so the
  // readable (standard-encoded) text isn't buried in <F><CD>… noise.
  return text.replace(/<[0-9A-Fa-f]{0,8}>/g, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function stripHtml(html) {
  return decodeXmlEntities(
    String(html)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
      .replace(/<br[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
  ).replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEmailBody(body, encoding) {
  const enc = String(encoding || "").toLowerCase();
  if (enc === "base64") {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  if (enc === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes).toString("utf8");
  }
  return body;
}

// Parse one RFC822 message (.eml) — headers plus the readable text body (prefers text/plain, falls
// back to stripped HTML), decoding base64 / quoted-printable.
function extractEml(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  const headerBlock = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, "") : "";
  const headers = {};
  headerBlock.replace(/^([\w-]+):[ \t]*([\s\S]*?)(?=\r?\n[\w-]+:|\r?\n?$)/gm, (m, k, v) => {
    headers[k.toLowerCase()] = v.replace(/\r?\n[ \t]+/g, " ").trim();
    return m;
  });
  const ctype = headers["content-type"] || "";
  let text;
  const bMatch = /boundary="?([^";\r\n]+)"?/i.exec(ctype);
  if (bMatch) {
    const parts = body.split("--" + bMatch[1]);
    const chosen =
      parts.find((pt) => /content-type:\s*text\/plain/i.test(pt)) ||
      parts.find((pt) => /content-type:\s*text\/html/i.test(pt)) || "";
    const pidx = chosen.search(/\r?\n\r?\n/);
    const pbody = pidx >= 0 ? chosen.slice(pidx + 2) : chosen;
    const enc = (/content-transfer-encoding:\s*([\w-]+)/i.exec(chosen) || [])[1] || "";
    text = decodeEmailBody(pbody, enc);
    if (/content-type:\s*text\/html/i.test(chosen)) text = stripHtml(text);
  } else {
    text = decodeEmailBody(body, headers["content-transfer-encoding"]);
    if (/text\/html/i.test(ctype)) text = stripHtml(text);
  }
  const hdr = [
    headers.from && "From: " + headers.from,
    headers.to && "To: " + headers.to,
    headers.date && "Date: " + headers.date,
    headers.subject && "Subject: " + headers.subject,
  ].filter(Boolean).join("\n");
  return (hdr + "\n\n" + (text || "").trim()).trim();
}

function extractMbox(raw) {
  const msgs = raw.split(/\r?\nFrom .*\r?\n/).filter((m) => m.trim());
  return msgs.slice(0, 50).map((m, i) => `===== Message ${i + 1} =====\n` + extractEml(m)).join("\n\n");
}

// Outlook .msg is an OLE compound binary; without a full parser, pull the readable UTF-16LE runs
// (subject and body are stored that way) as a best effort.
function extractMsg(buf) {
  let out = "";
  let run = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code >= 32 && code < 0xd800) run += String.fromCharCode(code);
    else if (code === 10 || code === 13) run += "\n";
    else { if (run.trim().length >= 4) out += run.replace(/\n{3,}/g, "\n\n") + "\n"; run = ""; }
  }
  if (run.trim().length >= 4) out += run;
  // De-duplicate the noisy short property-name runs; keep lines with real words.
  return out.split("\n").filter((l) => /[A-Za-z]{3,}\s+[A-Za-z]{2,}|@|\bhttp/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractDocument(buffer, ext) {
  if (ext === "docx") return extractDocx(buffer);
  if (ext === "xlsx" || ext === "xlsm") return extractXlsx(buffer);
  if (ext === "pptx") return extractPptx(buffer);
  if (ext === "pdf") return extractPdf(buffer);
  if (ext === "eml") return extractEml(buffer.toString("utf8"));
  if (ext === "mbox") return extractMbox(buffer.toString("utf8"));
  if (ext === "msg") return extractMsg(buffer);
  return "";
}

const DOC_EXT = new Set(["docx", "xlsx", "xlsm", "pptx", "pdf", "eml", "mbox", "msg"]);

async function coWorkerRead(p, limit = 600) {
  const target = resolveUserPath(p);
  const st = await fs.stat(target);
  if (st.isDirectory()) {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return {
      kind: "directory",
      path: target,
      entries: entries.slice(0, 300).map((e) => ({ name: e.name, isDir: e.isDirectory() })),
    };
  }
  const ext = path.extname(target).slice(1).toLowerCase();
  if (IMAGE_MIME[ext]) {
    const buffer = await fs.readFile(target);
    return { kind: "image", path: target, dataUrl: `data:${IMAGE_MIME[ext]};base64,${buffer.toString("base64")}` };
  }
  if (DOC_EXT.has(ext)) {
    if (st.size > 40_000_000) throw new Error("Document is too large to read (>40MB)");
    const buffer = await fs.readFile(target);
    let text = "";
    try { text = extractDocument(buffer, ext); } catch { text = ""; }
    if (text && text.trim()) {
      const lines = text.split("\n");
      return {
        kind: "document",
        path: target,
        format: ext,
        totalLines: lines.length,
        content: lines.slice(0, Math.max(limit, 2000)).join("\n"),
        hasMore: lines.length > Math.max(limit, 2000),
      };
    }
    return {
      kind: "binary",
      path: target,
      size: st.size,
      note: ext === "pdf"
        ? "This PDF appears to be scanned/image-only (no extractable text). Use os_open to view it, or ask for OCR."
        : `Couldn't extract text from this .${ext}. Use os_open to open it in its own application.`,
    };
  }
  if (!TEXTUAL_EXT.has(ext)) {
    return { kind: "binary", path: target, size: st.size, note: `Not a text or image file (.${ext}). Use os_open to open it in its own application.` };
  }
  if (st.size > 5_000_000) throw new Error("File is too large to read (>5MB)");
  const lines = (await fs.readFile(target, "utf8")).split("\n");
  return {
    kind: "text",
    path: target,
    totalLines: lines.length,
    content: lines.slice(0, limit).join("\n"),
    hasMore: lines.length > limit,
  };
}

// One call per platform for "open this the way a double-click would".
function osOpenCommand(target) {
  if (process.platform === "win32") return `start "" "${target.replace(/"/g, '')}"`;
  if (process.platform === "darwin") return `open "${target.replace(/"/g, '\\"')}"`;
  return `xdg-open "${target.replace(/"/g, '\\"')}"`;
}

function osLaunchAppCommand(appName) {
  const safe = String(appName).replace(/"/g, "");
  if (process.platform === "win32") return `start "" "${safe}"`;
  if (process.platform === "darwin") return `open -a "${safe}"`;
  // Linux desktop entries are launched by their .desktop id; fall back to the binary name.
  return `gtk-launch "${safe}" 2>/dev/null || setsid "${safe}" >/dev/null 2>&1 &`;
}

// ---------- Web search ----------
// Our own aggregator rather than a third-party search API: no extra key to hold, nothing to
// bill, and the sources are chosen for what a coding agent actually needs to look up. Each is
// a documented public JSON API — no scraping, no CAPTCHA to work around.
const SEARCH_TIMEOUT_MS = 12_000;

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "NutaanCode/1.0", Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const SEARCH_SOURCES = {
  async stackoverflow(q, limit) {
    const d = await getJson(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&filter=!nNPvSNdWme&pagesize=${limit}`
    );
    return (d.items || []).map((i) => ({
      source: "stackoverflow",
      title: stripTags(i.title),
      url: i.link,
      detail: `score ${i.score}${i.is_answered ? ", answered" : ", unanswered"}`,
    }));
  },
  async github(q, limit) {
    const d = await getJson(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${limit}`,
      { Accept: "application/vnd.github+json" }
    );
    return (d.items || []).map((i) => ({
      source: "github",
      title: i.full_name,
      url: i.html_url,
      detail: `${i.stargazers_count}★ — ${stripTags(i.description).slice(0, 140)}`,
    }));
  },
  async npm(q, limit) {
    const d = await getJson(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${limit}`);
    return (d.objects || []).map((o) => ({
      source: "npm",
      title: o.package.name,
      url: o.package.links?.npm || `https://www.npmjs.com/package/${o.package.name}`,
      detail: `v${o.package.version} — ${stripTags(o.package.description).slice(0, 140)}`,
    }));
  },
  async wikipedia(q, limit) {
    const d = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${limit}`
    );
    return (d.query?.search || []).map((s) => ({
      source: "wikipedia",
      title: s.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
      detail: stripTags(s.snippet).slice(0, 160),
    }));
  },
  async hackernews(q, limit) {
    const d = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=${limit}`);
    return (d.hits || [])
      .filter((h) => h.url)
      .map((h) => ({
        source: "hackernews",
        title: h.title || h.story_title || "(discussion)",
        url: h.url,
        detail: `${h.points || 0} points, ${h.num_comments || 0} comments`,
      }));
  },
};

async function webSearch(query, requested, limit = 5) {
  const names = requested?.length ? requested.filter((n) => SEARCH_SOURCES[n]) : Object.keys(SEARCH_SOURCES);
  if (!names.length) throw new Error(`Unknown source. Available: ${Object.keys(SEARCH_SOURCES).join(", ")}`);
  // All sources at once: one slow or rate-limited source shouldn't hold up or sink the rest.
  const settled = await Promise.allSettled(names.map((n) => SEARCH_SOURCES[n](query, Math.min(limit, 10))));
  const results = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(...r.value);
    else failed.push(`${names[i]}: ${r.reason?.message || "failed"}`);
  });
  return { query, results, failed, searched: names };
}

// ---------- Knowledge base (local, embedded) ----------
// Lives at ~/.nutaan/kb/index.json alongside memory. Memory is for short facts the agent
// decides to keep; this is for bulk reference material the user hands it — a docs site, an API
// spec, pasted notes — chunked and embedded once, then recalled by meaning on every turn.
// Vectors stay on this machine; only the text being embedded is ever sent out.

const KB_DIR = path.join(os.homedir(), ".nutaan", "kb");
const KB_INDEX = path.join(KB_DIR, "index.json");
const KB_CHUNK_CHARS = 1200;
const KB_CHUNK_OVERLAP = 150;
const KB_EMBED_BATCH = 24;
const KB_MAX_CHUNKS = 400;

async function readKb() {
  try {
    const parsed = JSON.parse(await fs.readFile(KB_INDEX, "utf8"));
    return Array.isArray(parsed?.entries) ? parsed : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

async function writeKb(data) {
  await fs.mkdir(KB_DIR, { recursive: true });
  await fs.writeFile(KB_INDEX, JSON.stringify(data), "utf8");
}

// Split on paragraph boundaries where possible so a chunk is a coherent passage rather than a
// window that starts mid-sentence. Overlap keeps an answer that straddles a boundary findable.
function chunkText(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length && chunks.length < KB_MAX_CHUNKS) {
    let end = Math.min(i + KB_CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const para = clean.lastIndexOf("\n\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      const cut = para > i + 400 ? para : sentence > i + 400 ? sentence + 1 : -1;
      if (cut > 0) end = cut;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - KB_CHUNK_OVERLAP, i + 1);
  }
  return chunks;
}

async function embedTexts(backend, texts) {
  const res = await fetch(buildEndpointUrl(backend.baseUrl, "/embeddings"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(backend.baseUrl, backend.apiKey) },
    body: JSON.stringify({ input: texts }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error?.message || detail;
    } catch {}
    throw new Error(detail);
  }
  const data = await res.json();
  const vectors = (data?.data || []).map((d) => d.embedding);
  if (vectors.length !== texts.length) throw new Error("Embedding provider returned the wrong number of vectors");
  return vectors;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

async function kbSearch(backend, query, ids, topK = 5) {
  const store = await readKb();
  const pool = store.entries.filter((e) => !ids?.length || ids.includes(e.id));
  if (!pool.length) return [];
  const [queryVector] = await embedTexts(backend, [String(query).slice(0, 4000)]);
  const scored = [];
  for (const entry of pool) {
    for (const chunk of entry.chunks) {
      scored.push({ score: cosineSimilarity(queryVector, chunk.embedding), text: chunk.text, title: entry.title, source: entry.source });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  // Centred on measured scores from this embedding model rather than guessed: across a set of
  // deliberately reworded questions, correct passages scored 0.275–0.431 while a wholly
  // off-topic query peaked at 0.157. 0.22 sits between the two with margin on both sides.
  return scored.filter((s) => s.score > 0.22).slice(0, topK);
}

ipcMain.handle("os:search", async (event, { query, path: startPath }) => {
  try {
    const onProgress = (p) => event.sender.send("os:search-progress", p);
    return { ok: true, ...(await coWorkerSearch(query, startPath, CO_WORKER_MAX_DEPTH, onProgress)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("os:read", async (_e, { path: p, limit }) => {
  try {
    return { ok: true, ...(await coWorkerRead(p, Math.min(Number(limit) || 4000, 20000))) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("os:open", async (_e, target) => {
  try {
    const resolved = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : resolveUserPath(target);
    const res = await runCommand(HOME, osOpenCommand(resolved));
    if (res.exitCode !== 0) return { ok: false, error: (res.stderr || "Could not open it").slice(0, 300) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("kb:list", async () => {
  const store = await readKb();
  return store.entries.map((e) => ({
    id: e.id,
    title: e.title,
    source: e.source,
    chunks: e.chunks.length,
    createdAt: e.createdAt,
  }));
});

ipcMain.handle("kb:remove", async (_e, id) => {
  const store = await readKb();
  store.entries = store.entries.filter((x) => x.id !== id);
  await writeKb(store);
  return true;
});

async function kbIngest(backend, { url: typedUrl, text: rawText, title: rawTitle }, onProgress = () => {}) {
  let text = String(rawText || "");
  let title = String(rawTitle || "").trim();
  // People type "tecosys.in", not "https://tecosys.in" — rejecting that as a malformed URL is
  // a pointless bit of pedantry when the scheme is obvious.
  const typed = String(typedUrl || "").trim();
  const url = typed && !/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? `https://${typed}` : typed;

  if (url) {
    onProgress("fetching", { url });
    const page = await webFetch(url);
    text = page.content + (page.raw ? extractDesignTokens(page.raw) : "");
    if (!title) title = page.title || url;
  }
  if (!title) title = "Untitled note";
  if (!text.trim()) throw new Error("Nothing to index — the source was empty.");

  onProgress("chunking", {});
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Nothing to index — the source had no readable text.");

  const embedded = [];
  for (let i = 0; i < chunks.length; i += KB_EMBED_BATCH) {
    const batch = chunks.slice(i, i + KB_EMBED_BATCH);
    const vectors = await embedTexts(backend, batch);
    batch.forEach((t, j) => embedded.push({ text: t, embedding: vectors[j] }));
    onProgress("embedding", { done: embedded.length, total: chunks.length });
  }

  const store = await readKb();
  const entry = {
    id: "kb" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    source: url || "pasted text",
    createdAt: new Date().toISOString(),
    chunks: embedded,
  };
  store.entries.push(entry);
  await writeKb(store);
  onProgress("done", { id: entry.id, title, chunks: embedded.length });
  return { id: entry.id, title, source: entry.source, chunks: embedded.length };
}

ipcMain.handle("kb:add", async (event, payload) => {
  const backend = await activeBackend(payload || {});
  const send = (stage, detail) => event.sender.send("kb:progress", { stage, ...detail });
  try {
    return { ok: true, ...(await kbIngest(backend, payload || {}, send)) };
  } catch (err) {
    send("error", { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("kb:search", async (_e, payload) => {
  const backend = await activeBackend(payload || {});
  try {
    return { ok: true, matches: await kbSearch(backend, payload?.query || "", payload?.ids, payload?.topK || 5) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

async function generateImage(baseUrl, apiKey, model, prompt, timeoutMs = 120_000) {
  if (!model) throw new Error("No image model configured — set one in ⚙ Settings → Advanced → Image model first.");
  const res = await fetch(buildEndpointUrl(baseUrl, "/images/generations"), {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(baseUrl, apiKey),
    },
    body: JSON.stringify({ model, prompt, n: 1 }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  const item = data?.data?.[0];
  if (!item) throw new Error("Server returned no image data");
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) {
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) throw new Error(`Failed to download generated image: HTTP ${imgRes.status}`);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  throw new Error("Server response had neither b64_json nor url");
}

function runCommand(root, command, signal) {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: root, timeout: COMMAND_TIMEOUT_MS, windowsHide: true, signal },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (error.code ?? 1) : 0,
          stdout: String(stdout || "").slice(0, MAX_OUTPUT_CHARS),
          stderr: String(stderr || "").slice(0, MAX_OUTPUT_CHARS),
          timedOut: Boolean(error && error.killed && error.signal),
          aborted: Boolean(error && error.name === "AbortError"),
        });
      }
    );
  });
}

ipcMain.handle("proc:run-command", async (_e, root, command) => runCommand(root, command));

// ---------- Background tasks (long-running commands that don't block the turn) ----------
// A dev server, a build watcher, a long test run: things you start and then keep working while
// they run, checking output when you want it — the way Claude Code's background tasks behave.
const backgroundTasks = new Map();
let bgTaskSeq = 0;
const MAX_BG_OUTPUT_LINES = 3000;
// The self-healing monitor listens here: { output(task, stream, line), exit(task) }.
const bgTaskListeners = [];

function startBackgroundTask(root, command) {
  const id = "bg" + ++bgTaskSeq;
  let child;
  try {
    child = spawn(command, { cwd: root, shell: true, windowsHide: true });
  } catch (e) {
    return { id, command, status: "error", error: e.message };
  }
  const task = { id, command, cwd: root, status: "running", exitCode: null, error: null, output: [], startedAt: Date.now(), endedAt: null, child };
  backgroundTasks.set(id, task);
  const push = (chunk, stream) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      task.output.push({ stream, line });
      for (const l of bgTaskListeners) { try { l.output?.(task, stream, line); } catch {} }
    }
    if (task.output.length > MAX_BG_OUTPUT_LINES) task.output.splice(0, task.output.length - MAX_BG_OUTPUT_LINES);
    try { win?.webContents.send("bgtask:update", { id, status: task.status, command, lines: task.output.length }); } catch {}
  };
  child.stdout?.on("data", (c) => push(c, "stdout"));
  child.stderr?.on("data", (c) => push(c, "stderr"));
  child.on("exit", (code, sig) => {
    task.status = "exited";
    task.exitCode = code ?? (sig ? 1 : 0);
    task.endedAt = Date.now();
    task.child = null;
    try { win?.webContents.send("bgtask:update", { id, status: "exited", exitCode: task.exitCode, command }); } catch {}
    for (const l of bgTaskListeners) { try { l.exit?.(task); } catch {} }
  });
  child.on("error", (err) => {
    task.status = "error";
    task.error = err.message;
    task.endedAt = Date.now();
    task.child = null;
    try { win?.webContents.send("bgtask:update", { id, status: "error", error: err.message, command }); } catch {}
  });
  return { id, command, status: task.status, startedAt: task.startedAt };
}

function bgTaskView(id, tailLines = 80) {
  const t = backgroundTasks.get(id);
  if (!t) return null;
  const output = t.output.slice(-tailLines).map((o) => o.line).join("\n").slice(-MAX_OUTPUT_CHARS);
  return {
    id: t.id,
    command: t.command,
    status: t.status,
    exitCode: t.exitCode,
    error: t.error,
    runningMs: (t.endedAt || Date.now()) - t.startedAt,
    totalLines: t.output.length,
    output,
  };
}

function listBgTasks() {
  return [...backgroundTasks.values()].map((t) => ({
    id: t.id,
    command: t.command.length > 90 ? t.command.slice(0, 90) + "…" : t.command,
    status: t.status,
    exitCode: t.exitCode,
    lines: t.output.length,
    runningMs: (t.endedAt || Date.now()) - t.startedAt,
  }));
}

// Tasks run under `shell: true`, so the child is a cmd.exe or sh wrapper and killing it leaves the
// real command — a dev server, a watcher — running. Windows compounds that by not killing children
// when their parent exits, so those survivors kept the install directory locked and an update could
// not replace the previous version.
function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill();
  } catch {}
}

function stopBgTask(id) {
  const t = backgroundTasks.get(id);
  if (!t) return { ok: false, error: "No task with id " + id };
  if (!t.child) return { ok: false, error: "Task " + id + " already " + t.status };
  try {
    killTree(t.child);
    t.status = "stopped";
    t.endedAt = Date.now();
    return { ok: true, id, status: "stopped" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// quitAndInstall quits the app and hands over to the installer, so this is the last chance to clear
// away anything still holding files open.
app.on("before-quit", () => {
  for (const t of backgroundTasks.values()) if (t.child) killTree(t.child);
});

ipcMain.handle("bgtask:list", () => listBgTasks());
ipcMain.handle("bgtask:start", (_e, root, command) => startBackgroundTask(root || os.homedir(), String(command || "").trim()));
ipcMain.handle("bgtask:get", (_e, id) => bgTaskView(id, 300));
ipcMain.handle("bgtask:stop", (_e, id) => stopBgTask(id));

// Drives the branch chip in the header. A project that isn't a git repo just reports
// `repo: false` and the chip stays hidden — not an error worth surfacing.
ipcMain.handle("git:status", async (_e, root) => {
  const branch = await runCommand(root, "git rev-parse --abbrev-ref HEAD");
  if (branch.exitCode !== 0) return { repo: false };
  const [porcelain, counts] = await Promise.all([
    runCommand(root, "git status --porcelain"),
    runCommand(root, "git rev-list --left-right --count @{upstream}...HEAD"),
  ]);
  const dirty = porcelain.stdout.trim().split("\n").filter(Boolean).length;
  // No upstream yet (a brand-new branch) — nothing to compare against, so report zero rather
  // than treating the failed command as unknown state.
  const [behind, ahead] = counts.exitCode === 0
    ? counts.stdout.trim().split(/\s+/).map((n) => Number(n) || 0)
    : [0, 0];
  return { repo: true, branch: branch.stdout.trim(), dirty, ahead, behind, hasUpstream: counts.exitCode === 0 };
});

// Local branches, current one flagged — for the branch switcher. Uses plain `git branch` rather
// than a --format string: on Windows cmd.exe eats the % in a --format=%(...) placeholder and the
// command comes back empty. The plain output ("* current", "  other") parses the same everywhere.
ipcMain.handle("git:branches", async (_e, root) => {
  const res = await runCommand(root, "git branch --no-color");
  if (res.exitCode !== 0) return { repo: false, branches: [] };
  const branches = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    // A detached HEAD shows as "(HEAD detached at …)" — skip that pseudo-branch.
    .filter((l) => !/^\*?\s*\(/.test(l))
    .map((l) => ({ name: l.replace(/^\*\s*/, "").trim(), current: l.startsWith("*") }));
  return { repo: true, branches, current: (branches.find((b) => b.current) || {}).name || null };
});

// Switch branches. A dirty tree makes git refuse when the change would be clobbered, so surface
// that plainly rather than forcing it — the user's uncommitted work is never discarded here.
ipcMain.handle("git:switch-branch", async (_e, root, name) => {
  if (!name) return { ok: false, error: "No branch given" };
  const res = await runCommand(root, `git checkout ${shellQuote(name)}`);
  if (res.exitCode !== 0) {
    const detail = (res.stderr || res.stdout || "Could not switch branch").trim();
    if (/local changes|would be overwritten|commit your changes or stash/i.test(detail)) {
      return { ok: false, error: "You have uncommitted changes that would be lost. Commit or stash them first, then switch.", dirty: true };
    }
    return { ok: false, error: detail.slice(0, 300) };
  }
  return { ok: true, branch: name };
});

// Porcelain's two status columns are index-then-worktree, so a file can be partly staged.
const GIT_STATUS_LABEL = {
  M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", U: "conflicted", "?": "untracked",
};

ipcMain.handle("git:changes", async (_e, root) => {
  const res = await runCommand(root, "git status --porcelain=v1 -z");
  if (res.exitCode !== 0) return { ok: false, error: "Not a git repository." };
  const files = [];
  // -z output is NUL-separated, which is the only way to survive paths containing spaces or
  // quotes. Renames emit a second NUL-terminated field for the old path.
  const parts = res.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry || entry.length < 4) continue;
    const index = entry[0];
    const work = entry[1];
    const filePath = entry.slice(3);
    if (index === "R" || index === "C") i++; // skip the paired old-path field
    files.push({
      path: filePath,
      staged: index !== " " && index !== "?",
      label: GIT_STATUS_LABEL[index !== " " && index !== "?" ? index : work] || "changed",
      untracked: index === "?",
    });
  }
  return { ok: true, files };
});

// Quote for the shell rather than interpolating raw: project paths routinely contain spaces,
// and on Windows they contain backslashes that must not be treated as escapes.
function shellQuote(p) {
  return `"${String(p).replace(/(["$`\\])/g, "\\$1")}"`;
}

ipcMain.handle("git:commit", async (_e, { root, paths, message }) => {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return { ok: false, error: "Select at least one file to commit." };
  if (!String(message || "").trim()) return { ok: false, error: "Write a commit message first." };

  const add = await runCommand(root, `git add -- ${list.map(shellQuote).join(" ")}`);
  if (add.exitCode !== 0) return { ok: false, error: (add.stderr || "git add failed").slice(0, 400) };

  // Passed via stdin so newlines, quotes and backticks in the message survive intact.
  const commit = await new Promise((resolve) => {
    const child = exec(`git commit -F -`, { cwd: root, timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ exitCode: error ? (error.code ?? 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") })
    );
    child.stdin.end(String(message));
  });
  if (commit.exitCode !== 0) {
    return { ok: false, error: (commit.stderr || commit.stdout || "git commit failed").slice(0, 400) };
  }
  return { ok: true, output: commit.stdout.trim().slice(0, 300) };
});

// Unified diff for one file (staged + unstaged, vs the last commit) so the code panel can show
// what actually changed — added/removed lines — instead of just the current file contents. A
// brand-new untracked file has no HEAD to diff against, so it comes back as all-added.
ipcMain.handle("git:diff-file", async (_e, root, relPath) => {
  const q = shellQuote(relPath);
  const res = await runCommand(root, `git diff HEAD -- ${q}`);
  const diff = (res.stdout || "").replace(/\s+$/, "");
  if (diff.trim()) return { diff, hasChanges: true, untracked: false };
  const st = await runCommand(root, `git status --porcelain -- ${q}`);
  if (/^\?\?/.test((st.stdout || "").trim())) {
    try {
      const content = await fs.readFile(path.join(root, relPath), "utf8");
      const synth = "@@ new file @@\n" + content.replace(/\n$/, "").split("\n").map((l) => "+" + l).join("\n");
      return { diff: synth, hasChanges: true, untracked: true };
    } catch {}
  }
  return { diff: "", hasChanges: false };
});

ipcMain.handle("git:push", async (_e, root) => {
  const remotes = await runCommand(root, "git remote");
  if (!remotes.stdout.trim()) {
    return { ok: false, error: "This repository has no remote. Add one first:\n\ngit remote add origin <url>" };
  }
  const upstream = await runCommand(root, "git rev-parse --abbrev-ref @{upstream}");
  // A branch that has never been pushed has no upstream, and a bare `git push` fails telling
  // you to set one — so set it here instead of surfacing that as an error.
  const branch = (await runCommand(root, "git rev-parse --abbrev-ref HEAD")).stdout.trim();
  const remote = remotes.stdout.trim().split("\n")[0].trim();
  const cmd = upstream.exitCode === 0 ? "git push" : `git push -u ${shellQuote(remote)} ${shellQuote(branch)}`;

  const res = await runCommand(root, cmd);
  if (res.exitCode !== 0) {
    const detail = (res.stderr || res.stdout || "git push failed").slice(0, 400);
    if (/Repository not found|403|denied|authentication/i.test(detail)) {
      return { ok: false, error: `${detail}\n\nThe remote rejected this — usually the repo URL is wrong or the credentials on this machine don't have access to it.` };
    }
    // Non-fast-forward: the branch is behind its remote (someone else pushed, or the same repo
    // is open elsewhere). Rather than dumping git's "Updates were rejected… integrate the remote
    // changes" hint on the user, do what they'd do by hand — rebase onto the remote and retry.
    if (/rejected|non-fast-forward|fetch first|tip of your current branch is behind|behind its remote/i.test(detail)) {
      // --autostash so a partial commit (staged some files, left others modified) doesn't block
      // the rebase with "cannot pull with rebase: you have unstaged changes" — git stashes the
      // rest, rebases, and restores it.
      const pull = await runCommand(root, "git pull --rebase --autostash");
      if (pull.exitCode !== 0) {
        // Conflicts. Don't leave the repo mid-rebase — abort and explain.
        await runCommand(root, "git rebase --abort");
        const why = (pull.stderr || pull.stdout || "").slice(0, 300);
        return {
          ok: false,
          error: `Your branch is behind the remote and the changes can't be merged automatically:\n\n${why}\n\nPull and resolve the conflicts (or commit/stash local changes) manually, then push again.`,
        };
      }
      const retry = await runCommand(root, cmd);
      if (retry.exitCode !== 0) {
        return { ok: false, error: (retry.stderr || retry.stdout || "git push failed after integrating remote changes").slice(0, 400) };
      }
      return { ok: true, output: `Remote had newer commits — pulled and rebased, then pushed.\n${(retry.stderr || retry.stdout || "").trim().slice(0, 240)}` };
    }
    return { ok: false, error: detail };
  }
  return { ok: true, output: (res.stderr || res.stdout || "").trim().slice(0, 300) };
});

// ---------- AgentBridge MITM Proxy ----------

ipcMain.handle("mitm:status", async () => {
  try {
    return await mitmManager.getStatus();
  } catch (err) {
    return { running: false, error: err.message };
  }
});

ipcMain.handle("mitm:detect-agents", async () => {
  try {
    return mitmManager.detectAgents();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("mitm:start", async (_e, payload = {}) => {
  try {
    const store = await readStore();
    const nutaanKey = payload.nutaanKey || store.nutaanKey || "";
    const agentMap  = payload.agentMap  || (store.agentBridge ? store.agentBridge.agentMap : undefined) || {};
    // Ensure the local gateway is running so intercepted traffic can be routed internally
    await gatewayManager.start({ port: 20128 });
    const result = await mitmManager.start({
      nutaanKey,
      nutaanBaseUrl: "http://127.0.0.1:20128",
      agentMap,
      userBypass: payload.userBypass || [],
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("mitm:stop", async () => {
  try {
    const result = await mitmManager.stop();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- Nutaan OmniRoute Gateway Handlers ----------

ipcMain.handle("gateway:status", async () => {
  try {
    return gatewayManager.getStatus();
  } catch (err) {
    return { running: false, error: err.message };
  }
});

ipcMain.handle("gateway:start", async (_e, options = {}) => {
  try {
    return await gatewayManager.start(options);
  } catch (err) {
    return { status: "error", error: err.message };
  }
});

ipcMain.handle("gateway:stop", async () => {
  try {
    return gatewayManager.stop();
  } catch (err) {
    return { status: "error", error: err.message };
  }
});

ipcMain.handle("gateway:get-models", async () => {
  try {
    return gatewayManager.getModels();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("gateway:save-config", async (_e, config) => {
  try {
    return await gatewayManager.saveConfig(config);
  } catch (err) {
    return { status: "error", error: err.message };
  }
});

// ---------- Agent loop (tool-calling) ----------

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders at a path relative to the project root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path, use '.' for project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a file relative to the project root. Returns numbered lines. For a large file, page through it with offset and limit instead of re-reading the whole thing — the response tells you the total line count and whether more remains.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number", description: "1-based line to start at (default 1)" },
          limit: { type: "number", description: "How many lines to return (default 800)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "List available skills — reusable instruction packs for specific kinds of tasks (code review, debugging, writing commit messages, etc). Check this when a task matches one of these areas before improvising your own approach.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "use_skill",
      description: "Load the full instructions for a skill by id (from list_skills) and follow them for the current task.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search file contents for a text or regex pattern across the project (like grep). Returns matching file:line results.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
          path: { type: "string", description: "Relative path to search within, default '.'" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a file or overwrite it entirely with new content. Requires user approval.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace one exact, unique occurrence of old_string with new_string in an existing file. Prefer this over write_file for existing files. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Open a URL in the app's built-in browser panel, for testing web apps or looking things up. Prefer this over run_command with a shell 'open'/'start' command.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_read_page",
      description: "Read the built-in browser panel's current page: its URL, title, visible text, a list of interactive elements (links, buttons, inputs) each with its label and a ready-to-use CSS selector, AND any native dialogs the page popped (alert/confirm/prompt text — e.g. 'Invalid username or password'). Call this to understand a page before acting, and always after submitting a form/login to see the result. Click/type using a selector it returns instead of guessing one.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description: "Click an element in the built-in browser panel, identified by a CSS selector (e.g. 'button.submit', '#login-btn', 'a[href=\"/contact\"]'). Use browser_read_page or browser_screenshot first if you need to figure out the right selector.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_type",
      description: "Type text into an input/textarea in the built-in browser panel, identified by a CSS selector. Set submit:true to also submit its form afterward (e.g. for a login form).",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["selector", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_scroll",
      description: "Scroll the page in the built-in browser panel.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          amount: { type: "number", description: "Pixels to scroll, default 600" },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_screenshot",
      description: "Take a screenshot of what's currently visible in the built-in browser panel and look at it. Works on any model — if you can't see images yourself, a vision model describes the screenshot and you get the description back. Use this to actually check how something you built looks, rather than asking the user to go and look.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_resize",
      description: "Switch the built-in browser panel's preview frame to a device size, to test responsive layouts.",
      parameters: {
        type: "object",
        properties: { size: { type: "string", enum: ["mobile", "tablet", "desktop"] } },
        required: ["size"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_execute_script",
      description: "Run arbitrary JavaScript in the page currently open in the built-in browser panel and return its result. General-purpose escape hatch for anything browser_click/type/scroll can't do (e.g. reading computed styles, complex multi-step DOM queries, dispatching custom events, calling fetch()). Requires user approval since it can do anything on that page.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "One or more JS statements, executed inside an async function body — use 'return <value>;' to send back a result, and 'await' works directly. Errors are caught and returned to you instead of failing silently.",
          },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a URL (e.g. a docs page the user gave you) and return its readable text content. Use this whenever the user hands you a link, or you need the actual content of a page you found — don't guess at what a URL contains.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "os_search",
      description:
        "Find a file or folder anywhere on this computer by name — outside the project, across Desktop, Documents, Downloads, Pictures, Music and Videos. Use this when the user refers to a document, photo or download that isn't part of the open project. Results are newest-first.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of the file or folder name" },
          path: { type: "string", description: "Optional folder to search inside, e.g. '~/Downloads' or an absolute path" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "os_read",
      description:
        "Read any file on this computer by absolute path, ~-path, or a home-relative path like 'Downloads/notes.txt'. Text files come back as text; Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF, and email (.eml/.mbox/.msg) files have their text/data extracted so you can read them directly (a spreadsheet comes back as tab-separated rows; an email as its From/To/Subject/Date plus body); images come back viewable; folders list their contents. Use this to read the user's real documents, data and emails. For a type that can't be read, use os_open instead.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          limit: { type: "number", description: "Max lines for a text file (default 600)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "os_open",
      description:
        "Open a file, folder or URL in whatever application the system normally uses for it — a PDF in the PDF viewer, a folder in the file manager. Works on Windows, macOS and Linux. Requires user approval.",
      parameters: {
        type: "object",
        properties: { target: { type: "string", description: "Path or URL to open" } },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "os_launch_app",
      description:
        "Launch a desktop application by name — 'Notepad', 'Visual Studio Code', 'Safari', 'firefox'. Requires user approval.",
      parameters: {
        type: "object",
        properties: { app: { type: "string", description: "Application name as the system knows it" } },
        required: ["app"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "os_system_stats",
      description:
        "Read what Task Manager (Windows) or Activity Monitor (macOS) shows: live CPU usage overall and per core, RAM used vs free, the 15 busiest programs by CPU and memory, free disk space per drive, system uptime, and Nutaan Code's own CPU and memory broken down by internal process. Use this whenever the user asks how much CPU or memory something is using, why the machine or the app feels slow, what is running, or how much disk space is left. Takes about a second, because CPU has to be sampled over an interval to mean anything. Read-only.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "os_kill_process",
      description:
        "Close a running program on this computer — the same thing as End Task in Task Manager, Quit in Activity Monitor, or kill on Linux. Works on Windows, macOS and Linux. Give either a pid (from os_system_stats) or a program name; a name closes every process with that name, and on Windows their child processes too. Asks politely first, so pass force:true only if the program ignored that and the user wants it terminated outright. Critical operating-system processes and Nutaan Code's own processes are always refused. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          pid: { type: "number", description: "Process id to close — preferred, since it is unambiguous." },
          name: { type: "string", description: "Program name instead of a pid, e.g. 'chrome' or 'Spotify'." },
          force: { type: "boolean", description: "Terminate immediately instead of asking the program to quit. Unsaved work in that program is lost." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for things you don't know or that may have changed: library docs, error messages, API changes, package comparisons, current versions. Returns titles, URLs and snippets from Stack Overflow, GitHub, npm, Wikipedia and Hacker News. Follow up with web_fetch on any URL worth reading in full. Use this instead of guessing at an API you're unsure about.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for, in plain words" },
          sources: {
            type: "array",
            description: "Restrict to specific sources. Omit to search all of them.",
            items: { type: "string", enum: ["stackoverflow", "github", "npm", "wikipedia", "hackernews"] },
          },
          limit: { type: "number", description: "Results per source (default 5, max 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "map_route",
      description:
        "Get the real driving route between places and show it on a map. Give the stops in order (e.g. [\"Mumbai\", \"Puri\", \"Gangasagar\"]) and it geocodes each, draws the route on a map for the user, and returns the total distance and time plus the distance and time of each leg. Use it for any trip or itinerary so the distances are real, not guessed. Free — no key needed.",
      parameters: {
        type: "object",
        properties: {
          stops: { type: "array", items: { type: "string" }, description: "Place names in travel order, at least two" },
          mode: { type: "string", enum: ["driving"], description: "Only driving is supported for now" },
        },
        required: ["stops"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task_write",
      description:
        "Record your plan as a checklist and keep it updated as you work. Use it for any request with more than about three steps, or any long instruction with several distinct parts — it is how the user sees what you intend to do and what is left. Send the WHOLE list every time, with each item's current status. Mark exactly one item in_progress while you work on it, and flip it to completed the moment it is genuinely done rather than batching updates at the end.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "The complete task list, in order",
            items: {
              type: "object",
              properties: {
                task: { type: "string", description: "Short imperative description, e.g. 'Add the rate-limit middleware'" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["task", "status"],
            },
          },
        },
        required: ["tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_add",
      description: "Index a page or a block of text into the user's knowledge base so it can be recalled by meaning in this and every future chat. Use it when you find reference material worth keeping — API docs, a spec, a changelog the user pointed you at — rather than re-fetching it every time. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Page to fetch and index. Give this or text, not both." },
          text: { type: "string", description: "Raw text to index. Give this or url, not both." },
          title: { type: "string", description: "Short label for the entry; taken from the page title if omitted" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_search",
      description: "Search the user's knowledge base — reference material they indexed themselves (docs pages, specs, pasted notes) — by meaning rather than keyword. Use it whenever the answer might depend on their own material rather than general knowledge or this project's code.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What you want to know, phrased as a question or topic" },
          limit: { type: "number", description: "How many passages to return (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_image",
      description: "Look at an image file in the project (e.g. a logo or screenshot the user added, or one you just generated). Works on any model — if you can't see images yourself, a vision model describes it and you get the description back.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image from a text prompt and save it as a file in the project (e.g. a hero image, an icon, a placeholder photo). Only works if the user has configured an image model in Settings — if this fails saying none is configured, tell the user to add one rather than retrying. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description of the image to generate" },
          path: { type: "string", description: "Where to save it, relative to the project root, e.g. 'assets/hero.png'" },
        },
        required: ["prompt", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the project root (60s timeout). Requires user approval. For long-running or never-ending commands (dev servers, watchers, long builds/tests), use run_background instead — this one will time out at 60s.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_background",
      description: "Start a long-running or never-ending shell command in the BACKGROUND and return immediately with a task id, without blocking the turn. Use this for dev servers (npm run dev), build watchers, long test suites, installs, or any command that takes a while or runs indefinitely. Keep working while it runs, then read its output with check_background_task. Requires user approval.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command to run in the background, from the project root." } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_background_task",
      description: "Read the current status and recent output of a background task started with run_background. Returns whether it is still running or has exited (with its exit code) and the latest output lines. Call this to see a dev server's logs, a build's progress, or a finished task's result.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The background task id returned by run_background (e.g. 'bg1')." },
          lines: { type: "number", description: "How many recent output lines to return (default 80)." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_background_tasks",
      description: "List all background tasks started this session with their id, command, status (running/exited/stopped) and exit code.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_background_task",
      description: "Stop (kill) a running background task by id — e.g. to shut down a dev server you started. Requires user approval.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The background task id to stop (e.g. 'bg1')." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cleanup_storage",
      description: "Free up disk space by clearing Nutaan Code's own regenerable junk — the auto-update download cache (which stacks up old installers), the app's HTTP/GPU caches, redundant legacy caches, and stale temp files. It NEVER touches your settings, chats, knowledge base, memory, or saved browser logins. Pass dry_run:true first to preview exactly what would be removed and how much space it frees, then call it again to actually clean.",
      parameters: {
        type: "object",
        properties: {
          dry_run: { type: "boolean", description: "If true, only report what would be cleaned and how many MB it would free — delete nothing." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_list",
      description: "List your persistent memory entries (shared across every project, not just this one) with their id, type, and one-line description. A summary of these is already given to you at the start of each conversation — call this only if you need the full up-to-date list, e.g. after writing a new one.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_read",
      description: "Read the full content of one memory entry by id (from memory_list or the memory summary you were given).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_write",
      description: "Create or overwrite one persistent memory entry, visible in every project from now on. Requires user approval. Use short kebab-case ids (e.g. 'user-prefers-typescript', 'feedback-no-inline-comments'). Only save durable, cross-project-worthy facts — not routine details of the current task.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short kebab-case identifier, e.g. 'user-role' or 'feedback-testing-style'" },
          type: { type: "string", enum: ["user", "feedback", "project", "reference"], description: "user: who they are/how they work. feedback: corrections or confirmed approaches. project: facts about ongoing work. reference: pointers to external systems." },
          description: { type: "string", description: "One-line summary shown in the memory index" },
          content: { type: "string", description: "The memory body in markdown" },
        },
        required: ["id", "type", "description", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_search_tools",
      description:
        "Search the built-in 753+ tool OSINT, threat intelligence, and security arsenal. ALWAYS call this tool whenever the user asks for tools, cyber tools, OSINT tools, dark web tools, breach monitors, ransomware scanners, infostealer lookups, recon tools, or asks 'find tools in the arsenal'. NEVER use search_files or list_dir when asked to find tools.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query, target type, or tool name (e.g. 'ransomware', 'infostealer', 'dark web', 'breach', 'subdomain', 'sherlock', 'whois')" },
          category: { type: "string", description: "Filter by category name: domain-ip-network, username-social, data-breach, malware-threat-intel, red-team-offensive, dark-web, people-identity, search-dorking, etc." },
          method: { type: "string", description: "Filter by execution/install method: web, git, pip, go, apt, docker" },
          limit: { type: "number", description: "Max results to return (default 25)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_dns_recon",
      description:
        "Perform native DNS enumeration and security policy checking on a domain name (resolves A, AAAA, MX, NS, TXT, CNAME, SOA, and checks for valid SPF and DMARC email spoofing protections). Zero external setup required.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Target domain name, e.g. 'example.com'" },
        },
        required: ["domain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_ip_lookup",
      description:
        "Look up IP intelligence, geolocation, autonomous system (ASN), ISP, organization, and reverse DNS for an IP address or hostname. Zero external setup required.",
      parameters: {
        type: "object",
        properties: {
          ip: { type: "string", description: "Target IP address or hostname" },
        },
        required: ["ip"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_subdomain_enum",
      description:
        "Perform passive subdomain enumeration for a domain via Certificate Transparency logs (crt.sh). Discovers active and historical subdomains, staging servers, and exposed services. Zero external setup required.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Target domain name, e.g. 'example.com'" },
        },
        required: ["domain"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_http_recon",
      description:
        "Perform deep live HTTP security reconnaissance on a target URL or domain. Audits security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options), inspects server disclosure, performs in-depth COOKIE VULNERABILITY ANALYSIS (extracts Set-Cookie headers, flags missing HttpOnly, missing Secure, and insecure SameSite), and scans for credential/secret leaks in the page. ALWAYS call this tool directly whenever the user asks to check, find, or audit cookies, credentials, security headers, or vulnerabilities on a website/URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL or domain, e.g. 'https://example.com' or 'https://www.getfreed.ai/'" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osint_dork_generator",
      description:
        "Perform defensive exposure and leak audits on an authorized domain. Generates audit search queries (Google, GitHub, Shodan) to verify whether sensitive files (.env, logs, configuration), admin portals, or accidental secret leaks have been indexed publicly, enabling immediate access-control and robots.txt remediation.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Target domain or entity name to audit, e.g. 'example.com'" },
          type: {
            type: "string",
            enum: ["all", "admin", "files", "directory", "secrets", "shodan"],
            description: "Category of audit queries: admin portals, sensitive files, directory listings, secrets/credentials, shodan recon, or all.",
          },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vuln_static_scan",
      description:
        "Perform instant, zero-GPU static vulnerability analysis across the local project or specific file. Checks for SQL Injection (CWE-89), Command Injection (CWE-78), hardcoded secrets/AWS keys (CWE-798), Path Traversal (CWE-22), unsafe eval (CWE-94), deserialization, and insecure CORS/TLS configurations. Runs locally in milliseconds with 100% deterministic reliability.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to file or directory to scan (default '.' for entire project root)" },
        },
      },
    },
  },
];

// Tools for the autonomous layer: scheduled workers, the swarm, the self-healing loop. The chat
// sees the worker/swarm ones so "every morning at 8 check the weather" or "launch my SaaS" can
// be set up from a sentence; heal_step only exists inside a repair run.
const EXTRA_TOOLS = [
  {
    type: "function",
    function: {
      name: "worker_create",
      description:
        "Create a scheduled worker: a job Nutaan runs on its own at a set time or interval (a morning briefing, 'did any new RERA project get registered today', a stock price every hour, the weather, a site uptime check) and posts to the Updates feed with a desktop notification. Use when the user asks for something recurring, 'every morning', 'each day at', 'every hour', 'remind/tell/update me'. Write the prompt as instructions to a worker that will do the real lookup with web/browser tools and report facts with sources.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name, e.g. 'Morning briefing', 'RERA new projects'" },
          icon: { type: "string", description: "One emoji" },
          prompt: { type: "string", description: "What the worker must do and report, written for an unattended agent. Include cities, tickers, portals, URLs, thresholds the user mentioned." },
          schedule_type: { type: "string", enum: ["daily", "interval", "once", "project-open", "app-start"], description: "daily at a time, interval every N minutes, once at a datetime, when this project opens, when the app starts" },
          time: { type: "string", description: "HH:MM 24h local time, for daily" },
          days: { type: "array", items: { type: "integer" }, description: "For daily: weekdays to run, 0=Sunday…6=Saturday. Empty = every day." },
          every_minutes: { type: "integer", description: "For interval" },
          at: { type: "string", description: "ISO datetime, for once" },
          use_project: { type: "boolean", description: "true if the worker should run inside the currently open project (needed for git/test/code tasks)" },
          allow_changes: { type: "boolean", description: "true only if the worker must edit files or run commands; default false (look-only)" },
        },
        required: ["name", "prompt", "schedule_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "worker_list",
      description: "List the user's scheduled workers with their schedule, last run and last headline, and the most recent updates they produced.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "worker_update",
      description: "Change a scheduled worker: enable/disable it, or change its name, prompt, schedule or permissions. Pass only the fields to change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          enabled: { type: "boolean" },
          name: { type: "string" },
          prompt: { type: "string" },
          schedule_type: { type: "string", enum: ["daily", "interval", "once", "project-open", "app-start"] },
          time: { type: "string" },
          days: { type: "array", items: { type: "integer" } },
          every_minutes: { type: "integer" },
          allow_changes: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "worker_delete",
      description: "Delete a scheduled worker by id.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "worker_run_now",
      description: "Run a scheduled worker immediately (in the background) and return; its update will appear in the Updates feed when done.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "swarm_launch",
      description:
        "Hand a large, multi-part outcome to Nutaan Swarm — a team of agents (Planner, Developer, Browser QA, Researcher, Reviewer, DevOps) that splits the goal, works in parallel, shares findings and merges a final report. Use for outcome-sized asks ('launch my SaaS', 'fix production', 'research my competitors', 'deploy this') rather than one-file edits. Returns at once; progress shows in the Swarm panel. After launching, tell the user it is running and stop — do not also attempt the work yourself.",
      parameters: { type: "object", properties: { goal: { type: "string", description: "The outcome wanted, with any constraints the user stated" } }, required: ["goal"] },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_health",
      description: "Read the Self-Healing Workspace state: monitoring mode, open incidents (crashes, failing tests, a dead health URL, browser errors) with their evidence and repair stages. Optionally run the project's health checks now.",
      parameters: { type: "object", properties: { check_now: { type: "boolean", description: "Also run the test command and health URL now" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "heal_step",
      description: "(Repair runs only) Report progress through the repair loop so the user sees it live: stage is one of reproduce, diagnose, patch, test, deploy, verify.",
      parameters: {
        type: "object",
        properties: {
          stage: { type: "string", enum: ["reproduce", "diagnose", "patch", "test", "deploy", "verify"] },
          status: { type: "string", enum: ["in_progress", "done", "skipped", "failed"] },
          note: { type: "string", description: "One line: what you found / did / why skipped" },
        },
        required: ["stage", "status"],
      },
    },
  },
];
const HEADLESS_ONLY_TOOLS = new Set(["heal_step"]);

const URL_OPEN_PATTERN = /^\s*(start|open|xdg-open|cmd(\.exe)?\s*\/c\s*start)\s+["']?(https?:\/\/)/i;

// gpt-oss models speak the "harmony" format and sometimes leak its channel markers into the
// tool name (e.g. `run_command<|channel|>commentary`), which then fails as an unknown tool.
function cleanToolName(call) {
  return String(call?.function?.name || "").split("<|")[0].replace(/[^\w.-]/g, "").trim();
}

function parseToolArgs(call) {
  try {
    return JSON.parse(call?.function?.arguments || "{}");
  } catch {
    return {};
  }
}

// Pure reads: no approval gate, no ordering constraints, no shared mutable target — so a batch
// of them can run at once rather than one after another. Reading five files or fetching three
// pages now costs one round trip instead of five.
//
// Browser tools are excluded despite being "safe": they all drive the one shared browser panel,
// so running them concurrently would interleave navigation and clicks on the same page. Writes,
// commands and anything needing approval stay sequential too — later steps can depend on
// earlier ones, and approvals have to be answered one at a time.
const PARALLEL_TOOLS = new Set([
  "list_dir",
  "read_file",
  "search_files",
  "list_skills",
  "use_skill",
  "memory_list",
  "memory_read",
  "web_fetch",
  "web_search",
  "map_route",
  "os_search",
  "os_read",
  "os_system_stats",
  "kb_search",
  "view_image",
]);

const SAFE_TOOLS = new Set([
  "list_dir",
  "read_file",
  "search_files",
  "list_skills",
  "use_skill",
  "browser_navigate",
  "browser_read_page",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_screenshot",
  "browser_resize",
  "memory_list",
  "memory_read",
  "web_fetch",
  "web_search",
  "os_search",
  "os_read",
  "os_system_stats",
  "kb_search",
  "task_write",
  "view_image",
  "check_background_task",
  "list_background_tasks",
  "osint_search_tools",
  "osint_dns_recon",
  "osint_ip_lookup",
  "osint_subdomain_enum",
  "osint_http_recon",
  "osint_dork_generator",
  "vuln_static_scan",
  "worker_list",
  "workspace_health",
  "swarm_launch",
  // browser_execute_script, memory_write, and generate_image are deliberately NOT in this list — they require approval.
]);
const SEARCH_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
const MAX_SEARCH_MATCHES = 200;
const MAX_SEARCH_FILES = 3000;

async function searchFiles(root, startRel, pattern) {
  let re;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const results = [];
  let filesScanned = 0;

  async function walk(relDir) {
    if (results.length >= MAX_SEARCH_MATCHES || filesScanned >= MAX_SEARCH_FILES) return;
    const dirAbs = resolveSafe(root, relDir);
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SEARCH_SKIP_DIRS.has(entry.name)) continue;
      const childRel = relDir === "." ? entry.name : relDir + "/" + entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else {
        if (filesScanned >= MAX_SEARCH_FILES || results.length >= MAX_SEARCH_MATCHES) return;
        filesScanned++;
        try {
          const stat = await fs.stat(resolveSafe(root, childRel));
          if (stat.size > 500_000) continue;
          const content = await fs.readFile(resolveSafe(root, childRel), "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              results.push({ file: childRel, line: i + 1, text: lines[i].trim().slice(0, 200) });
              if (results.length >= MAX_SEARCH_MATCHES) return;
            }
          }
        } catch {
          // skip unreadable/binary files
        }
      }
    }
  }

  await walk(startRel || ".");
  return { matches: results, truncated: results.length >= MAX_SEARCH_MATCHES };
}

function requestPermission(sender, id, payload) {
  return new Promise((resolve) => {
    pendingPermissions.set(id, resolve);
    sender.send("agent:permission-request", { id, ...payload });
  });
}

ipcMain.on("agent:permission-response", (_e, { id, approved }) => {
  const resolve = pendingPermissions.get(id);
  if (resolve) {
    resolve(approved);
    pendingPermissions.delete(id);
  }
});

function requestBrowserAction(sender, id, payload) {
  return new Promise((resolve) => {
    pendingBrowserActions.set(id, resolve);
    sender.send("agent:browser-action", { id, ...payload });
    setTimeout(() => {
      if (pendingBrowserActions.has(id)) {
        pendingBrowserActions.delete(id);
        resolve({ ok: false, error: "Timed out waiting for the browser panel" });
      }
    }, BROWSER_ACTION_TIMEOUT_MS);
  });
}

ipcMain.on("agent:browser-action-response", (_e, { id, result }) => {
  const resolve = pendingBrowserActions.get(id);
  if (resolve) {
    resolve(result);
    pendingBrowserActions.delete(id);
  }
});

// How many checklist items the model last reported as unfinished. Read after a turn ends with
// no tool call, to tell "I'm done" apart from "I stopped halfway". Keyed by sender because
// headless runs (workers, swarm agents, the healer) run alongside the interactive chat, each
// with its own checklist.
const openTaskCounts = new WeakMap();

async function executeTool(sender, root, name, args, callId, signal, imageConfig) {
  switch (name) {
    case "browser_navigate":
      return requestBrowserAction(sender, callId, { action: "navigate", url: args.url });
    case "browser_read_page":
      return requestBrowserAction(sender, callId, { action: "read" });
    case "browser_click":
      return requestBrowserAction(sender, callId, { action: "click", selector: args.selector });
    case "browser_type":
      return requestBrowserAction(sender, callId, { action: "type", selector: args.selector, text: args.text, submit: !!args.submit });
    case "browser_scroll":
      return requestBrowserAction(sender, callId, { action: "scroll", direction: args.direction, amount: args.amount });
    case "browser_screenshot":
      return requestBrowserAction(sender, callId, { action: "screenshot" });
    case "browser_resize":
      return requestBrowserAction(sender, callId, { action: "resize", size: args.size });
    case "browser_execute_script":
      return requestBrowserAction(sender, callId, { action: "execute", code: args.code });
    case "list_dir":
      return { entries: await fs.readdir(resolveSafe(root, args.path), { withFileTypes: true }).then((es) =>
        es.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => ({ name: e.name, isDir: e.isDirectory() }))) };
    case "read_file": {
      const all = (await fs.readFile(resolveSafe(root, args.path), "utf8")).split("\n");
      // Models pass these as strings often enough that coercing is worth more than rejecting.
      const start = Math.max(1, Number(args.offset) || 1);
      const count = Math.max(1, Number(args.limit) || 800);
      const slice = all.slice(start - 1, start - 1 + count);
      const end = start + slice.length - 1;
      return {
        content: slice.map((l, i) => `${start + i}\t${l}`).join("\n"),
        totalLines: all.length,
        shown: `${start}-${end}`,
        // Stated explicitly: without it a model that receives a truncated file has no way to
        // tell, and either answers from half a file or re-reads the whole thing in a loop.
        hasMore: end < all.length,
        ...(end < all.length ? { nextOffset: end + 1 } : {}),
      };
    }
    case "search_files":
      return searchFiles(root, args.path, args.pattern);
    case "list_skills":
      return { skills: await collectSkills(root) };
    case "use_skill":
      return { instructions: await readSkillBody(root, args.id) };
    case "write_file": {
      const target = resolveSafe(root, args.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, args.content ?? "", "utf8");
      return { ok: true };
    }
    case "edit_file": {
      const target = resolveSafe(root, args.path);
      const content = await fs.readFile(target, "utf8");
      const occurrences = content.split(args.old_string).length - 1;
      if (occurrences === 0) throw new Error("old_string not found in file");
      if (occurrences > 1) throw new Error(`old_string is not unique (${occurrences} matches) — include more context`);
      await fs.writeFile(target, content.replace(args.old_string, args.new_string), "utf8");
      return { ok: true };
    }
    case "web_fetch":
      return webFetch(args.url);
    case "os_search":
      return coWorkerSearch(args.query, args.path);
    case "os_read": {
      const r = await coWorkerRead(args.path, Math.min(Number(args.limit) || 600, 2000));
      // An image read outside the project goes through the same describe-or-show path as
      // view_image, so a text-only model still learns what is in the picture.
      if (r.kind === "image") return { ok: true, ...r };
      return { ok: true, ...r };
    }
    case "os_kill_process":
      return await killProcess(args || {});
    case "os_system_stats":
      return await systemStats();
    case "os_open": {
      const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(args.target) ? args.target : resolveUserPath(args.target);
      const res = await runCommand(root, osOpenCommand(target), signal);
      if (res.exitCode !== 0) return { error: (res.stderr || "Could not open it").slice(0, 300) };
      return { ok: true, opened: target };
    }
    case "os_launch_app": {
      const res = await runCommand(root, osLaunchAppCommand(args.app), signal);
      if (res.exitCode !== 0) return { error: (res.stderr || `Could not launch "${args.app}"`).slice(0, 300) };
      return { ok: true, launched: args.app };
    }
    case "web_search":
      return webSearch(args.query, args.sources, args.limit || 5);
    case "map_route":
      return mapRoute(Array.isArray(args.stops) ? args.stops : []);
    case "task_write": {
      const allowed = new Set(["pending", "in_progress", "completed"]);
      const tasks = (Array.isArray(args.tasks) ? args.tasks : [])
        .map((t) => ({
          task: String(t?.task || "").trim(),
          status: allowed.has(t?.status) ? t.status : "pending",
        }))
        .filter((t) => t.task);
      sender.send("agent:tasks-update", { tasks });
      const completed = tasks.filter((t) => t.status === "completed").length;
      openTaskCounts.set(sender, tasks.length - completed);
      return { ok: true, total: tasks.length, completed, remaining: tasks.length - completed };
    }
    case "kb_add": {
      const entry = await kbIngest(
        { baseUrl: imageConfig.baseUrl, apiKey: imageConfig.apiKey },
        { url: args.url, text: args.text, title: args.title },
        (stage, detail) => sender.send("kb:progress", { stage, ...detail })
      );
      return { ok: true, ...entry, note: "Indexed. Search it later with kb_search." };
    }
    case "kb_search": {
      const matches = await kbSearch(
        { baseUrl: imageConfig.baseUrl, apiKey: imageConfig.apiKey },
        args.query,
        null,
        Math.min(args.limit || 5, 10)
      );
      if (!matches.length) return { ok: true, matches: [], note: "Nothing in the knowledge base matched that." };
      return {
        ok: true,
        matches: matches.map((m) => ({ title: m.title, source: m.source, score: Number(m.score.toFixed(3)), text: m.text })),
      };
    }
    case "view_image": {
      const target = resolveSafe(root, args.path);
      const ext = path.extname(target).slice(1).toLowerCase();
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext];
      if (!mime) throw new Error(`Unsupported image type ".${ext}" — expected png, jpg, gif, or webp`);
      const buffer = await fs.readFile(target);
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
    }
    case "generate_image": {
      let buffer, usedModel;
      if (imageConfig.imageModel) {
        // explicit override: one attempt, full timeout, no silent substitution
        buffer = await generateImage(imageConfig.baseUrl, imageConfig.apiKey, imageConfig.imageModel, args.prompt);
        usedModel = imageConfig.imageModel;
      } else {
        // auto-detected: some backends (e.g. community/queue-based image networks) can
        // legitimately take 1-2 minutes for ANY model — that's normal queue time, not a broken
        // model, so a short per-attempt timeout kills good requests before they finish. Try up to
        // 2 candidates with a genuinely generous timeout each rather than failing fast repeatedly.
        const allModels = await fetchModels(imageConfig.baseUrl, imageConfig.apiKey);
        const candidates = allModels.filter(isImageOnlyModel).slice(0, 2);
        if (candidates.length === 0) throw new Error("No image-generation model is available on this server, and none is configured in Settings.");
        const errors = [];
        for (const candidate of candidates) {
          try {
            buffer = await generateImage(imageConfig.baseUrl, imageConfig.apiKey, candidate.id, args.prompt, 100_000);
            usedModel = candidate.id;
            break;
          } catch (err) {
            errors.push(`${candidate.id}: ${err.message}`);
          }
        }
        if (!buffer) throw new Error(`Tried ${candidates.length} image models, neither succeeded:\n${errors.join("\n")}`);
      }
      const target = resolveSafe(root, args.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      return { ok: true, bytes: buffer.length, model: usedModel };
    }
    case "run_command":
      return runCommand(root, args.command, signal);
    case "run_background":
      return startBackgroundTask(root, args.command);
    case "check_background_task":
      return bgTaskView(args.id, args.lines || 80) || { error: "No background task with id " + args.id };
    case "list_background_tasks":
      return { tasks: listBgTasks() };
    case "stop_background_task":
      return stopBgTask(args.id);
    case "cleanup_storage":
      return cleanupStorage({ dryRun: !!args.dry_run });
    case "memory_list":
      return { entries: await listMemoryEntries() };
    case "memory_read":
      return { content: await fs.readFile(memoryPath(args.id), "utf8") };
    case "memory_write": {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
      const frontmatter = `---\nname: ${args.id}\ntype: ${args.type}\ndescription: ${args.description}\n---\n\n`;
      await fs.writeFile(memoryPath(args.id), frontmatter + (args.content || "").trim() + "\n", "utf8");
      return { ok: true };
    }
    case "osint_search_tools":
      return { tools: arsenal.searchTools(args) };
    case "osint_dns_recon":
      return await arsenal.dnsRecon(args.domain);
    case "osint_ip_lookup":
      return await arsenal.ipLookup(args.ip);
    case "osint_subdomain_enum":
      return await arsenal.subdomainEnum(args.domain);
    case "osint_http_recon":
      return await arsenal.httpRecon(args.url);
    case "osint_dork_generator":
      return arsenal.generateDorks(args.target, args.type);
    case "vuln_static_scan":
      return await arsenal.scanProject(root, args.path || ".");
    case "worker_create": {
      const schedule = workerScheduleFromArgs(args);
      const w = await workers.create({
        name: args.name,
        icon: args.icon,
        prompt: args.prompt,
        schedule,
        root: args.use_project ? root : null,
        readOnly: !args.allow_changes,
      });
      return { ok: true, worker: summariseWorker(w), note: `Created. It will run ${w.scheduleText || describeSchedule(w.schedule)}; results land in the Updates feed (Workers in the sidebar) with a desktop notification.` };
    }
    case "worker_list":
      return { workers: workers.list().map(summariseWorker), recentUpdates: workers.listUpdates(10).map((u) => ({ worker: u.workerName, at: new Date(u.at).toLocaleString(), status: u.status, headline: u.headline })) };
    case "worker_update": {
      const patch = {};
      if (args.enabled != null) patch.enabled = !!args.enabled;
      if (args.name) patch.name = args.name;
      if (args.prompt) patch.prompt = args.prompt;
      if (args.allow_changes != null) patch.readOnly = !args.allow_changes;
      if (args.schedule_type || args.time || args.days || args.every_minutes) {
        const cur = workers.get(args.id)?.schedule || {};
        patch.schedule = workerScheduleFromArgs({ schedule_type: args.schedule_type || cur.type, time: args.time || cur.time, days: args.days || cur.days, every_minutes: args.every_minutes || cur.everyMinutes, at: args.at || cur.at });
      }
      return { ok: true, worker: summariseWorker(await workers.update(args.id, patch)) };
    }
    case "worker_delete":
      return workers.remove(args.id);
    case "worker_run_now":
      return workers.runNow(args.id);
    case "swarm_launch": {
      const { runId } = swarm.start({ goal: args.goal, root, model: settingsCache.model });
      sender.send("swarm:launched", { runId, goal: args.goal });
      return { ok: true, runId, note: "Nutaan Swarm is running this goal in the background. Tell the user it's running and that the team's progress and final report appear in the Swarm panel — then stop; do not do the work yourself." };
    }
    case "workspace_health": {
      if (args.check_now && root) return healer.scan(root);
      return healer.view(root);
    }
    case "heal_step": {
      if (!sender.hooks?.heal_step) return { ok: false, error: "heal_step is only available inside a repair run" };
      return sender.hooks.heal_step(args);
    }
    default:
      // A tool the user configured, rather than one built in.
      if (toolRegistry.owns(name)) return toolRegistry.call(name, args, { root, sender });
      throw new Error(`Unknown tool: ${name}`);
  }
}

function permissionPreview(name, args) {
  if (name === "write_file") return { title: `Write ${args.path}`, detail: args.content };
  if (name === "edit_file")
    return { title: `Edit ${args.path}`, diff: { oldString: args.old_string, newString: args.new_string } };
  if (name === "run_command") return { title: "Run command", detail: args.command };
  if (name === "run_background") return { title: "Run in background", detail: args.command };
  if (name === "cleanup_storage") return { title: "Free up disk space", detail: "Clears Nutaan Code's update-download cache, HTTP/GPU caches and stale temp files. Leaves your settings, chats, knowledge base, memory and saved logins untouched." };
  if (name === "stop_background_task") return { title: `Stop background task ${args.id}`, detail: "Kills the running process." };
  if (name === "browser_execute_script") return { title: "Run script in browser panel", detail: args.code };
  if (name === "memory_write") return { title: `Save memory: ${args.id}`, detail: args.content };
  if (name === "generate_image") return { title: `Generate image: ${args.path}`, detail: args.prompt };
  if (name === "os_kill_process") {
    const who = args.pid != null ? `pid ${args.pid}` : args.name;
    return { title: `Close ${who}`, detail: args.force ? "Terminates it immediately — any unsaved work in that program is lost." : "Asks the program to quit. Unsaved work may be lost." };
  }
  if (name === "os_open") return { title: `Open ${args.target}`, detail: "Opens in the system's default application." };
  if (name === "os_launch_app") return { title: `Launch ${args.app}`, detail: "Starts the application." };
  if (name === "kb_add") {
    return {
      title: `Add to knowledge base: ${args.title || args.url || "pasted text"}`,
      detail: args.url ? `Fetch and index ${args.url}` : String(args.text || "").slice(0, 2000),
    };
  }
  const fromRegistry = toolRegistry.describe(name, args);
  if (fromRegistry) return fromRegistry;
  return { title: name, detail: JSON.stringify(args) };
}

// ---------- Context compaction ----------

function estimateTokens(msgs) {
  let chars = 0;
  for (const m of msgs) {
    if (typeof m.content === "string") chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

function summarizableTranscript(msgs) {
  return msgs
    .map((m) => {
      if (m.role === "tool") return `[tool result: ${String(m.content || "").slice(0, 300)}]`;
      if (m.tool_calls) return `assistant called: ${m.tool_calls.map((t) => t.function?.name).join(", ")}`;
      return `${m.role}: ${String(m.content || "").slice(0, 2000)}`;
    })
    .join("\n");
}

// Last resort when every model is rate-limited or down: if the user has a coding-agent CLI
// connected (Codex, Claude Code), hand the task to it and stream its answer back, rather than
// ending the turn with "all models are busy". Returns true if the handoff produced an answer.
async function tryCliAgentFallback(sender, chatMessages, root, signal) {
  const agent = toolRegistry.firstCliAgent();
  if (!agent) return false;

  // Give the agent the request plus what has happened, so it picks up the task rather than a bare
  // last line. The system prompt (message 0) is skipped — it is this app's tool wiring, not context.
  const context = summarizableTranscript(chatMessages.slice(1)).slice(-12000);
  const prompt =
    "You are being handed a task because the primary models are unavailable. Continue it and give a " +
    "complete answer. Here is the conversation so far:\n\n" + context;

  sender.send("agent:model-switched", { from: "all models", to: agent.def.name, reason: "every model was unavailable — handed to " + agent.def.name });
  sender.send("agent:assistant-delta", { content: `_All models were unavailable, so ${agent.def.name} took over:_\n\n` });

  let res;
  try {
    res = await toolRegistry.callCli(agent, { prompt }, { root, signal });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (!res.ok) {
    sender.send("agent:assistant-delta", { content: `\n(${agent.def.name} could not finish: ${res.error || "unknown error"})` });
    return false;
  }
  sender.send("agent:assistant-delta", { content: res.result });
  chatMessages.push({ role: "assistant", content: `[${agent.def.name}] ${res.result}` });
  sender.send("agent:done", { aborted: false, messages: chatMessages });
  return true;
}

// A tool result is re-sent in full on every remaining iteration of the turn, even though the model
// has already read it and acted on it. The recent ones stay whole; older ones are clipped to their
// head, which is where a directory listing or a command's first error lines actually live. The
// stored conversation is untouched — only what goes over the wire is trimmed.
const KEEP_FULL_TOOL_RESULTS = 6;
const STALE_TOOL_RESULT_CHARS = 900;

function trimStaleToolResults(msgs) {
  let seen = 0;
  let out = null;
  for (let i = msgs.length - 1; i >= 1; i--) {
    const m = msgs[i];
    if (m.role !== "tool") continue;
    if (++seen <= KEEP_FULL_TOOL_RESULTS) continue;
    const c = typeof m.content === "string" ? m.content : "";
    if (c.length <= STALE_TOOL_RESULT_CHARS) continue;
    if (!out) out = msgs.slice();
    out[i] = { ...m, content: c.slice(0, STALE_TOOL_RESULT_CHARS) + `
… [${c.length - STALE_TOOL_RESULT_CHARS} characters trimmed — ask again if you need the rest]` };
  }
  return out || msgs;
}

async function compactIfNeeded(sender, chatMessages, { baseUrl, apiKey, model }) {
  if (estimateTokens(chatMessages) < COMPACT_THRESHOLD_TOKENS) return chatMessages;
  if (chatMessages.length <= KEEP_RECENT_MESSAGES + 2) return chatMessages;

  const systemMsg = chatMessages[0];
  const recent = chatMessages.slice(-KEEP_RECENT_MESSAGES);
  const middle = chatMessages.slice(1, chatMessages.length - KEEP_RECENT_MESSAGES);
  if (middle.length === 0) return chatMessages;

  sender.send("agent:compacting", {});

  try {
    const res = await fetch(buildEndpointUrl(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(baseUrl, apiKey),
      },
      body: JSON.stringify({
        model: model || "auto",
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content:
              "Summarize this coding-session transcript into a compact brief: what the user wants, what's been done (files touched, decisions made, commands run and their outcomes), and any open threads. Be concrete and specific, no filler.",
          },
          { role: "user", content: summarizableTranscript(middle).slice(0, 80_000) },
        ],
      }),
    });
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content;
    if (!summary) throw new Error("empty summary");
    return [systemMsg, { role: "system", content: `Summary of earlier conversation (compacted to save context):\n${summary}` }, ...recent];
  } catch {
    return [systemMsg, { role: "system", content: "(earlier conversation was trimmed to save context)" }, ...recent];
  }
}

// Upstream inference hiccups (provider capacity, rate limits, brief timeouts) should be retried
// automatically rather than killing the whole turn — auth/quota problems (401/403/402) should not,
// since retrying those just wastes time on something a retry can never fix.
// A model that just rate-limited will rate-limit again seconds later — Mistral's free tier is
// about one request a minute, and an agent turn makes many. Without this the fallback chain
// kept selecting the same exhausted model, "switching" into the identical failure. Remembering
// it for a few minutes means the switch lands somewhere that can actually answer.
const modelCooldown = new Map();
const COOLDOWN_MS = 5 * 60_000;

// A capacity failure is any signal that the model is out of headroom right now — not just a
// clean 429. Providers phrase it a dozen ways (Azure "exceeded rate limit", Gemini
// "RESOURCE_EXHAUSTED"/"high demand"/503) and some arrive without a 429 status, so match the
// text too. Missing these let an exhausted model get reselected and hammered again — the exact
// cascade that turned one busy provider into a burst of failing requests across every model.
function isCapacityMessage(message) {
  return /rate.?limit|quota|exceeded|resource_exhausted|overloaded|too many requests|high demand|temporarily unavailable|unavailable|try again later|capacity/i.test(
    message || ""
  );
}

// Providers often say exactly how long to wait ("Please retry in 34.4s", "try again in 35s").
// Honouring that beats retrying in 1s and getting limited again. Returns ms, or null.
function parseRetryAfterMs(message) {
  if (!message) return null;
  const m =
    String(message).match(/retry(?:\s+again)?\s+(?:in|after)\s+([\d.]+)\s*(ms|s|sec(?:onds?)?|m|min(?:utes?)?)?/i) ||
    String(message).match(/try again in\s+([\d.]+)\s*(ms|s|sec(?:onds?)?|m|min(?:utes?)?)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = (m[2] || "s").toLowerCase();
  if (unit === "ms") return Math.round(n);
  if (unit.startsWith("m")) return Math.round(n * 60_000); // minutes
  return Math.round(n * 1000); // seconds
}

function isCapacityFailure(status, message) {
  return status === 429 || status === 503 || isCapacityMessage(message);
}

function coolDownModel(model, status, message) {
  if (!isCapacityFailure(status, message)) return;
  modelCooldown.set(model, Date.now() + COOLDOWN_MS);
}

function isCoolingDown(model) {
  const until = modelCooldown.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldown.delete(model);
    return false;
  }
  return true;
}

// Gemini refuses to replay a tool call that arrives without its thought_signature, and any
// conversation saved before that field was preserved has no way to produce one — so those chats
// would 400 forever, on every retry and every model switch back. The history is still useful as
// a record even when it can't be replayed as tool calls, so unsignable calls are rewritten as
// plain text and their now-orphaned tool results dropped.
function needsThoughtSignature(model) {
  return String(model || "").startsWith("gemini/");
}

function stripUnsignedToolCalls(msgs) {
  const orphaned = new Set();
  const out = [];
  for (const m of msgs) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const unsigned = m.tool_calls.filter((c) => !c.extra_content);
      if (unsigned.length) {
        unsigned.forEach((c) => orphaned.add(c.id));
        const kept = m.tool_calls.filter((c) => c.extra_content);
        const note = unsigned.map((c) => c.function?.name).filter(Boolean).join(", ");
        const content = `${m.content ? m.content + "\n\n" : ""}(earlier in this conversation you called: ${note})`;
        out.push(kept.length ? { ...m, tool_calls: kept, content } : { role: "assistant", content });
        continue;
      }
    }
    if (m.role === "tool" && orphaned.has(m.tool_call_id)) continue;
    out.push(m);
  }
  return out;
}

// Switching provider mid-conversation hands the new one a history the old one shaped, and each
// has different rules about what a valid history looks like. Patching them one error at a time
// meant every fix revealed the next quirk, so this enforces all the invariants up front:
//
//   - a tool result must follow the call it answers (either side missing breaks both)
//   - assistant content must never be null where a string is expected
//   - the conversation must not end on an assistant turn ("Requests ending with a model turn
//     are not supported") — which the unsigned-call stripping could itself cause by removing
//     the trailing tool results
//
// Applied to every model, not just the one that complained: these are all cases where the
// history is genuinely malformed, and a provider accepting it is luck rather than licence.
function normalizeHistory(msgs, model) {
  let out = needsThoughtSignature(model) ? stripUnsignedToolCalls(msgs) : msgs.slice();

  // Drop tool results whose call is gone, and calls whose results never arrived.
  const answered = new Set(out.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  const called = new Set(out.flatMap((m) => (m.tool_calls || []).map((c) => c.id)));
  out = out
    .filter((m) => m.role !== "tool" || called.has(m.tool_call_id))
    .map((m) => {
      if (m.role !== "assistant" || !m.tool_calls?.length) return m;
      const kept = m.tool_calls.filter((c) => answered.has(c.id));
      if (kept.length === m.tool_calls.length) return m;
      const dropped = m.tool_calls.filter((c) => !answered.has(c.id)).map((c) => c.function?.name).filter(Boolean);
      const content = `${m.content || ""}${dropped.length ? `\n(started: ${dropped.join(", ")})` : ""}`.trim();
      return kept.length ? { ...m, tool_calls: kept } : { role: "assistant", content: content || "(no output)" };
    });

  out = out.map((m) => (m.role === "assistant" && !m.tool_calls?.length && m.content == null ? { ...m, content: "(no output)" } : m));

  const last = out[out.length - 1];
  if (last && last.role === "assistant") {
    out.push({ role: "user", content: "Continue from where you left off." });
  }
  return out;
}

async function pickFallbackModel(baseUrl, apiKey, alreadyTried) {
  try {
    const allModels = await fetchModels(baseUrl, apiKey);
    const ids = allModels
      .filter((m) => !isImageOnlyModel(m) && !NON_CHAT_MODEL_RE.test(m.id))
      .map((m) => m.id);
    // Switch only to a model that can actually drive the agent, strongest first — landing on a
    // model without tool calling would fail on the very next turn.
    const usable = ids
      .filter((id) => agentRank(id) !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => agentRank(a) - agentRank(b));
    const fresh = usable.find((id) => !alreadyTried.has(id) && !isCoolingDown(id));
    // Only fall back to a cooling-down model if literally nothing else is left — a slow answer
    // still beats telling the user the turn failed.
    return fresh || usable.find((id) => !alreadyTried.has(id)) || null;
  } catch {
    return null;
  }
}

// Lets a text-only model still "look" at something: a vision model is asked to describe the
// image, and its answer is handed back as text. Without this, choosing a strong coding model
// meant screenshots and generated images were invisible for the whole session — the agent
// would tell the user to go open the file themselves instead of checking its own work.
async function describeImage(baseUrl, apiKey, dataUrl, context) {
  for (const visionModel of VISION_MODELS) {
    try {
      const res = await fetch(buildEndpointUrl(baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders(baseUrl, apiKey) },
        body: JSON.stringify({
          model: visionModel,
          max_tokens: 800,
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: `${context}\n\nDescribe this image in detail for a developer who cannot see it. Cover the layout, colours, any text that appears, and anything that looks broken, misaligned, missing, or visually wrong.`,
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model: visionModel };
    } catch {
      // try the next vision model
    }
  }
  return null;
}

function isTransientError(status, message) {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 401 || status === 402 || status === 403 || status === 404) return false;
  return /provider returned error|overloaded|temporarily unavailable|unavailable|rate.?limit|quota|resource_exhausted|too many requests|high demand|try again later|stopped responding mid-stream|timed?\s*out|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
    message || ""
  );
}

// Best-effort live decode of a string field's value out of a tool call's arguments JSON while it
// is still streaming in and therefore not valid JSON yet. Used to show file content being "typed"
// as the model writes it, the way Claude Code's own UI does, instead of only revealing it once the
// whole tool call has finished arriving. Doesn't need to be byte-perfect — the real, exact content
// is what actually gets written to disk; this only drives a live preview.
function extractPartialStringField(argsSoFar, fieldName) {
  const marker = `"${fieldName}"`;
  const markerIdx = argsSoFar.indexOf(marker);
  if (markerIdx === -1) return null;
  let i = markerIdx + marker.length;
  while (i < argsSoFar.length && (argsSoFar[i] === " " || argsSoFar[i] === ":")) i++;
  if (argsSoFar[i] !== '"') return null;
  i++;
  let text = "";
  for (; i < argsSoFar.length; i++) {
    const ch = argsSoFar[i];
    if (ch === "\\") {
      if (i + 1 >= argsSoFar.length) break; // incomplete escape — wait for more data
      const next = argsSoFar[i + 1];
      const simple = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/" };
      if (next in simple) {
        text += simple[next];
        i++;
      } else if (next === "u") {
        if (i + 5 < argsSoFar.length) {
          text += String.fromCharCode(parseInt(argsSoFar.slice(i + 2, i + 6), 16));
          i += 5;
        } else break; // incomplete \uXXXX — wait for more data
      } else {
        text += next;
        i++;
      }
    } else if (ch === '"') {
      return { text, done: true };
    } else {
      text += ch;
    }
  }
  return { text, done: false };
}

const STREAMED_FILE_FIELDS = { write_file: "content", edit_file: "new_string" };

// Last resort when a provider rejects the conversation shape itself: throw away every tool
// structure and keep only what was said, as plain alternating turns. The agent loses the
// machine-readable record of its own calls, but the user gets an answer instead of a stack
// trace — and no provider can object to text.
function flattenToolHistory(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === "tool") {
      out.push({ role: "user", content: `[result of an earlier tool call]\n${String(m.content || "").slice(0, 4000)}` });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const names = m.tool_calls.map((c) => c.function?.name).filter(Boolean).join(", ");
      out.push({ role: "assistant", content: `${m.content || ""}\n(called: ${names})`.trim() });
      continue;
    }
    out.push(m.content == null ? { ...m, content: "(no output)" } : m);
  }
  // Collapse consecutive same-role turns, which the rewrite above can produce and several
  // providers reject outright.
  const merged = [];
  for (const m of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role && typeof prev.content === "string" && typeof m.content === "string") {
      prev.content += "\n\n" + m.content;
    } else {
      merged.push({ ...m });
    }
  }
  if (merged.length && merged[merged.length - 1].role === "assistant") {
    merged.push({ role: "user", content: "Continue from where you left off." });
  }
  return merged;
}

// ---------- Tool gating ----------
// Every schema in `tools` is re-sent on every model call, and an agent turn makes one call per
// tool round-trip — so 45 schemas is several thousand prompt tokens paid over and over. The core
// coding tools are always offered; the specialist families only join once the conversation gives a
// reason, and they stay for the rest of it. Re-evaluated per call against the whole conversation,
// so the moment the user says "screenshot the page" the browser tools are there.
const TOOL_FAMILIES = {
  browser: {
    names: ["browser_navigate", "browser_read_page", "browser_click", "browser_type", "browser_scroll",
            "browser_screenshot", "browser_resize", "browser_execute_script"],
    re: /\b(browser|screenshot|web ?page|webpage|website|localhost|url|click|scroll|login|log in|sign in|form|render|preview|ui|dev server)\b|https?:\/\/|\.(com|dev|io|ai|net|org|app)\b/i,
  },
  osint: {
    names: ["osint_search_tools", "osint_dns_recon", "osint_ip_lookup", "osint_subdomain_enum",
            "osint_http_recon", "osint_dork_generator", "vuln_static_scan"],
    re: /\b(osint|recon|arsenal|vulnerab\w*|pentest|exploit|breach|ransomware|infostealer|dark ?web|dork|cve|security|audit|exposed?|leak|hsts|csp|samesite|httponly|subdomain|whois|dns|threat)\b/i,
  },
  os: {
    names: ["os_search", "os_read", "os_open", "os_launch_app", "os_system_stats", "os_kill_process"],
    re: /\b(my (computer|pc|laptop|machine|files|downloads|desktop|documents)|this (computer|pc|machine)|open (the )?app|launch|installed?|process|task manager|cpu|ram|memory|disk|storage|battery|antivirus|defender|system|organise|organize|folder|recycle)\b|clean ?up/i,
  },
  media: {
    names: ["generate_image", "view_image", "map_route"],
    re: /\b(image|picture|photo|logo|icon|diagram|screenshot|png|jpe?g|svg|map|route|distance|directions|travel|km|miles)\b/i,
  },
  knowledge: {
    names: ["kb_add", "kb_search"],
    re: /\b(knowledge ?base|kb|docs?|documentation|reference|ingest)\b|index (this|the)|remember this/i,
  },
  storage: {
    names: ["cleanup_storage"],
    re: /\b(storage|junk|cache)\b|disk space|free up|clean ?up|temp files/i,
  },
};

function gateTools(list, chatMessages) {
  // What the conversation is about: the user's own words, plus the tools already called — a family
  // that has been used once must never vanish mid-task.
  const parts = [];
  const used = new Set();
  for (const m of chatMessages) {
    if (m.role === "user") {
      if (typeof m.content === "string") parts.push(m.content);
      else if (Array.isArray(m.content)) {
        for (const part of m.content) if (part && part.type === "text") parts.push(part.text);
      }
    }
    if (m.tool_calls) for (const tc of m.tool_calls) if (tc.function?.name) used.add(tc.function.name);
  }
  const text = parts.join(" \n ");
  const drop = new Set();
  for (const fam of Object.values(TOOL_FAMILIES)) {
    if (fam.re.test(text) || fam.names.some((n) => used.has(n))) continue;
    for (const n of fam.names) drop.add(n);
  }
  return drop.size ? list.filter((t) => !drop.has(t.function.name)) : list;
}

async function streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages, flattenHistory, forcedTool, allowedTools }) {
  // A swarm role or a worker only gets the tools its job needs — a Researcher cannot write
  // files, a Planner cannot run commands — so the model can't wander outside its remit. The
  // interactive chat sees everything except the tools that only make sense inside a headless run.
  const offered = [...TOOLS, ...toolRegistry.agentTools(), ...EXTRA_TOOLS];
  const toolList = allowedTools
    ? offered.filter((t) => allowedTools.has(t.function.name))
    : gateTools(offered.filter((t) => !HEADLESS_ONLY_TOOLS.has(t.function.name)), chatMessages);
  const res = await fetch(buildEndpointUrl(baseUrl, "/chat/completions"), {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(baseUrl, apiKey),
    },
    body: JSON.stringify({
      model: model || "auto",
      // Sanitised here rather than at the call site because the model can change *after* the
      // request body would otherwise have been built: a mid-turn fallback from Azure (whose
      // tool calls carry no thought_signature) to Gemini (which demands one) was replaying the
      // already-assembled Azure history and being rejected. Deciding at the moment of the call
      // means it always matches the model actually being asked.
      messages: [chatMessages[0], ...(flattenHistory ? flattenToolHistory(chatMessages.slice(1)) : normalizeHistory(chatMessages.slice(1), model))],
      // Everything the user switched on in Tools is offered to the model as well.
      tools: toolList,
      // Weak models ignore even a forceful "call the tool, don't lecture" instruction and write a
      // simulated report instead. When the user's request is an unambiguous "audit this URL" or
      // "find tools", we force the exact tool so the model physically cannot answer with prose —
      // it must run the real recon, then report on the actual result next turn.
      tool_choice: forcedTool ? { type: "function", function: { name: forcedTool } } : "auto",
      max_tokens: MAX_RESPONSE_TOKENS,
      stream: true,
      // Asks the provider to report real token usage in a final SSE chunk, so the status bar
      // shows what was actually spent rather than a local guess.
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || detail;
    } catch {}
    return { ok: false, error: detail, status: res.status };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let finishReason = null;
  const toolCalls = [];
  const announcedTools = new Set();

  async function readChunkWithTimeout() {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("STREAM_STALLED")), STREAM_IDLE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  while (true) {
    let done, value;
    try {
      ({ done, value } = await readChunkWithTimeout());
    } catch (err) {
      reader.cancel().catch(() => {});
      if (err.message === "STREAM_STALLED") {
        throw new Error("The model stopped responding mid-stream (no data for 45s) — try again.");
      }
      throw err;
    }
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      // NVIDIA answers HTTP 200 and then puts the failure *inside* the stream as a data event
      // ({"error":{"message":"Service temporarily overloaded","code":503}}) instead of using an
      // HTTP status. Reading only `choices` meant a real 503 arrived as a stream with no
      // content and got reported to the user as "the model stopped without a response" — with
      // no retry, because nothing looked like an error. Surface it as the error it is so the
      // usual transient-retry and model-switch path can handle it.
      if (json.error) {
        const status = Number(json.error.code) || 503;
        await reader.cancel().catch(() => {});
        return {
          ok: false,
          error: json.error.message || "The model provider returned an error mid-stream.",
          status,
          transient: isTransientError(status, json.error.message),
        };
      }
      if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
      // The usage chunk arrives on its own, with an empty `choices` array.
      if (json.usage) sender.send("agent:usage", { usage: json.usage, model });
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        sender.send("agent:assistant-delta", { content: delta.content });
      }
      // Reasoning models (the nemotron family, gpt-oss) emit their whole chain of thought here
      // before a single token of `content` appears. Dropping it silently made the UI look frozen
      // for a minute or more on longer problems — surface it so the wait is legible.
      if (delta.reasoning_content) {
        sender.send("agent:reasoning-delta", { content: delta.reasoning_content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          // Gemini 3.x attaches a thought_signature to each tool call and *requires* it back on
          // the next request — without it the call is rejected outright with "Function call is
          // missing a thought_signature". Rebuilding the tool call from name+arguments alone
          // silently dropped it, so the first turn worked and every follow-up 400'd.
          if (tc.extra_content) {
            toolCalls[idx].extra_content = { ...(toolCalls[idx].extra_content || {}), ...tc.extra_content };
          }

          const fnName = toolCalls[idx].function.name;
          // Announce the tool the moment its name is known. Arguments can take a long time to
          // stream (a whole file, a long command), and until now nothing reached the UI during
          // that window for any tool without a streamed content field — it just sat on
          // "Thinking" with no sign of life.
          if (fnName && !announcedTools.has(idx)) {
            announcedTools.add(idx);
            sender.send("agent:tool-pending", { name: fnName });
          }
          const field = STREAMED_FILE_FIELDS[fnName];
          if (field) {
            const args = toolCalls[idx].function.arguments;
            const pathMatch = extractPartialStringField(args, "path");
            const contentMatch = extractPartialStringField(args, field);
            if (contentMatch && toolCalls[idx].id) {
              sender.send("agent:tool-arg-stream", {
                id: toolCalls[idx].id,
                name: fnName,
                path: pathMatch ? pathMatch.text : null,
                text: contentMatch.text,
                done: contentMatch.done,
              });
            }
          }
        }
      }
    }
  }

  const message = { role: "assistant", content: content || null };
  const calls = toolCalls.filter(Boolean);
  if (calls.length) message.tool_calls = calls;
  return { ok: true, message, finishReason };
}

// Injected fresh every turn (see requestMessages below) rather than baked into the chat's stored
// system message, so it applies to chats that were already created before this instruction existed.
const TOOL_PRIORITY_REMINDER =
  "Reminder: a question phrased around 'this project' / 'my code' / a feature name with no URL is " +
  "about the local codebase, not the web. Check it first with list_dir/search_files/read_file. Only " +
  "use browser_navigate or web_fetch afterward, and only if what you found is genuinely missing, or " +
  "the user is clearly asking about something external (a live site, a third-party product, a URL " +
  "they gave you). Searching the web before checking code you already have direct access to is slower " +
  "and often wrong — never do that as a first resort.\n\n" +
  "PERSONAL / DEVICE FILES — SEARCH THE COMPUTER, NOT THE WEB: When the user refers to something of theirs — 'my file', 'a document/agreement/spreadsheet/email I have', 'in my Downloads', a contract or two company names they mention as if you'd have it — it is almost certainly a file ON THIS COMPUTER, not something to look up online. Use os_search to find it (search by a distinctive word — a company name, a keyword) and os_read to read it (it extracts Word/Excel/PowerPoint/PDF/email text). Do this BEFORE any web_search or browser_navigate. Only search the web if os_search genuinely finds nothing on the device or the user clearly wants public/online information. Answering 'I found no public results' when the file was sitting in their Downloads is the exact mistake to avoid.\n\n" +
  "FREEING DISK SPACE: When the user asks to clean up storage, free disk space, clear the cache, or delete temp/useless files, use the cleanup_storage tool — it clears Nutaan Code's update-download cache, HTTP/GPU caches and stale temp without touching their settings, chats, knowledge base, memory or saved logins. Run it with dry_run:true first to show them how much can be freed, then again to clean. Don't try to rm these paths by hand.\n" +
  "REPORT THE CLEANUP NUMBER THAT IS TRUE, NOT THE ONE THAT SOUNDS GOOD: a dry run's scannedMB is only a candidate — plenty of it is locked by running programs and will not budge. After a real clean, the ONLY number you may call freed is freedMB, which is measured from what is actually gone. If blockedCount is above zero, say so in the same breath: name what could not be removed and why, and never fold blockedMB into the total. The tool hands you a `summary` field that already says all of this correctly — follow it. Claiming hundreds of megabytes were freed when the folders are still sitting there is the single worst thing you can do here; the user WILL check.\n\n" +
  "RECURRING ASKS BECOME WORKERS: 'every morning', 'each day at 8', 'every hour', 'keep me updated on', 'check daily whether a new RERA project came', 'tell me the weather/stock price every…' — these are scheduled workers, not something to do once now. Call worker_create with a prompt written for an unattended agent (include the city, tickers, portal, URL, thresholds), the schedule (daily+time+days / interval), and use_project:true only if it needs this project's files. Then confirm the schedule and that results land in the Updates feed with a desktop notification. If they say 'run it now too', also call worker_run_now. worker_list shows what exists; worker_update / worker_delete change it.\n" +
  "OUTCOME-SIZED ASKS GO TO THE SWARM: 'launch my SaaS', 'fix production', 'launch the website', 'build a marketing campaign', 'research my competitors', 'set up a CRM', 'deploy this' — a goal with several independent parts that a team would split — call swarm_launch with the goal and stop; the Planner/Developer/Browser QA/Researcher/Reviewer/DevOps agents run it in parallel and the report appears in the Swarm panel. A single focused change (one file, one bug) stays with you.\n" +
  "WORKSPACE HEALTH: workspace_health tells you what the self-healing monitor has seen (crashes in background tasks, failing tests, a dead health URL, browser console errors) — check it when the user says something is broken and you don't yet know what.\n\n" +
  "THE MACHINE ITSELF, NOT JUST THE PROJECT: when the user asks how much CPU or memory something is using, why their computer or this app feels slow, what is running, or how much disk space is left, call os_system_stats — it is the Task Manager / Activity Monitor reading, live, on Windows, macOS and Linux alike. Never guess at these numbers and never tell the user to go open Task Manager themselves; you can read it, so read it. To close a program — 'kill that', 'shut it down', 'it's frozen' — use os_kill_process with the pid from os_system_stats. It asks the program to quit first; only pass force:true if that was already tried or the user asks for it, and warn that unsaved work is lost. Critical OS processes are refused by the tool, so never work around that with run_command.\n\n" +
  "READING THE USER'S EMAIL — GO GET IT, DON'T STOP AT 'NO LOCAL FILES': 'Read my emails' rarely means a loose .eml on disk. Most people's mail is either in a webmail account or in the Outlook/Gmail desktop app, so after a quick os_search for .eml/.mbox/.msg turns up nothing, OPEN THE WEBMAIL IN THE BUILT-IN BROWSER and read it — do not stop and hand the user a menu. browser_navigate to https://mail.google.com for Gmail, or https://outlook.live.com (personal) / https://outlook.office.com (work) for Outlook, then browser_read_page to read the inbox and click a message to open it. The built-in browser has its OWN session, separate from the user's Chrome, so if a sign-in page shows, say so and ask the user to sign in once in the browser panel (their own credentials, entered by them — you must NEVER type their email password yourself); then continue reading. Outlook DESKTOP mail is a proprietary local OST that can't be read as a file — use Outlook on the web instead. Only ask which account when it is genuinely ambiguous; otherwise open the obvious one (Gmail) and start reading.\n\n" +
  // A vague instruction is an instruction to go and find out, not a reason to stop. "Run it and
  // fix the UI issues" was answered with a table of things the user might have meant and a
  // request for permission — when the agent could have started the server, opened the page,
  // screenshotted it and reported what was actually wrong in the same turn.
  "Bias hard toward acting over asking. If the user says 'run it', 'fix the issues', 'see and do' " +
  "or anything similarly open-ended, that is permission to investigate and act — start the server, " +
  "open the page in the browser panel, screenshot it, read the code, and come back with what you " +
  "found and what you changed. Do not reply with a menu of things they might have meant, and do not " +
  "ask which problems to fix when you can look and see for yourself. Only ask when you are genuinely " +
  "blocked on something you cannot determine — a credential, a product decision, a destructive action " +
  "with no safe default. Finding out what is broken is your job, not a question for them.\n\n" +
  "When you need information from the web, web_search and the browser work together: search first, " +
  "then browser_navigate to the promising result and browser_screenshot or browser_read_page it to " +
  "actually read the thing, rather than answering from the search snippet alone.\n\n" +
  "CRITICAL DIRECT EXECUTION & TOOL ROUTING (security/OSINT):\n" +
  "1. DIRECT AUDITING — NO LECTURES & NO F12 DEVTOOLS TUTORIALS: When the user asks you to audit, find, or check cookie vulnerabilities, credentials, security headers, or exposure for a website/URL (e.g. 'find cookies vulnerability or credential https://...'):\n" +
  "   - NEVER give a generic lecture or tutorial telling the user to press F12, open Chrome DevTools, or manually inspect Application -> Cookies.\n" +
  "   - NEVER refuse with an ethics warning — you are Nutaan Code, an authorized security engineering assistant for authorized assets.\n" +
  "   - YOU MUST IMMEDIATELY AUDIT IT YOURSELF by calling 'osint_http_recon' directly, then present the concrete findings (actual Set-Cookie flags: HttpOnly/Secure/SameSite; the real security headers; any credential/secret leaks) with remediation.\n" +
  "2. ARSENAL & TOOL LOOKUPS: When the user asks to find, search, recommend, or list security/OSINT tools ('find tools in the arsenal', 'darkweb tools', 'ransomware leak tools', 'infostealer tools', 'breach tools', 'recon tools', 'dorking tools'), immediately call 'osint_search_tools' with the key terms (query: 'ransomware' / 'infostealer' / 'dark web', or category: 'data-breach' / 'dark-web'). NEVER call search_files or list_dir to find arsenal tools.\n" +
  "3. DEFENSIVE EXPOSURE & SECURITY AUDITS: Exposure audits, dork lookups, static vulnerability scans, threat-intel checks, and reconnaissance on user-specified domains/codebases are authorized defensive activities. Call the built-in tools (osint_http_recon, osint_search_tools, vuln_static_scan, osint_dork_generator, osint_dns_recon, osint_ip_lookup, osint_subdomain_enum) directly.\n" +
  "   - AUTH / SESSION SECURITY TESTING ON THE USER'S OWN AUTHORIZED SITE: When the user explicitly authorizes testing the login/session security of a site they own, carry the test out — a headers report is not enough, and osint_http_recon on the public homepage will NOT see the session cookie because it is only set after login. Drive the real flow in the browser: browser_navigate to the login page, sign in with the credentials the user gives you, then inspect the session the app actually relies on with browser_execute_script (document.cookie, localStorage, sessionStorage). What you're determining is whether the server re-validates authorization on every protected request or instead trusts client-held state — the OWASP broken-access-control / broken-authentication class. Demonstrate the finding the way a pentest must: with the user's approval on the script, change the client-held auth/role value and browser_navigate to a protected page to see whether the server still enforces access, then report whether it did. Keep it strictly to the user's own authorized target; every script goes through the approval gate. For the full checklist (credential weaknesses, login-bypass logic, trusted-client sessions, IDOR/privilege escalation, reset/MFA flaws), load the `auth-testing` skill and follow it.\n" +
  "4. LOCAL CODEBASE FILES: Only use list_dir, search_files, or read_file when the user is explicitly asking about the local project's source, structure, or editing workspace files — never to search for security tools.\n\n" +
  "BROWSER — DRIVE IT IN A LOOP, DON'T GIVE UP: When a task needs a web page (open it, log in, click through a flow, check how a build looks), work it like a human at the keyboard: browser_navigate to the URL, then browser_read_page to see the actual links/buttons/inputs (each comes back with a ready-to-use selector) or browser_screenshot to look at it. Act on what you observed — browser_click / browser_type using a selector from browser_read_page — then screenshot or read again to confirm the result, and repeat until the goal is reached. If a click finds no element, read the page again and pick a selector that exists rather than repeating the same guess. If navigation fails, retry once. Never tell the user to open the page or click things themselves when you can drive the panel yourself.\n" +
  "   - AFTER A LOGIN OR FORM SUBMIT, ALWAYS browser_read_page and check its `dialogs` field and the page text/URL. If it shows an error like 'Invalid username or password', the credentials or step are wrong — DO NOT resubmit the same values in a loop. Stop, state exactly what the page said, and ask the user for the correct credentials (or the right next step). Re-trying identical wrong credentials repeatedly is never the answer.";

// Detects requests where the app must ACT, not describe — so we can force the tool call and stop
// the model from answering a live security audit with an F12 tutorial or a "simulated" report.
// Only fires on unambiguous asks (an explicit verb + a URL for audits; explicit "tools/arsenal"
// wording for lookups) so normal coding chat is never hijacked into a security tool.
function detectDirectTool(text) {
  if (!text || typeof text !== "string") return null;
  const t = text;
  const hasUrl = /https?:\/\/[^\s)>"']+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|ai|io|net|org|co|dev|app|xyz|in|gov|edu|me|us|uk|tech|cloud)\b/i.test(t);
  const auditIntent = /\b(cookie|credential|vulnerab|security\s*header|http\s*recon|pentest|exposed?|leak|hsts|csp|samesite|httponly|secure\s*flag|owasp|audit\s*(the|this|my)?\s*(site|url|domain|website|app))\b/i.test(t);
  const explicitVerb = /\b(find|check|test|audit|scan|analy[sz]e|assess|review|inspect|do\s*it|perform|run)\b/i.test(t);
  if (hasUrl && auditIntent && explicitVerb) return "osint_http_recon";
  if (/\b(find|search|list|show|give|recommend|need|want)\b/i.test(t) && /\b(tool|tools|arsenal)\b/i.test(t) && /\b(osint|security|cyber|recon|breach|ransomware|infostealer|dark\s*web|dork|hacking|pentest|threat)\b/i.test(t)) {
    return "osint_search_tools";
  }
  return null;
}

// `headless` runs (workers, swarm agents, the healer) bring their own AbortController, get a
// tool allowlist, may be read-only, and never block on a permission prompt — there is nobody
// at the keyboard to answer it. Everything else is the same loop the chat uses.
async function runAgentLoop(sender, { root, baseUrl, apiKey, model, imageModel, messages, autoApprove, headless, controller: ownController, allowedTools, readOnly, maxIterations }) {
  const controller = ownController || new AbortController();
  if (!headless) agentAbort = controller;
  let chatMessages = [...messages];
  const aborted = () => controller.signal.aborted;
  // Read fresh each turn (not persisted into chatMessages) so memory_write calls take effect
  // immediately without bloating the saved conversation with a repeated block every turn.
  const memoryContext = await buildMemoryContext().catch(() => null);
  let emptyResponseRetries = 0;
  let truncatedRetries = 0;
  let unfinishedNudges = 0;
  openTaskCounts.set(sender, 0);
  const openTaskCount = () => openTaskCounts.get(sender) || 0;
  const iterationBudget = Math.max(1, Number(maxIterations) || MAX_AGENT_ITERATIONS);
  // Enough room to walk past a couple of busy providers — with capacity failures switching
  // after a single retry, two was too few to reach a model that was actually free.
  const MAX_MODEL_SWITCHES = 4;
  const triedModels = new Set([model]);

  for (let i = 0; i < iterationBudget; i++) {
    if (aborted()) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    chatMessages = await compactIfNeeded(sender, chatMessages, { baseUrl, apiKey, model });
    if (aborted()) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    // Injected per turn rather than baked into the saved system prompt, because auto-approve is
    // a toggle the user flips mid-conversation. A stored prompt saying "you need approval" was
    // still being sent with auto-approve ON, so the model politely asked permission for things
    // that would have executed instantly — and the user had to say "yes" to nothing.
    const modeContext = autoApprove
      ? "Auto-approve is currently ON. Writes, edits and shell commands execute immediately. Never ask for permission to run, write or edit anything — just do it and report what happened."
      : "Auto-approve is currently OFF, so write_file, edit_file and run_command are shown to the user for approval before they execute. Announce briefly what you're about to do, then call the tool — do not ask a yes/no question first, because the approval prompt already is that question.";

    const extraSystemMessages = [
      { role: "system", content: TOOL_PRIORITY_REMINDER },
      { role: "system", content: modeContext },
      ...(toolGuidance() ? [{ role: "system", content: toolGuidance() }] : []),
      ...(memoryContext ? [{ role: "system", content: memoryContext }] : []),
    ];
    // Sanitising for thought_signature happens inside streamChatCompletion, which knows which
    // model is actually being called even after a mid-turn switch.
    const requestMessages = trimStaleToolResults([chatMessages[0], ...extraSystemMessages, ...chatMessages.slice(1)]);

    // Force the audit/lookup tool only on the first model call after the user's request — when
    // the conversation still ends with their message and nothing has run yet this turn. Once a
    // tool result is in (last message is a tool/assistant turn), let the model report freely.
    const lastMsg = chatMessages[chatMessages.length - 1];
    let forcedTool =
      lastMsg && lastMsg.role === "user"
        ? detectDirectTool(typeof lastMsg.content === "string" ? lastMsg.content : "")
        : null;

    const MAX_TRANSIENT_RETRIES = 3;
    const RETRY_DELAYS_MS = [1000, 3000, 7000];
    triedModels.add(model);
    let streamResult;
    let flattenHistory = false;
    for (let attempt = 0; ; attempt++) {
      try {
        streamResult = await streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages: requestMessages, flattenHistory, forcedTool, allowedTools });
      } catch (err) {
        if (aborted()) {
          sender.send("agent:done", { aborted: true, messages: chatMessages });
          return;
        }
        streamResult = { ok: false, error: `Network error reaching the model server: ${err.message}`, transient: isTransientError(0, err.message) };
      }

      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }

      if (streamResult.ok) break;

      // If a provider rejects the forced tool_choice (not all support pinning a specific
      // function), drop the force and retry the same turn on auto rather than failing — the
      // system-prompt instruction still pushes it toward the right tool.
      if (forcedTool && streamResult.status === 400) {
        forcedTool = null;
        attempt = -1;
        continue;
      }

      const transient = streamResult.transient ?? isTransientError(streamResult.status, streamResult.error);
      // A provider refusing the *shape* of the conversation is recoverable, and the user should
      // never see it: the tool history is rewritten as plain text and the turn continues.
      // Without this, every provider quirk not yet accounted for becomes a dead end.
      const malformedHistory =
        streamResult.status === 400 &&
        /thought_signature|model turn|not a string|invalid.*argument|role|alternat|tool_call|function call/i.test(streamResult.error || "");
      if (malformedHistory && !flattenHistory) {
        flattenHistory = true;
        sender.send("agent:retrying", {
          message: "Adjusting the conversation format for this model",
          attempt: 1,
          max: 1,
          delayMs: 200,
        });
        await new Promise((r) => setTimeout(r, 200));
        attempt = -1;
        continue;
      }

      if (!transient) {
        sender.send("agent:error", { message: streamResult.error });
        return;
      }

      // "Overloaded" and "rate limited" don't clear in a few seconds, and there is a working
      // model one step down the list, so switching beats retrying the same busy provider. A
      // mid-stream stall has already cost ~45s of silence proving the model won't answer, so it
      // switches at once too. Genuine brief blips still get the full retry budget below.
      const stalled = /stopped responding mid-stream/i.test(streamResult.error || "");
      const capacityFailure = isCapacityFailure(streamResult.status, streamResult.error);
      // Can we move to a different model at all? Azure's "model" is the deployment baked into the
      // URL, not a choice, and once the switch budget is spent there's nowhere left to go.
      const canSwitchModels = !isAzureEndpoint(baseUrl) && triedModels.size <= MAX_MODEL_SWITCHES;
      // On a capacity failure, don't waste a same-model retry when a fresh model is available —
      // a rate-limited model will just limit again, the "retrying in 1s" spam that fed the
      // cascade. Cool it down and switch instead. But when there is NOWHERE to switch (Azure, or
      // the switch budget is spent), the same model is all we have, so keep a small retry budget
      // and lean on the provider's retry-after hint rather than dead-ending on the first 429.
      const retryBudget = stalled ? 0 : capacityFailure ? (canSwitchModels ? 0 : 2) : MAX_TRANSIENT_RETRIES;
      coolDownModel(model, streamResult.status, streamResult.error);
      if (stalled) modelCooldown.set(model, Date.now() + COOLDOWN_MS);

      if (attempt >= retryBudget) {
        // This model's upstream provider is down, not just briefly hiccuping — move to another
        // model in the same catalog rather than dead-ending the whole turn on it.
        const canSwitch = canSwitchModels;
        const nextModel = canSwitch ? await pickFallbackModel(baseUrl, apiKey, triedModels) : null;
        if (!nextModel) {
          // No model left. Before failing, hand the task to a connected coding-agent CLI (Codex,
          // Claude Code) if there is one — it runs on its own account, so a Nutaan-side outage
          // does not have to stop the work.
          if (await tryCliAgentFallback(sender, chatMessages, root, controller.signal)) return;
          // Nothing left to try. If everything is rate-limited, say so plainly — the turn isn't
          // broken, the whole catalog is just busy — rather than surfacing a raw provider string
          // that reads like a crash. This is the signal the UI needs to stop the "thinking"
          // spinner and tell the user the model actually stopped.
          const message = capacityFailure
            ? `Every available model is rate-limited or overloaded right now. Wait a minute and send again.\n\n(last error: ${streamResult.error})`
            : streamResult.error;
          sender.send("agent:error", { message });
          return;
        }
        // Space out provider hits so the fallback chain doesn't itself become a burst of
        // requests. Honour the provider's own "retry in Ns" hint when it gave one (capped so the
        // user isn't left staring), otherwise a short fixed beat.
        if (capacityFailure) {
          const pause = Math.min(parseRetryAfterMs(streamResult.error) ?? 1500, 8000);
          sender.send("agent:retrying", {
            message: `${model} is rate-limited — switching models`,
            attempt: 1,
            max: 1,
            delayMs: pause,
          });
          await new Promise((r) => setTimeout(r, pause));
          if (aborted()) {
            sender.send("agent:done", { aborted: true, messages: chatMessages });
            return;
          }
        }
        sender.send("agent:model-switched", { from: model, to: nextModel, reason: streamResult.error });
        model = nextModel;
        triedModels.add(nextModel);
        attempt = -1; // reset the retry count for the new model
        continue;
      }

      // A same-model retry only happens now for a brief blip, or for a capacity failure with
      // nowhere to switch. In the capacity case honour the provider's "retry in Ns" hint (capped
      // so the user isn't left staring) instead of retrying in 1s and getting limited again.
      const hintedWait = capacityFailure ? parseRetryAfterMs(streamResult.error) : null;
      const delay = hintedWait
        ? Math.min(hintedWait, 20000)
        : RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      sender.send("agent:retrying", { message: streamResult.error, attempt: attempt + 1, max: retryBudget, delayMs: delay });
      await new Promise((r) => setTimeout(r, delay));
      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }
    }

    const message = streamResult.message;
    chatMessages.push(message);

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      // A response cut off by the token limit (finish_reason "length") with no tool call looks
      // identical to a real, deliberate final answer -- the exact bug that made this look like a
      // silent, unexplained stop mid-task with no error shown. Nudge it to keep going instead of
      // treating a truncated answer as if the model chose to stop there.
      if (streamResult.finishReason === "length") {
        const MAX_TRUNCATION_RETRIES = 3;
        if (truncatedRetries < MAX_TRUNCATION_RETRIES) {
          truncatedRetries++;
          chatMessages.push({
            role: "user",
            content: "(Your last response got cut off by the length limit before you finished. Continue exactly where you left off.)",
          });
          sender.send("agent:retrying", {
            message: "Response was cut off by the length limit — continuing",
            attempt: truncatedRetries,
            max: MAX_TRUNCATION_RETRIES,
            delayMs: 300,
          });
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        sender.send("agent:error", {
          message: "The model's response kept getting cut off by the length limit, even after being asked to continue. The task may be too large for one turn — try breaking it into smaller steps.",
        });
        return;
      }
      // A model that stops with neither a tool call nor any text gave up mid-task without saying
      // so — free models do this occasionally. Nudge it to actually finish or explain instead of
      // silently ending the turn as if it succeeded.
      if (!message.content || !message.content.trim()) {
        const MAX_EMPTY_RESPONSE_RETRIES = 2;
        if (emptyResponseRetries < MAX_EMPTY_RESPONSE_RETRIES) {
          emptyResponseRetries++;
          chatMessages.push({
            role: "user",
            content:
              "Your last response was empty — you stopped without finishing or explaining. Please continue: finish the task, or tell me what's blocking you.",
          });
          sender.send("agent:retrying", {
            message: "The model stopped without a response",
            attempt: emptyResponseRetries,
            max: MAX_EMPTY_RESPONSE_RETRIES,
            delayMs: 500,
          });
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        // Nudging didn't work, so this model is the problem, not the phrasing. Switch to another
        // one and keep going rather than telling the user to go change a setting themselves —
        // asking someone to pick a different model is the app admitting it knows what's wrong
        // and declining to fix it.
        const canSwitch = !isAzureEndpoint(baseUrl) && triedModels.size <= MAX_MODEL_SWITCHES;
        const nextModel = canSwitch ? await pickFallbackModel(baseUrl, apiKey, triedModels) : null;
        if (nextModel) {
          sender.send("agent:model-switched", { from: model, to: nextModel, reason: "kept returning an empty response" });
          model = nextModel;
          triedModels.add(nextModel);
          emptyResponseRetries = 0;
          continue;
        }
        sender.send("agent:error", {
          message: "The model kept stopping without finishing or explaining, and no other model was available to fall back to. Try again in a moment.",
        });
        return;
      }
      // "Now build." with five tasks still open is not a finished turn — the model announced
      // the next step and stopped. Its own checklist is the most reliable signal we have for
      // that, so an unfinished one earns a nudge rather than a silent end.
      const MAX_UNFINISHED_NUDGES = 3;
      if (openTaskCount() > 0 && unfinishedNudges < MAX_UNFINISHED_NUDGES) {
        unfinishedNudges++;
        const n = openTaskCount();
        chatMessages.push({
          role: "user",
          content: `You still have ${n} unfinished task${n === 1 ? "" : "s"} on your checklist. Carry on and actually do the next one — don't just describe it. Update the checklist as you complete each item, and only stop when everything is done or you hit something you genuinely cannot resolve.`,
        });
        sender.send("agent:retrying", {
          message: `${n} task${n === 1 ? "" : "s"} still open — continuing`,
          attempt: unfinishedNudges,
          max: MAX_UNFINISHED_NUDGES,
          delayMs: 200,
        });
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      sender.send("agent:done", { aborted: false, messages: chatMessages });
      return;
    }

    // Fan the independent reads out first. The loop below still walks the calls in order and
    // still owns approvals and message ordering — it just collects an already-finished result
    // for anything handled here.
    const preflight = new Map();
    const parallelBatch = toolCalls.filter((c) => PARALLEL_TOOLS.has(cleanToolName(c)));
    if (parallelBatch.length > 1) {
      sender.send("agent:tasks", { running: parallelBatch.length, names: parallelBatch.map(cleanToolName) });
      await Promise.all(
        parallelBatch.map(async (call) => {
          try {
            preflight.set(
              call.id,
              await executeTool(sender, root, cleanToolName(call), parseToolArgs(call), call.id, controller.signal, { baseUrl, apiKey, imageModel })
            );
          } catch (err) {
            preflight.set(call.id, { error: err.message });
          }
        })
      );
      sender.send("agent:tasks", { running: 0, names: [] });
    }

    for (const call of toolCalls) {
      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }

      const name = cleanToolName(call);
      const args = parseToolArgs(call);

      sender.send("agent:tool-start", { id: call.id, name, args });

      if (name === "run_command" && URL_OPEN_PATTERN.test(args.command || "")) {
        const result = {
          error: "Don't shell-open URLs — use the browser_navigate tool instead so it opens in the built-in browser panel.",
        };
        sender.send("agent:tool-result", { id: call.id, name, result });
        chatMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }

      let approved = true;
      // A dry-run cleanup only reports what it *would* remove — no approval needed for a preview.
      const isSafe = SAFE_TOOLS.has(name) || (name === "cleanup_storage" && args && args.dry_run) ||
        toolRegistry.isSafe(name) || HEADLESS_ONLY_TOOLS.has(name);
      if (!isSafe && readOnly) {
        // A look-only worker asked to change something. Refuse with a reason the model can
        // relay, rather than silently doing it — the user set this worker up as read-only.
        const result = { error: `This run is read-only: ${name} is not allowed. Report what you would have changed instead.` };
        sender.send("agent:tool-result", { id: call.id, name, result });
        chatMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        continue;
      }
      if (!isSafe) {
        if (autoApprove || headless) {
          sender.send("agent:permission-request", { id: call.id, name, args, autoApproved: true, ...permissionPreview(name, args) });
        } else {
          approved = await requestPermission(sender, call.id, { name, args, ...permissionPreview(name, args) });
        }
      }

      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }

      let result;
      if (!approved) {
        result = { error: "Denied by user" };
      } else if (preflight.has(call.id)) {
        result = preflight.get(call.id);
      } else {
        try {
          result = await executeTool(sender, root, name, args, call.id, controller.signal, { baseUrl, apiKey, imageModel });
        } catch (err) {
          result = { error: err.message };
        }
      }

      sender.send("agent:tool-result", { id: call.id, name, result });

      const modelLooksVisionCapable = canSeeImages(model);
      const imageFromTool =
        name === "browser_screenshot" ? result?.imageDataUrl :
        name === "view_image" ? result?.dataUrl : null;

      // A blind model gets the image described by a vision model instead of being told "you
      // can't see images" — so checking its own work keeps working on any model.
      if (imageFromTool && result?.ok && !modelLooksVisionCapable) {
        const context = name === "browser_screenshot"
          ? `This is a screenshot of the page at ${result.url || "the browser panel"}.`
          : `This is the image file ${args.path} from the project.`;
        const described = await describeImage(baseUrl, apiKey, imageFromTool, context);
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            described
              ? { ok: true, url: result.url, viewed_by: described.model, description: described.text }
              : { ok: false, error: "Couldn't view the image: no vision model was reachable. Use browser_read_page for text content instead." }
          ).slice(0, MAX_OUTPUT_CHARS),
        });
        continue;
      }

      if (name === "browser_screenshot" && result && result.ok && result.imageDataUrl && modelLooksVisionCapable) {
        // Keep the raw image out of the plain-text tool message (it'd blow past MAX_OUTPUT_CHARS and
        // get corrupted mid-base64) — send a short confirmation there, and the actual image as a
        // separate multimodal message. Only do this when the model looks vision-capable — pushing a
        // huge base64 image at a plain-text model bloats context for zero benefit and has caused the
        // model to silently stall out on later steps in this same conversation.
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, url: result.url, note: "Screenshot captured — see the image in the next message." }),
        });
        chatMessages.push({
          role: "user",
          content: [
            { type: "text", text: "(screenshot of the browser panel, requested via browser_screenshot)" },
            { type: "image_url", image_url: { url: result.imageDataUrl } },
          ],
        });
      } else if (name === "view_image" && result && result.ok && result.dataUrl && modelLooksVisionCapable) {
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, note: "Image loaded — see the next message." }),
        });
        chatMessages.push({
          role: "user",
          content: [
            { type: "text", text: `(image at ${args.path}, requested via view_image)` },
            { type: "image_url", image_url: { url: result.dataUrl } },
          ],
        });
      } else {
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, MAX_OUTPUT_CHARS),
        });
      }
    }
  }

  sender.send("agent:error", { message: "Stopped after reaching the max number of steps for this turn." });
}

ipcMain.on("agent:send", async (event, payload) => {
  const backend = await activeBackend(payload || {});
  runAgentLoop(event.sender, { ...payload, ...backend }).catch((err) => {
    event.sender.send("agent:error", { message: err.message });
  });
});

ipcMain.on("agent:stop", () => {
  agentAbort?.abort();
  for (const resolve of pendingPermissions.values()) resolve(false);
  pendingPermissions.clear();
  for (const resolve of pendingBrowserActions.values()) resolve({ ok: false, error: "Stopped" });
  pendingBrowserActions.clear();
});

// ---------- Autonomous layer: workers, swarm, self-healing, today ----------
// Everything below runs the same agent loop as the chat, with nobody at the keyboard: events are
// collected instead of rendered, browser actions are routed to the real window's panel (the only
// browser there is), and the promise resolves with the final assistant text.
const { WorkerScheduler, describeSchedule } = require("./agents/workers");
const { Swarm } = require("./agents/swarm");
const { Healer } = require("./agents/healer");
const { Today } = require("./agents/today");
const { Monitor } = require("./agents/monitor");

async function headlessBackend(model) {
  const s = await refreshSettingsCache();
  // Honour the user's provider choice first, exactly like the interactive chat — their own valid
  // key works here too. But autonomous work runs unattended, so a custom provider whose key is
  // wrong or expired (a 401 that would silently kill every background agent) must not be a dead
  // end: when a Nutaan account key exists, carry it as a managed fallback the caller drops to on an
  // auth failure. `managedFallback` is null when the primary already IS the managed backend.
  const backend = await activeBackend({ baseUrl: s.baseUrl, apiKey: s.apiKey, nutaanKey: s.nutaanKey, customProviders: s.customProviders, modelProviderId: s.modelProviderId });
  if (!backend.apiKey) throw new Error("Nutaan Code is not activated — add your nutaan.com API key in Settings first.");
  const nutaanKey = String(s.nutaanKey || "").trim();
  const onManaged = backend.baseUrl === NUTAAN_LLM_BASE;
  const managedFallback = !onManaged && nutaanKey
    ? { baseUrl: NUTAAN_LLM_BASE, apiKey: nutaanKey, model: FALLBACK_MODEL }
    : null;
  return { ...backend, model: model || s.model || FALLBACK_MODEL, imageModel: s.imageModel, managedFallback };
}

// True when a failure looks like the backend rejecting the credentials — the case where dropping to
// the managed Nutaan backend is the right move rather than retrying the same rejected key.
function isAuthFailure(status, message) {
  if (status === 401 || status === 403) return true;
  return /\b401\b|\b403\b|invalid api key|unauthorized|forbidden|invalid.*token|authentication/i.test(String(message || ""));
}

async function runHeadless({ root, model, systemPrompt, userPrompt, messages, allowedTools, readOnly, maxIterations, controller, onEvent, hooks }) {
  let backend;
  try { backend = await headlessBackend(model); } catch (err) { return { ok: false, error: err.message, text: "", toolsUsed: [] }; }
  const chatMessages = messages || [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }];

  const runOnce = (b) => new Promise((resolve) => {
    const toolsUsed = [];
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve({ ...r, toolsUsed }); } };
    const sender = {
      hooks: hooks || null,
      send(channel, data) {
        try { onEvent?.(channel, data); } catch {}
        if (channel === "agent:browser-action") {
          if (win && !win.isDestroyed()) win.webContents.send(channel, data);
          else {
            const r = pendingBrowserActions.get(data.id);
            pendingBrowserActions.delete(data.id);
            r?.({ ok: false, error: "No browser window is open" });
          }
        } else if (channel === "agent:tool-start") {
          toolsUsed.push({ name: data.name });
        } else if (channel === "agent:done") {
          const msgs = data.messages || [];
          const last = [...msgs].reverse().find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim());
          finish({ ok: !data.aborted, aborted: !!data.aborted, text: last ? last.content : "", messages: msgs });
        } else if (channel === "agent:error") {
          finish({ ok: false, error: data.message, text: "" });
        }
      },
    };
    runAgentLoop(sender, {
      root: root || os.homedir(),
      ...b,
      messages: chatMessages,
      autoApprove: true,
      headless: true,
      controller,
      allowedTools,
      readOnly,
      maxIterations,
    }).catch((err) => finish({ ok: false, error: err.message, text: "" }));
  });

  const result = await runOnce(backend);
  // A custom provider that rejects the key kills the whole role otherwise; the account's managed
  // backend is the reliable fallback, so retry the role there once before giving up.
  if (!result.ok && !result.aborted && backend.managedFallback && isAuthFailure(null, result.error)) {
    return await runOnce({ ...backend.managedFallback, imageModel: backend.imageModel });
  }
  return result;
}

// One plain completion, no tools, no streaming — for planning JSON, merging reports, and the
// "today" suggestion pass.
async function complete({ system, user, model, maxTokens = 2000 }) {
  const backend = await headlessBackend(model);
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const attempt = async (b) => {
    const res = await fetch(buildEndpointUrl(b.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAuthHeaders(b.baseUrl, b.apiKey) },
      body: JSON.stringify({ model: b.model, messages, max_tokens: maxTokens, stream: false }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { detail = (await res.json())?.error?.message || detail; } catch {}
      const err = new Error(detail); err.status = res.status; throw err;
    }
    const json = await res.json();
    return String(json?.choices?.[0]?.message?.content || "");
  };
  try {
    return await attempt(backend);
  } catch (err) {
    // A custom provider that rejects the credentials (a bad or client-restricted key) must not kill
    // the run when the account's own managed backend is available — drop to it and carry on.
    if (backend.managedFallback && isAuthFailure(err.status, err.message)) {
      return await attempt(backend.managedFallback);
    }
    throw err;
  }
}

function notifyDesktop({ title, body }) {
  try {
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: String(title).slice(0, 80), body: String(body || "").slice(0, 200), icon: path.join(__dirname, "assets", "logo.png") });
    n.on("click", () => { try { win?.show(); win?.focus(); } catch {} });
    n.show();
  } catch {}
}

function emitToWindow(channel, data) {
  try { if (win && !win.isDestroyed()) win.webContents.send(channel, data); } catch {}
}

const userDataDir = app.getPath("userData");
const workers = new WorkerScheduler({ userDataDir, runHeadless, notify: notifyDesktop, emit: emitToWindow, log: (m) => console.log("[workers]", m) });
const swarm = new Swarm({ userDataDir, runHeadless, complete, emit: emitToWindow, log: (m) => console.log("[swarm]", m) });
const healer = new Healer({
  userDataDir,
  runHeadless,
  notify: notifyDesktop,
  emit: emitToWindow,
  bgTasks: { list: () => [...backgroundTasks.values()].map((t) => ({ id: t.id, command: t.command, cwd: t.cwd, status: t.status })), view: (id) => bgTaskView(id, 200), stop: stopBgTask },
  postUpdate: (u) => {
    const update = { id: "up" + Date.now().toString(36), workerId: null, workerName: u.workerName, icon: u.icon, at: Date.now(), status: u.status, headline: u.headline, body: u.body, unread: true, reason: "healer" };
    workers.updates.unshift(update);
    workers.saveUpdates().catch(() => {});
    emitToWindow("workers:update", update);
  },
  log: (m) => console.log("[healer]", m),
});
const today = new Today({ userDataDir, complete, log: (m) => console.log("[today]", m) });

// Device + web-app monitoring: the traffic light in the title bar, the watched URLs, and the
// twice-weekly security scan. It reads the same live system probe the os_system_stats tool uses,
// and runs its scans through the same arsenal the agent does — no second, weaker implementation.
const monitor = new Monitor({
  userDataDir,
  notify: notifyDesktop,
  emit: emitToWindow,
  arsenal,
  systemStats,
  log: (m) => console.log("[monitor]", m),
});

// Background-task output feeds the healer: a crash line in the dev server is an incident.
bgTaskListeners.push({
  output: (task, stream, line) => healer.onBgOutput(task, stream, line),
  exit: (task) => healer.onBgExit(task),
});

app.whenReady().then(async () => {
  await Promise.all([workers.load(), swarm.load(), healer.load(), monitor.load()]).catch(() => {});
  workers.start();
  monitor.start();
  // Waking from sleep is exactly when a 07:30 briefing is most wanted — tick right away.
  try {
    const { powerMonitor } = require("electron");
    powerMonitor.on("resume", () => workers.tick("resume").catch(() => {}));
    powerMonitor.on("unlock-screen", () => workers.tick("unlock").catch(() => {}));
  } catch {}
});
app.on("before-quit", () => { workers.stop(); healer.shutdown(); });

function workerScheduleFromArgs(args) {
  const type = args.schedule_type || "daily";
  if (type === "interval") return { type, everyMinutes: Number(args.every_minutes) || 60 };
  if (type === "once") return { type, at: args.at || new Date(Date.now() + 3600_000).toISOString() };
  if (type === "daily") return { type, time: args.time || "08:00", days: Array.isArray(args.days) ? args.days : [] };
  return { type };
}

function summariseWorker(w) {
  return { id: w.id, name: w.name, icon: w.icon, enabled: w.enabled, schedule: describeSchedule(w.schedule), root: w.root, readOnly: w.readOnly, lastRunAt: w.lastRunAt ? new Date(w.lastRunAt).toLocaleString() : null, lastStatus: w.lastStatus, lastHeadline: w.lastHeadline, nextRunAt: w.nextRunAt ? new Date(w.nextRunAt).toLocaleString() : null };
}

// ---- IPC: workers ----
ipcMain.handle("workers:list", () => ({ workers: workers.list(), templates: workers.templates(), unread: workers.unreadCount() }));
ipcMain.handle("workers:create", (_e, spec) => workers.create(spec));
ipcMain.handle("workers:update", (_e, id, patch) => workers.update(id, patch));
ipcMain.handle("workers:remove", (_e, id) => workers.remove(id));
ipcMain.handle("workers:run-now", (_e, id) => workers.runNow(id));
ipcMain.handle("workers:stop", (_e, id) => workers.stopRun(id));
ipcMain.handle("workers:updates", (_e, limit) => ({ updates: workers.listUpdates(limit || 100), unread: workers.unreadCount() }));
ipcMain.handle("workers:mark-read", (_e, ids) => workers.markRead(ids));
ipcMain.handle("workers:clear-updates", () => workers.clearUpdates());

// ---- IPC: swarm ----
ipcMain.handle("swarm:start", (_e, { goal, root, model }) => swarm.start({ goal, root, model: model || settingsCache.model }));
ipcMain.handle("swarm:stop", (_e, runId) => swarm.stop(runId));
ipcMain.handle("swarm:list", () => ({ runs: swarm.list(), roles: swarm.roles() }));
ipcMain.handle("swarm:get", (_e, runId) => swarm.get(runId));

// ---- IPC: healer ----
ipcMain.handle("healer:view", (_e, root) => healer.view(root));
ipcMain.handle("healer:set-mode", (_e, mode) => healer.setMode(mode));
ipcMain.handle("healer:configure", (_e, root, patch) => healer.configureProject(root, patch));
ipcMain.handle("healer:scan", (_e, root) => healer.scan(root));
ipcMain.handle("healer:repair", (_e, id) => healer.repair(id).then((inc) => ({ ok: true, status: inc.status })).catch((e) => ({ ok: false, error: e.message })));
ipcMain.handle("healer:stop-repair", (_e, id) => healer.stopRepair(id));
ipcMain.handle("healer:ignore", (_e, id) => healer.ignore(id));
ipcMain.handle("healer:clear", () => healer.clear());
// The renderer's browser panel reports console errors and failed loads here.
ipcMain.on("healer:signal", (_e, sig) => { healer.signal(sig || {}).catch(() => {}); });

// ---- IPC: today + project lifecycle ----
ipcMain.handle("today:build", async (_e, { root, lastChat, force }) => {
  const view = healer.view(root);
  const list = workers.list();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const extra = {
    incidents: view.incidents.filter((i) => i.status === "detected" || i.status === "needs-human"),
    workers: list.filter((w) => w.enabled && w.nextRunAt && w.nextRunAt - Date.now() < 86_400_000).map((w) => ({ id: w.id, name: w.name, icon: w.icon, time: new Date(w.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), dueToday: true, lastHeadline: w.lastHeadline })),
    updatesToday: workers.listUpdates(50).filter((u) => u.at >= startOfDay.getTime()),
    lastChat,
  };
  return today.build(root, extra, { force: !!force, useModel: !!settingsCache.nutaanKey || !!settingsCache.apiKey });
});
ipcMain.on("project:opened", (_e, root) => {
  if (!root) return;
  monitor.projectOpened(root);
  healer.projectOpened(root);
  workers.projectOpened(root).catch(() => {});
});

// ---------- Demo Studio (screen recording → interactive product demos) ----------
// The capture itself happens in the renderer (MediaRecorder over a desktopCapturer stream), because
// that is the only place Chromium hands over frames. What has to live here is everything the
// renderer cannot see: the list of capturable screens and windows, where the real mouse pointer is
// while this window is minimised, global hotkeys that still fire when another app has focus, and
// the files a finished demo is made of.
const { desktopCapturer, screen: electronScreen, globalShortcut } = require("electron");

const DEMO_DIR = path.join(CANONICAL_STORE_DIR, "demos");
const CURSOR_HZ = 60;
// Windows rounds timers up to the ~15.6 ms system tick, so asking for 16 ms lands on the *second*
// tick and halves the rate. Ask for less than one tick and every tick fires: measured ~60-64 Hz.
const CURSOR_INTERVAL_MS = process.platform === "win32" ? 8 : Math.round(1000 / CURSOR_HZ);
const CURSOR_MAX_SAMPLES = 70 * CURSOR_HZ * 60; // an hour of recording, then it stops growing

function demoDir() {
  fsSync.mkdirSync(DEMO_DIR, { recursive: true });
  return DEMO_DIR;
}
function newDemoId() {
  return "demo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}
function safeDemoId(id) {
  // Ids are generated here, but they come back over IPC — never let one walk out of the folder.
  return typeof id === "string" && /^[a-z0-9-]{4,64}$/i.test(id) ? id : null;
}

ipcMain.handle("studio:sources", async () => {
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 300 },
      fetchWindowIcons: true,
    });
  } catch (err) {
    return { ok: false, error: err.message, sources: [] };
  }
  const displays = electronScreen.getAllDisplays();
  const primaryId = String(electronScreen.getPrimaryDisplay().id);
  const selfTitle = win ? win.getTitle() : "";
  const out = [];
  for (const s of sources) {
    const isScreen = s.id.startsWith("screen:");
    // A window with no title is a hidden helper window, not something anyone meant to record.
    if (!isScreen && !String(s.name || "").trim()) continue;
    const display = isScreen ? displays.find((d) => String(d.id) === String(s.display_id)) || null : null;
    let thumbnail = "";
    try { thumbnail = s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : ""; } catch {}
    let icon = "";
    try { icon = s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : ""; } catch {}
    out.push({
      id: s.id,
      name: s.name,
      kind: isScreen ? "screen" : "window",
      thumbnail,
      icon,
      isSelf: !isScreen && !!selfTitle && s.name === selfTitle,
      displayId: display ? String(display.id) : null,
      // Pixel size of the display, so the picker can say "2560 × 1440" before anything is recorded.
      width: display ? Math.round(display.size.width * display.scaleFactor) : 0,
      height: display ? Math.round(display.size.height * display.scaleFactor) : 0,
      primary: display ? String(display.id) === primaryId : false,
    });
  }
  out.sort((a, b) => (a.kind === b.kind ? (b.primary ? 1 : 0) - (a.primary ? 1 : 0) : a.kind === "screen" ? -1 : 1));
  return { ok: true, sources: out };
});

// ---- Pointer path ----
// Sampled here rather than in the renderer because during a recording this window is usually
// minimised, and a hidden renderer gets no mouse events at all. Positions are normalised against
// the recorded display, so the editor can map them onto the video whatever its resolution is.
let cursorTimer = null;
let cursorSamples = [];
let cursorOverflow = false;
let cursorSession = 0;

function stopCursorSampling() {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
}

ipcMain.handle("studio:cursor-start", (_e, { displayId } = {}) => {
  stopCursorSampling();
  cursorSamples = [];
  cursorOverflow = false;
  // Each run gets a token. A stop that quotes an older one — a stale retry, a second Studio view —
  // is answered without touching the buffer the live recording is still filling.
  cursorSession++;
  const displays = electronScreen.getAllDisplays();
  const d = displays.find((x) => String(x.id) === String(displayId)) || electronScreen.getPrimaryDisplay();
  const b = d.bounds;
  cursorTimer = setInterval(() => {
    try {
      if (cursorSamples.length >= CURSOR_MAX_SAMPLES) { cursorOverflow = true; return; }
      const p = electronScreen.getCursorScreenPoint();
      cursorSamples.push([
        Date.now(),
        Math.round(((p.x - b.x) / b.width) * 10000) / 10000,
        Math.round(((p.y - b.y) / b.height) * 10000) / 10000,
      ]);
    } catch {}
  }, CURSOR_INTERVAL_MS);
  return {
    ok: true,
    session: cursorSession,
    display: { id: String(d.id), width: b.width, height: b.height, scaleFactor: d.scaleFactor },
  };
});

ipcMain.handle("studio:cursor-stop", (_e, session) => {
  if (session != null && session !== cursorSession) return { ok: false, stale: true, samples: [] };
  stopCursorSampling();
  const samples = cursorSamples;
  cursorSamples = [];
  return { ok: true, samples, truncated: cursorOverflow };
});

// ---- Global hotkeys, live only while a recording is running ----
// F-keys with two modifiers: a recording is usually of some other app, and Ctrl+Shift+Z or
// Ctrl+Shift+S would be taken out of that app's hands the moment the user hit record.
const STUDIO_KEYS = [
  { accel: "CommandOrControl+Shift+F9", action: "stop" },
  { accel: "CommandOrControl+Shift+F10", action: "pause" },
  { accel: "CommandOrControl+Shift+F8", action: "zoom" },
];

function clearStudioKeys() {
  for (const k of STUDIO_KEYS) { try { globalShortcut.unregister(k.accel); } catch {} }
}

ipcMain.handle("studio:hotkeys", (_e, on) => {
  clearStudioKeys();
  if (!on) return { ok: true, registered: [] };
  const registered = [];
  for (const k of STUDIO_KEYS) {
    try {
      // Another app may already own the combination; report what stuck rather than promising keys
      // that will never fire.
      const got = globalShortcut.register(k.accel, () => {
        win?.webContents.send("studio:hotkey", { action: k.action, at: Date.now() });
      });
      if (got) registered.push(k.action);
    } catch {}
  }
  return { ok: true, registered };
});

ipcMain.handle("studio:window", (_e, action) => {
  if (!win) return { ok: false };
  try {
    if (action === "minimize") win.minimize();
    else if (action === "restore") { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  } catch {}
  return { ok: true };
});

// ---- Floating recording controller ----
// Once the main window is out of the way there is nothing left to click, and the global hotkeys may
// have been taken by another app. This little always-on-top bar is the reliable way to stop.
// setContentProtection keeps it out of the capture itself, so it never lands in the demo.
let recBarWin = null;

function closeRecBar() {
  if (recBarWin && !recBarWin.isDestroyed()) { try { recBarWin.destroy(); } catch {} }
  recBarWin = null;
}

function openRecBar() {
  closeRecBar();
  const display = electronScreen.getPrimaryDisplay();
  const width = 330;
  const height = 60;
  recBarWin = new BrowserWindow({
    width, height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 28),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer", "recbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  recBarWin.setAlwaysOnTop(true, "screen-saver");
  try { recBarWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  try { recBarWin.setContentProtection(true); } catch {}
  recBarWin.loadFile(path.join(__dirname, "renderer", "recbar.html"));
  recBarWin.once("ready-to-show", () => { try { recBarWin.showInactive(); } catch {} });
  recBarWin.on("closed", () => { recBarWin = null; });
}

ipcMain.handle("studio:recbar", (_e, { show } = {}) => {
  if (show) openRecBar(); else closeRecBar();
  return { ok: true };
});

ipcMain.on("studio:recbar-state", (_e, state) => {
  if (recBarWin && !recBarWin.isDestroyed()) recBarWin.webContents.send("studio:recbar-state", state || {});
});

// The bar speaks the same language as the global hotkeys, so the renderer needs no second path.
ipcMain.on("studio:recbar-action", (_e, action) => {
  if (["stop", "pause", "zoom"].includes(action)) win?.webContents.send("studio:hotkey", { action, at: Date.now() });
});

// ---- Takes and projects on disk ----
// The raw capture is written straight out as its own file; the project is a small JSON sidecar
// pointing at it. Re-opening a demo weeks later then costs nothing but reading one video back.
ipcMain.handle("studio:save-take", async (_e, { id, data, kind }) => {
  try {
    const dir = demoDir();
    const safe = safeDemoId(id) || newDemoId();
    const file = path.join(dir, `${safe}${kind === "camera" ? "-cam" : ""}.webm`);
    await fs.writeFile(file, Buffer.from(data));
    const st = await fs.stat(file);
    return { ok: true, id: safe, path: file, bytes: st.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("studio:save-project", async (_e, project) => {
  try {
    const dir = demoDir();
    const safe = safeDemoId(project?.id);
    if (!safe) return { ok: false, error: "bad project id" };
    const file = path.join(dir, `${safe}.json`);
    await fs.writeFile(file, JSON.stringify({ ...project, savedAt: Date.now() }, null, 2), "utf8");
    return { ok: true, path: file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("studio:list-projects", async () => {
  const dir = demoDir();
  let names = [];
  try { names = await fs.readdir(dir); } catch { return { ok: true, projects: [] }; }
  const projects = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      let bytes = 0;
      let missing = true;
      if (p.mediaPath) {
        try { bytes = (await fs.stat(p.mediaPath)).size; missing = false; } catch {}
      }
      projects.push({
        id: p.id, name: p.name, createdAt: p.createdAt, savedAt: p.savedAt,
        duration: p.duration, width: p.width, height: p.height,
        poster: p.poster || "", bytes, missing,
      });
    } catch {}
  }
  projects.sort((a, b) => (b.savedAt || b.createdAt || 0) - (a.savedAt || a.createdAt || 0));
  return { ok: true, projects };
});

ipcMain.handle("studio:load-project", async (_e, id) => {
  try {
    const safe = safeDemoId(id);
    if (!safe) return { ok: false, error: "bad project id" };
    const p = JSON.parse(await fs.readFile(path.join(demoDir(), `${safe}.json`), "utf8"));
    // Hand back an ArrayBuffer of exactly the file — a Buffer's own .buffer can be a shared pool.
    const exact = async (f) => {
      const b = await fs.readFile(f);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    let media = null;
    let camera = null;
    if (p.mediaPath) media = await exact(p.mediaPath);
    if (p.cameraPath && fsSync.existsSync(p.cameraPath)) camera = await exact(p.cameraPath);
    return { ok: true, project: p, media, camera };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("studio:delete-project", async (_e, id) => {
  try {
    const safe = safeDemoId(id);
    if (!safe) return { ok: false, error: "bad project id" };
    const dir = demoDir();
    let mediaPaths = [];
    try {
      const p = JSON.parse(await fs.readFile(path.join(dir, `${safe}.json`), "utf8"));
      mediaPaths = [p.mediaPath, p.cameraPath].filter(Boolean);
    } catch {}
    for (const f of [path.join(dir, `${safe}.json`), ...mediaPaths]) {
      try { await fs.unlink(f); } catch {}
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("studio:export", async (_e, { data, suggestedName, ext }) => {
  try {
    const filters = ext === "gif"
      ? [{ name: "Animated GIF", extensions: ["gif"] }]
      : ext === "mp4"
        ? [{ name: "MP4 video", extensions: ["mp4"] }]
        : [{ name: "WebM video", extensions: ["webm"] }];
    let base = app.getPath("downloads");
    try { base = app.getPath("videos") || base; } catch {}
    const res = await dialog.showSaveDialog(win, {
      title: "Export demo",
      defaultPath: path.join(base, suggestedName || `demo.${ext}`),
      filters,
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    await fs.writeFile(res.filePath, Buffer.from(data));
    const st = await fs.stat(res.filePath);
    return { ok: true, path: res.filePath, bytes: st.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("studio:reveal", (_e, target) => {
  try { shell.showItemInFolder(target); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
});

app.on("will-quit", () => { stopCursorSampling(); clearStudioKeys(); closeRecBar(); });

// ---- IPC: device + web-app monitor ----
ipcMain.handle("monitor:view", async (_e, opts) => {
  if (opts && opts.refresh) await monitor.readDevice(true).catch(() => {});
  return monitor.view();
});
ipcMain.handle("monitor:add-site", (_e, payload) => monitor.addSite(payload || {}));
ipcMain.handle("monitor:remove-site", (_e, id) => monitor.removeSite(id));
ipcMain.handle("monitor:update-site", (_e, id, patch) => monitor.updateSite(id, patch || {}));
ipcMain.handle("monitor:check-site", async (_e, id) => { await monitor.checkSite(id); return monitor.view(); });
ipcMain.handle("monitor:scan-now", async () => { await monitor.runScan("manual"); return monitor.view(); });
ipcMain.handle("monitor:set-enabled", (_e, on) => monitor.setEnabled(on));
ipcMain.handle("monitor:mark-read", () => { monitor.markEventsRead(); return monitor.view(); });
ipcMain.handle("monitor:clear-events", () => { monitor.clearEvents(); return monitor.view(); });
