const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { exec, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { autoUpdater } = require("electron-updater");

const STORE_PATH = path.join(app.getPath("userData"), "settings.json");
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_AGENT_ITERATIONS = 50;
const BROWSER_ACTION_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_TOKENS = 16_000;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const COMPACT_THRESHOLD_TOKENS = 60_000;
const KEEP_RECENT_MESSAGES = 10;

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
    icon: path.join(__dirname, "assets", "logo.png"),
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on("console-message", (event) => {
    const levels = ["LOG", "WARN", "ERROR"];
    console.log(`[renderer:${levels[event.level] || event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  setupAutoUpdate();
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

async function fetchModels(baseUrl, apiKey) {
  if (isAzureEndpoint(baseUrl)) {
    // Azure's deployment-scoped endpoints don't expose a matching /models list — the "model" is
    // just whichever deployment the URL points at.
    return [{ id: azureDeploymentName(baseUrl) }];
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
  return Array.isArray(data.data) ? data.data : [];
}

ipcMain.handle("ai:list-models", async (_e, { baseUrl, apiKey }) => {
  try {
    const allModels = await fetchModels(baseUrl, apiKey);
    const models = allModels.filter((m) => !isImageOnlyModel(m)).map((m) => m.id);
    const imageModels = allModels.filter(isImageOnlyModel).map((m) => m.id);
    return { ok: true, models, imageModels };
  } catch (err) {
    // err.cause often carries the real reason for a network-level failure (DNS, proxy, TLS) that
    // err.message alone doesn't show — e.g. a corporate network blocking openrouter.ai outright.
    const causeCode = err.cause?.code;
    return { ok: false, error: causeCode ? `${err.message} (${causeCode})` : err.message };
  }
});

let omnirouteSetupRunning = false;

function omnirouteServeAlreadyRunning() {
  return fetch("http://localhost:20128/v1/models", { signal: AbortSignal.timeout(2000) })
    .then((res) => res.status !== 0)
    .catch(() => false);
}

function omnirouteKeyStillWorks(apiKey) {
  if (!apiKey) return Promise.resolve(false);
  return fetch("http://localhost:20128/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(3000),
  })
    .then((res) => res.ok)
    .catch(() => false);
}

function errorMessage(err, fallback) {
  return (err && (err.message || String(err))) || fallback || "Unknown error";
}

// OmniRoute ships bundled as a real dependency of this app (see package.json) — no separate
// download, no runtime npm install, no dependency on the customer having Node.js at all. We run
// its bin script using Electron's own bundled Node runtime (ELECTRON_RUN_AS_NODE), the same trick
// Electron apps use to run any Node CLI without requiring a system Node install.
function omnirouteBinPath() {
  const appPath = app.getAppPath();
  const base = appPath.endsWith(".asar") ? `${appPath}.unpacked` : appPath;
  return path.join(base, "node_modules", "omniroute", "bin", "omniroute.mjs");
}

function spawnOmniroute(args) {
  return spawn(process.execPath, [omnirouteBinPath(), ...args], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
}

function startOmnirouteServer(log) {
  return new Promise((resolve, reject) => {
    // --no-open: without this, OmniRoute's own CLI launches the user's real system browser
    // straight at its (unauthenticated) dashboard/login every time the server starts — we run
    // it headless and drive setup entirely through the CLI, so that popup is never wanted.
    const serve = spawnOmniroute(["serve", "--no-open"]);
    serve.unref();
    let settled = false;
    let buf = "";
    const onData = (d) => {
      log(d);
      buf += String(d);
      // Match against the accumulated buffer, not each chunk in isolation — the "OmniRoute is
      // running!" line can land split across two stdout chunks and silently never match otherwise.
      if (!settled && /omniroute is running/i.test(buf)) {
        settled = true;
        resolve();
      }
    };
    serve.stdout.on("data", onData);
    serve.stderr.on("data", onData);
    serve.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    setTimeout(async () => {
      if (settled) return;
      settled = true;
      if (await omnirouteServeAlreadyRunning()) resolve();
      else reject(new Error("The server didn't report ready in time."));
    }, 25_000);
  });
}

const OMNIROUTE_CLI_TIMEOUT_MS = 60_000;

function runOmnirouteCli(args, log = () => {}) {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let settled = false;
    const child = spawnOmniroute(args);
    // Without this, a hung `setup`/`api-keys` call (network stall, a lock, anything) left the UI
    // frozen on "Starting…" forever with zero feedback and no way to recover but restarting the
    // app — exactly what was reported. Every CLI call here now has a hard ceiling.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`omniroute ${args[0]} didn't finish within ${OMNIROUTE_CLI_TIMEOUT_MS / 1000}s.`));
    }, OMNIROUTE_CLI_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += String(d);
      log(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
      log(d);
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `omniroute ${args[0]} exited with code ${code}`));
    });
  });
}

