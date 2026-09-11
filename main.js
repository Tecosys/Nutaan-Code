const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { exec } = require("node:child_process");

const STORE_PATH = path.join(app.getPath("userData"), "settings.json");
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_AGENT_ITERATIONS = 25;

let win;
const pendingPermissions = new Map();
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

function runCommand(root, command) {
  return new Promise((resolve) => {
    exec(command, { cwd: root, timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: String(stdout || "").slice(0, MAX_OUTPUT_CHARS),
        stderr: String(stderr || "").slice(0, MAX_OUTPUT_CHARS),
        timedOut: Boolean(error && error.killed && error.signal),
      });
    });
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

const SAFE_TOOLS = new Set(["list_dir", "read_file", "search_files"]);
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

async function executeTool(sender, root, name, args) {
  switch (name) {
    case "list_dir":
      return { entries: await fs.readdir(resolveSafe(root, args.path), { withFileTypes: true }).then((es) =>
        es.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => ({ name: e.name, isDir: e.isDirectory() }))) };
    case "read_file":
      return { content: await fs.readFile(resolveSafe(root, args.path), "utf8") };
    case "search_files":
      return searchFiles(root, args.path, args.pattern);
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
      return runCommand(root, args.command);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function permissionPreview(name, args) {
  if (name === "write_file") return { title: `Write ${args.path}`, detail: args.content };
  if (name === "edit_file")
    return { title: `Edit ${args.path}`, diff: { oldString: args.old_string, newString: args.new_string } };
  if (name === "run_command") return { title: "Run command", detail: args.command };
  return { title: name, detail: JSON.stringify(args) };
}

async function runAgentLoop(sender, { root, baseUrl, apiKey, model, messages }) {
  const controller = new AbortController();
  agentAbort = controller;
  const chatMessages = [...messages];

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    if (controller.signal.aborted) {
      sender.send("agent:done", { aborted: true, messages: chatMessages });
      return;
    }

    let res;
    try {
      res = await fetch(baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model: model || "auto", messages: chatMessages, tools: TOOLS, tool_choice: "auto" }),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        sender.send("agent:done", { aborted: true, messages: chatMessages });
        return;
      }
      sender.send("agent:error", { message: `Network error reaching OmniRoute: ${err.message}` });
      return;
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        detail = errJson?.error?.message || detail;
      } catch {}
      sender.send("agent:error", { message: detail });
      return;
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
      sender.send("agent:error", { message: "Model returned no message" });
      return;
    }

    chatMessages.push(message);

    if (message.content) {
      sender.send("agent:assistant-message", { content: message.content });
    }

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      sender.send("agent:done", { aborted: false, messages: chatMessages });
      return;
    }

    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }

      sender.send("agent:tool-start", { id: call.id, name, args });

      let approved = true;
      if (!SAFE_TOOLS.has(name)) {
        approved = await requestPermission(sender, call.id, { name, args, ...permissionPreview(name, args) });
      }

      let result;
      if (!approved) {
        result = { error: "Denied by user" };
      } else {
        try {
          result = await executeTool(sender, root, name, args);
        } catch (err) {
          result = { error: err.message };
        }
      }

      sender.send("agent:tool-result", { id: call.id, name, result });
      chatMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, MAX_OUTPUT_CHARS),
      });
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
});
