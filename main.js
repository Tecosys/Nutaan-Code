const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { exec } = require("node:child_process");

const STORE_PATH = path.join(app.getPath("userData"), "settings.json");
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_AGENT_ITERATIONS = 25;
const BROWSER_ACTION_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_TOKENS = 8192;
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
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const levels = ["LOG", "WARN", "ERROR"];
    console.log(`[renderer:${levels[level] || level}] ${message} (${sourceId}:${line})`);
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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

ipcMain.handle("ai:list-models", async (_e, { baseUrl, apiKey }) => {
  try {
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/models", {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || detail;
      } catch {}
      return { ok: false, error: detail };
    }
    const data = await res.json();
    const models = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
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
      name: "run_command",
      description: "Run a shell command in the project root (60s timeout). Requires user approval.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
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
  // browser_execute_script is deliberately NOT in this list — it requires approval.
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

async function executeTool(sender, root, name, args, callId, signal) {
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
    case "run_command":
      return runCommand(root, args.command, signal);
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
    const res = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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

async function streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages }) {
  const res = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: model || "auto",
      messages: chatMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: MAX_RESPONSE_TOKENS,
      stream: true,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || detail;
    } catch {}
    return { ok: false, error: detail };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
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
        }
      }
    }
  }

  const message = { role: "assistant", content: content || null };
  const calls = toolCalls.filter(Boolean);
  if (calls.length) message.tool_calls = calls;
  return { ok: true, message };
}

async function runAgentLoop(sender, { root, baseUrl, apiKey, model, messages, autoApprove }) {
  const controller = new AbortController();
  agentAbort = controller;
  let chatMessages = [...messages];
  const aborted = () => controller.signal.aborted;

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

    let streamResult;
    try {
      streamResult = await streamChatCompletion(sender, controller, { baseUrl, apiKey, model, chatMessages });
    } catch (err) {
      if (aborted()) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }
      sender.send("agent:error", { message: `Network error reaching OmniRoute: ${err.message}` });
      return;
    }

    if (aborted()) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    if (!streamResult.ok) {
      sender.send("agent:error", { message: streamResult.error });
      return;
    }

    const message = streamResult.message;
    chatMessages.push(message);

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
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
          result = await executeTool(sender, root, name, args, call.id, controller.signal);
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