// Provisions an admin account and a client API key entirely via the CLI — the customer never
// touches the web dashboard, never logs in, never copies a key by hand.
//
// NOTE: this previously segfaulted under Electron's bundled Node runtime — root cause was
// Electron 33 shipping Node 20.18, below OmniRoute's own hard floor of 22.22.2 for its
// better-sqlite3 usage (it logs this explicitly as a "secure runtime policy" warning). Bumping
// to Electron 44 (Node 24.20) plus a native-module rebuild fixed it — reproduced clean twice.
async function autoConfigureOmniroute(log) {
  log("\nFinishing setup (admin account + API key) — no login needed…\n");
  const password = crypto.randomBytes(18).toString("base64url");
  await runOmnirouteCli(["setup", "--password", password, "--non-interactive"], log);
  log("Generating an API key…\n");
  const keyOut = await runOmnirouteCli(
    ["--output", "json", "api", "api-keys", "post-api-keys", "--body", JSON.stringify({ name: "Nutaan Code" })],
    log
  );
  // stdout also carries plain-text "Loaded env from…" lines (with ANSI color codes — whose own
  // "\x1b[2m" sequences contain a literal "[" that previously fooled a naive JSON-start regex)
  // ahead of the JSON payload, so strip those and parse just the JSON object/array within.
  // eslint-disable-next-line no-control-regex
  const clean = keyOut.replace(/\x1b\[[0-9;]*m/g, "");
  const jsonMatch = clean.match(/[[{][\s\S]*[\]}]/);
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
  } catch {
    throw new Error("Could not parse the generated API key.");
  }
  const key = (Array.isArray(parsed) ? parsed[0]?.key : parsed?.key) || null;
  if (!key) throw new Error("No API key came back from setup.");
  log("Done — API key generated automatically.\n");
  return key;
}

async function startAndConfigureOmniroute(log, finish, existingApiKey) {
  log("Starting OmniRoute (bundled with this app — nothing to download)…\n");
  try {
    await startOmnirouteServer(log);
  } catch (err) {
    finish({ ok: false, error: errorMessage(err, "The server failed to start.") });
    return;
  }

  // Re-use a previously-generated key when the server was just restarted (e.g. after a reboot)
  // rather than re-running setup, which would create a brand-new admin account and orphan the
  // old API key every single time — exactly what made this feel like "setup never sticks."
  if (existingApiKey && (await omnirouteKeyStillWorks(existingApiKey))) {
    log("Your existing OmniRoute key still works — reconnected, nothing else to do.\n");
    finish({ ok: true, apiKey: existingApiKey });
    return;
  }

  try {
    const apiKey = await autoConfigureOmniroute(log);
    finish({ ok: true, apiKey });
  } catch (err) {
    // The server itself is genuinely up even if this last mile failed — don't report total
    // failure, just leave the key blank so they finish that one step from the dashboard.
    log(`\nCouldn't finish automatic setup: ${errorMessage(err)}\n`);
    finish({ ok: true, apiKey: null });
  }
}

ipcMain.on("omniroute:setup", async (event, payload) => {
  if (omnirouteSetupRunning) return;
  omnirouteSetupRunning = true;
  const sender = event.sender;
  const existingApiKey = payload?.existingApiKey || null;
  // eslint-disable-next-line no-control-regex
  const log = (line) => sender.send("omniroute:setup-log", String(line).replace(/\x1b\[[0-9;]*m/g, ""));
  const finish = (result) => {
    omnirouteSetupRunning = false;
    sender.send("omniroute:setup-done", result);
  };

  if (await omnirouteServeAlreadyRunning()) {
    if (existingApiKey && (await omnirouteKeyStillWorks(existingApiKey))) {
      log("OmniRoute is already running and your key still works — nothing to do.\n");
      finish({ ok: true, alreadyRunning: true, apiKey: existingApiKey });
      return;
    }
    log("OmniRoute is already running on this machine — nothing to install.\n");
    finish({ ok: true, alreadyRunning: true });
    return;
  }

  startAndConfigureOmniroute(log, finish, existingApiKey);
});

// Separate request/response channel (not the "omniroute:setup" broadcast pair above) used only by
// the silent background reconnect in the renderer when a chat request fails because the OmniRoute
// server isn't listening. It must not share a channel with the "Set it up for me" button flow —
// they used to both listen on the same setup-done broadcast, so a silent reconnect triggered here
// would also fire the button flow's handler and vice versa, stomping on whichever settings.baseUrl/
// apiKey the OTHER flow was mid-way through writing. Keeping this on its own invoke/response pair
// means the two can never step on each other.
ipcMain.handle("omniroute:reconnect", async (_event, { existingApiKey } = {}) => {
  if (omnirouteSetupRunning) return { ok: false, error: "Setup is already running." };
  omnirouteSetupRunning = true;
  const noop = () => {};
  try {
    if (await omnirouteServeAlreadyRunning()) {
      if (existingApiKey && (await omnirouteKeyStillWorks(existingApiKey))) {
        return { ok: true, alreadyRunning: true, apiKey: existingApiKey };
      }
      return { ok: true, alreadyRunning: true };
    }
    return await new Promise((resolve) => {
      startAndConfigureOmniroute(noop, resolve, existingApiKey);
    });
  } finally {
    omnirouteSetupRunning = false;
  }
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
  if (entries.length === 0) return null;
  const lines = entries.map((e) => `- **${e.id}** (${e.type}): ${e.description}`);
  return (
    "You have persistent memory shared across every project on this machine, stored at ~/.nutaan/memory/ " +
    "(not scoped to the current project folder). Existing entries:\n" +
    lines.join("\n") +
    "\n\nUse memory_read to load one in full when it's relevant to the current task. Use memory_write to save " +
    "durable facts worth remembering next time — user/project preferences, corrections about how to approach " +
    "this codebase or this person's workflow, cross-project conventions — not routine task details or anything " +
    "already obvious from the code itself. Update an existing entry (same id) instead of creating a near-duplicate."
  );
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
  return { url: res.url, title: titleMatch ? titleMatch[1].trim() : null, content: text.slice(0, MAX_OUTPUT_CHARS) };
}

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
      description: "Read the full text contents of a file relative to the project root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
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
      description: "Read the visible text content and current URL of whatever is currently open in the built-in browser panel.",
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
      description: "Take a screenshot of what's currently visible in the built-in browser panel. Only useful if you (the model) support image input — plain-text models should rely on browser_read_page instead.",
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
      name: "view_image",
      description: "Look at an image file in the project (e.g. one you just generated with generate_image, or a screenshot the user added) if the current model can see images. Returns an error telling you the model can't view images otherwise — don't retry it if so.",
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
      description: "Run a shell command in the project root (60s timeout). Requires user approval.",
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
];

const URL_OPEN_PATTERN = /^\s*(start|open|xdg-open|cmd(\.exe)?\s*\/c\s*start)\s+["']?(https?:\/\/)/i;

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
  "view_image",
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
    case "read_file":
      return { content: await fs.readFile(resolveSafe(root, args.path), "utf8") };
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function permissionPreview(name, args) {
  if (name === "write_file") return { title: `Write ${args.path}`, detail: args.content };
  if (name === "edit_file")
    return { title: `Edit ${args.path}`, diff: { oldString: args.old_string, newString: args.new_string } };
  if (name === "run_command") return { title: "Run command", detail: args.command };
  if (name === "browser_execute_script") return { title: "Run script in browser panel", detail: args.code };
  if (name === "memory_write") return { title: `Save memory: ${args.id}`, detail: args.content };
  if (name === "generate_image") return { title: `Generate image: ${args.path}`, detail: args.prompt };
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
async function pickNextFreeModel(baseUrl, apiKey, alreadyTried) {
  try {
    const allModels = await fetchModels(baseUrl, apiKey);
    const freeIds = allModels.filter((m) => !isImageOnlyModel(m) && m.id.endsWith(":free")).map((m) => m.id);
    return freeIds.find((id) => !alreadyTried.has(id)) || null;
  } catch {
    return null;
  }
}

function isTransientError(status, message) {
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  if (status === 401 || status === 402 || status === 403 || status === 404) return false;
  return /provider returned error|overloaded|temporarily unavailable|rate.?limit|stopped responding mid-stream|timed?\s*out|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(
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

async function streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages }) {
  const res = await fetch(buildEndpointUrl(baseUrl, "/chat/completions"), {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(baseUrl, apiKey),
    },
    body: JSON.stringify({
      model: model || "auto",
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: MAX_RESPONSE_TOKENS,
      stream: true,
      // OpenRouter-specific: lets the model pull in live web results on its own when useful,
      // on top of the explicit web_fetch tool for when the user hands us a specific URL.
      // Ignored by non-OpenRouter OpenAI-compatible servers.
      ...(baseUrl.includes("openrouter.ai") ? { plugins: [{ id: "web" }] } : {}),
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
      if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        sender.send("agent:assistant-delta", { content: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;

          const fnName = toolCalls[idx].function.name;
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
  "and often wrong — never do that as a first resort.";

async function runAgentLoop(sender, { root, baseUrl, apiKey, model, imageModel, messages, autoApprove }) {
  const controller = new AbortController();
  agentAbort = controller;
  let chatMessages = [...messages];
  const aborted = () => controller.signal.aborted;
  // Read fresh each turn (not persisted into chatMessages) so memory_write calls take effect
  // immediately without bloating the saved conversation with a repeated block every turn.
  const memoryContext = await buildMemoryContext().catch(() => null);
  let emptyResponseRetries = 0;
  let truncatedRetries = 0;
  const MAX_MODEL_SWITCHES = 2;
  const triedModels = new Set([model]);

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    if (aborted()) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    chatMessages = await compactIfNeeded(sender, chatMessages, { baseUrl, apiKey, model });
    if (aborted()) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    const extraSystemMessages = [
      { role: "system", content: TOOL_PRIORITY_REMINDER },
      ...(memoryContext ? [{ role: "system", content: memoryContext }] : []),
    ];
    const requestMessages = [chatMessages[0], ...extraSystemMessages, ...chatMessages.slice(1)];

    const MAX_TRANSIENT_RETRIES = 3;
    const RETRY_DELAYS_MS = [1000, 3000, 7000];
    triedModels.add(model);
    let streamResult;
    for (let attempt = 0; ; attempt++) {
      try {
        streamResult = await streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages: requestMessages });
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

      const transient = streamResult.transient ?? isTransientError(streamResult.status, streamResult.error);
      if (!transient) {
        sender.send("agent:error", { message: streamResult.error });
        return;
      }

      if (attempt >= MAX_TRANSIENT_RETRIES) {
        // This model's upstream provider is down, not just briefly hiccuping — if it's a free
        // OpenRouter model, try the next free model instead of dead-ending the whole turn on it.
        const canSwitch = model.endsWith(":free") && !isAzureEndpoint(baseUrl) && triedModels.size <= MAX_MODEL_SWITCHES;
        const nextModel = canSwitch ? await pickNextFreeModel(baseUrl, apiKey, triedModels) : null;
        if (!nextModel) {
          sender.send("agent:error", { message: streamResult.error });
          return;
        }
        sender.send("agent:model-switched", { from: model, to: nextModel, reason: streamResult.error });
        model = nextModel;
        triedModels.add(nextModel);
        attempt = -1; // reset the retry count for the new model
        continue;
      }

      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      sender.send("agent:retrying", { message: streamResult.error, attempt: attempt + 1, max: MAX_TRANSIENT_RETRIES, delayMs: delay });
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
        sender.send("agent:error", {
          message: "The model kept stopping without finishing or explaining, even after being asked to continue. Try again, or switch models in Settings.",
        });
        return;
      }
      sender.send("agent:done", { aborted: false, messages: chatMessages });
      return;
    }

    for (const call of toolCalls) {
      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }

      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }

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
      if (!SAFE_TOOLS.has(name)) {
        if (autoApprove) {
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
      } else {
        try {
          result = await executeTool(sender, root, name, args, call.id, controller.signal, { baseUrl, apiKey, imageModel });
        } catch (err) {
          result = { error: err.message };
        }
      }

      sender.send("agent:tool-result", { id: call.id, name, result });

      const modelLooksVisionCapable = /vision|multimodal/i.test(model || "");
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
      } else if (name === "browser_screenshot" && result && result.ok) {
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            url: result.url,
            note: "Screenshot captured and shown to the user in the app — the current model can't see images, so you don't get to view it. Use browser_read_page for text content instead.",
          }),
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
      } else if (name === "view_image" && result && result.ok) {
        chatMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: "The current model can't see images — pick a vision-capable model in Settings if you need this." }),
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

ipcMain.on("agent:send", (event, payload) => {
  runAgentLoop(event.sender, payload).catch((err) => {
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
