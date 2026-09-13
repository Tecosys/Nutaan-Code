// Keeps the user's configured tools connected, and turns whatever they switched on into tools the
// agent can actually call.
//
// Everything the rest of the app needs is here: `status()` for the UI, `agentTools()` for the
// model, and `call()` to run one. The four kinds in the catalog each become agent tools in their
// own way, and the naming makes the origin obvious in a transcript:
//
//   mcp      mcp__<tool>__<toolName>     one agent tool per tool the server advertises
//   cli      <tool>_task                 hand over a task, get the answer back
//   app      <tool>_open                 open something in that application
//   session  session_open / _read / …    one small set of verbs shared by every session tool


const { spawn } = require("node:child_process");
const { McpClient, McpError } = require("./mcp-client");
const oauth = require("./mcp-oauth");
const { CATALOG, KINDS, byId } = require("./catalog");

const MAX_CLI_OUTPUT = 60_000;

function slug(s) {
  return String(s).replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function expandPath(p) {
  return String(p || "").replace(/%([^%]+)%/g, (_, name) => process.env[name] || "");
}

class ToolRegistry {
  // `deps` keeps Electron out of this file: the host supplies how to read settings, how to save
  // them, how to open a browser for a sign-in, and how to drive a session window.
  constructor(deps) {
    this.deps = deps;
    this.connections = new Map(); // id -> { client, tools, error, connecting, serverInfo }
  }

  // ---------- configuration ----------

  settings() {
    return this.deps.getSettings() || {};
  }

  entries() {
    const s = this.settings();
    const configured = s.tools || {};
    const out = [];
    for (const def of CATALOG) {
      const saved = configured[def.id] || {};
      out.push({ def, id: def.id, enabled: Boolean(saved.enabled), config: saved.config || {}, custom: false });
    }
    for (const c of s.customTools || []) {
      if (!c || !c.id) continue;
      out.push({
        def: {
          id: c.id,
          name: c.label || "Custom MCP server",
          kind: KINDS.MCP,
          transport: c.transport === "stdio" ? "stdio" : "http",
          blurb: c.transport === "stdio" ? c.command || "" : c.url || "",
          icon: "custom.svg",
          accent: "#8b93a7",
          custom: true,
        },
        id: c.id,
        enabled: c.enabled !== false,
        config: c,
        custom: true,
      });
    }
    return out;
  }

  entry(id) {
    return this.entries().find((e) => e.id === id) || null;
  }

  // ---------- MCP connections ----------

  // How a server is reached, once the catalog defaults and the user's overrides are combined.
  async mcpSpec(entry) {
    const { def, config } = entry;
    const transport = config.transport || def.transport || "http";
    if (transport === "stdio") {
      return {
        transport: "stdio",
        command: config.command || def.command,
        args: config.args || def.args || [],
        env: config.env || {},
        timeoutMs: 60_000,
      };
    }
    const url = config.url || def.url;
    if (!url) throw new McpError(`${def.name} has no server URL configured.`);
    const headers = { ...(config.headers || {}) };

    if (def.auth === "nutaan-key") {
      // Already signed in for models; the same account key works here, so this tool needs no setup.
      const key = config.token || this.settings().nutaanKey;
      if (key) headers.Authorization = `Bearer ${key}`;
    } else if (def.auth === "oauth" || this.savedAuth(entry.id)) {
      const token = await this.validToken(entry.id);
      // RFC 6750 makes the scheme case-insensitive, but real servers (Canva among them) reject the
      // lowercase "bearer" some of them hand back in token_type. Normalise it to the spelling the
      // standard uses so the header is accepted everywhere.
      if (token) {
        const scheme = /^bearer$/i.test(token.tokenType || "") || !token.tokenType ? "Bearer" : token.tokenType;
        headers.Authorization = `${scheme} ${token.accessToken}`;
      }
    }
    return { transport: "http", url, headers, timeoutMs: 60_000 };
  }

  savedAuth(id) {
    return (this.settings().toolAuth || {})[id] || null;
  }

  async saveAuth(id, value) {
    const s = this.settings();
    const toolAuth = { ...(s.toolAuth || {}) };
    if (value) toolAuth[id] = value;
    else delete toolAuth[id];
    await this.deps.saveSettings({ ...s, toolAuth });
  }

  // Refreshes in place when the access token has aged out, so a long-running session keeps working
  // without asking the user to sign in again.
  async validToken(id) {
    const saved = this.savedAuth(id);
    if (!saved?.token) return null;
    if (!oauth.isExpired(saved.token)) return saved.token;
    try {
      const token = await oauth.refresh(saved);
      await this.saveAuth(id, { ...saved, token });
      return token;
    } catch {
      // The refresh token is gone or rejected; the user has to connect again.
      return saved.token;
    }
  }

  async connect(id) {
    const entry = this.entry(id);
    if (!entry) throw new Error(`No tool called "${id}".`);
    if (entry.def.kind !== KINDS.MCP) return this.status(id);

    await this.disconnect(id);
    const state = { connecting: true, tools: [], error: null, serverInfo: null };
    this.connections.set(id, state);
    this.deps.onStatusChange?.();

    try {
      const spec = await this.mcpSpec(entry);
      const client = new McpClient(spec);
      const info = await client.connect();
      state.client = client;
      state.tools = info.tools;
      state.serverInfo = info.serverInfo;
      state.connecting = false;
    } catch (err) {
      state.connecting = false;
      state.error = err.message;
      state.needsAuth = Boolean(err.needsAuth);
      state.wwwAuthenticate = err.wwwAuthenticate || null;
    }
    this.deps.onStatusChange?.();
    return this.status(id);
  }

  async disconnect(id) {
    const state = this.connections.get(id);
    if (state?.client) {
      try { await state.client.close(); } catch {}
    }
    this.connections.delete(id);
  }

  // Sign in to a hosted MCP server. Discovery and registration happen on the fly, so there is
  // nothing for the user to create beforehand.
  async authorize(id) {
    const entry = this.entry(id);
    if (!entry) throw new Error(`No tool called "${id}".`);
    const url = entry.config.url || entry.def.url;
    if (!url) throw new Error(`${entry.def.name} has no server URL to sign in to.`);

    // A 401 names the metadata document; asking for one first makes discovery exact.
    let wwwAuthenticate = this.connections.get(id)?.wwwAuthenticate || null;
    if (!wwwAuthenticate) {
      try {
        const probe = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nutaan-code", version: "1.0.0" } } }),
          signal: AbortSignal.timeout(20_000),
        });
        wwwAuthenticate = probe.headers.get("www-authenticate");
      } catch {}
    }

    const result = await oauth.authorize({
      serverUrl: url,
      wwwAuthenticate,
      openBrowser: this.deps.openBrowser,
    });
    await this.saveAuth(id, result);
    return this.connect(id);
  }

  async signOut(id) {
    await this.saveAuth(id, null);
    await this.disconnect(id);
    this.deps.onStatusChange?.();
  }

  // Connect everything switched on, drop everything switched off. Safe to call whenever settings
  // change; already-connected servers are left alone.
  async sync() {
    const wanted = this.entries().filter((e) => e.enabled && e.def.kind === KINDS.MCP);
    const wantedIds = new Set(wanted.map((e) => e.id));
    for (const id of [...this.connections.keys()]) {
      if (!wantedIds.has(id)) await this.disconnect(id);
    }
    await Promise.all(
      wanted.filter((e) => !this.connections.has(e.id)).map((e) => this.connect(e.id).catch(() => {}))
    );
    this.deps.onStatusChange?.();
  }

  // ---------- status for the UI ----------

  status(only = null) {
    const rows = this.entries()
      .filter((e) => !only || e.id === only)
      .map((e) => {
        const conn = this.connections.get(e.id);
        const auth = this.savedAuth(e.id);
        return {
          id: e.id,
          name: e.def.name,
          kind: e.def.kind,
          blurb: e.def.blurb || "",
          icon: e.def.icon,
          accent: e.def.accent,
          docs: e.def.docs || null,
          noApi: e.def.noApi || null,
          oauthNote: e.def.oauthNote || null,
          custom: Boolean(e.custom),
          enabled: e.enabled,
          config: e.config,
          fields: e.def.fields || [],
          oauthFields: e.def.oauthFields || [],
          needsOAuth: e.def.auth === "oauth",
          signedIn: Boolean(auth?.token),
          connecting: Boolean(conn?.connecting),
          connected: Boolean(conn?.client),
          error: conn?.error || null,
          needsAuth: Boolean(conn?.needsAuth),
          serverInfo: conn?.serverInfo || null,
          toolCount: conn?.tools?.length || 0,
          tools: (conn?.tools || []).map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly })),
        };
      });
    return only ? rows[0] || null : rows;
  }

  // The first enabled coding-agent CLI (Codex, Claude Code). Used as a last-resort executor when
  // every model is down: those agents run on their own account, so a Nutaan-side outage does not
  // stop them. Apps (Antigravity) and session/MCP tools are not executors, so they are skipped.
  firstCliAgent() {
    return this.entries().find((e) => e.enabled && e.def.kind === KINDS.CLI) || null;
  }

  // ---------- agent-facing tools ----------

  agentTools() {
    const defs = [];
    const enabled = this.entries().filter((e) => e.enabled);

    for (const e of enabled) {
      if (e.def.kind === KINDS.MCP) {
        const conn = this.connections.get(e.id);
        for (const t of conn?.tools || []) {
          defs.push({
            type: "function",
            function: {
              name: `mcp__${slug(e.id)}__${t.name}`,
              description: `[${e.def.name}] ${t.description || t.name}`.slice(0, 1024),
              parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
            },
          });
        }
      } else if (e.def.kind === KINDS.CLI) {
        defs.push({
          type: "function",
          function: {
            name: `${slug(e.id)}_task`,
            description:
              `Hand a self-contained task to ${e.def.name}, another coding agent on this machine, and get back what it did and found. ` +
              `It works in its own session with its own view of the files, so describe the task in full — it cannot see this conversation. ` +
              `Worth using for a second opinion, or for work you want done in parallel. It can take minutes. Requires user approval.`,
            parameters: {
              type: "object",
              properties: {
                prompt: { type: "string", description: "The complete task, written as if to someone who has not seen this conversation." },
                cwd: { type: "string", description: "Folder to run in. Defaults to the open project." },
              },
              required: ["prompt"],
            },
          },
        });
      } else if (e.def.kind === KINDS.APP) {
        defs.push({
          type: "function",
          function: {
            name: `${slug(e.id)}_open`,
            description: `Open a folder or file in ${e.def.name}. Defaults to the open project. Requires user approval.`,
            parameters: {
              type: "object",
              properties: { target: { type: "string", description: "Path to open. Defaults to the open project folder." } },
            },
          },
        });
      }
    }

    // One shared set of verbs for every session tool, rather than five near-identical tools per
    // service. Only offered when the user actually has a session tool switched on.
    const sessions = enabled.filter((e) => e.def.kind === KINDS.SESSION);
    if (sessions.length) {
      const names = sessions.map((e) => e.id);
      const which = { type: "string", enum: names, description: `Which tool: ${names.join(", ")}` };
      defs.push(
        {
          type: "function",
          function: {
            name: "session_open",
            description:
              `Open one of the user's signed-in web tools (${names.join(", ")}) in its own window and read what is on screen. ` +
              `Each tool keeps its own login, separate from the browser panel. Start here before any other session_* call. ` +
              `If a sign-in page comes back, tell the user to sign in once in that window — never type their password yourself.`,
            parameters: {
              type: "object",
              properties: { tool: which, url: { type: "string", description: "Optional specific URL within that tool; defaults to its home page." } },
              required: ["tool"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "session_read",
            description: "Read the current page of a session tool: its text, links, buttons and inputs, each with a selector you can act on.",
            parameters: { type: "object", properties: { tool: which }, required: ["tool"] },
          },
        },
        {
          type: "function",
          function: {
            name: "session_click",
            description: "Click an element in a session tool, using a selector from session_read.",
            parameters: {
              type: "object",
              properties: { tool: which, selector: { type: "string" } },
              required: ["tool", "selector"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "session_type",
            description:
              "Type into a field in a session tool. Set submit:true to submit afterwards. " +
              "Never type the user's password — if a sign-in is needed, stop and ask them to do it themselves.",
            parameters: {
              type: "object",
              properties: { tool: which, selector: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } },
              required: ["tool", "selector", "text"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "session_screenshot",
            description: "Take a screenshot of a session tool's window, to see a layout that reading the page cannot convey.",
            parameters: { type: "object", properties: { tool: which }, required: ["tool"] },
          },
        }
      );
    }

    return defs;
  }

  // Which of the above can run without stopping to ask. Reads are safe; anything that changes
  // something out in the world is not.
  isSafe(name) {
    if (name === "session_read" || name === "session_screenshot" || name === "session_open") return true;
    const mcp = this.parseMcpName(name);
    if (!mcp) return false;
    const conn = this.connections.get(mcp.id);
    const tool = conn?.tools?.find((t) => t.name === mcp.tool);
    // Only when the server itself says so — absence of an annotation is not a promise.
    return Boolean(tool?.readOnly);
  }

  owns(name) {
    return Boolean(this.parseMcpName(name)) || this.agentTools().some((d) => d.function.name === name);
  }

  parseMcpName(name) {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(name || ""));
    if (!m) return null;
    // The slug is lossy (a hyphen becomes an underscore), so match it back against real ids.
    const entry = this.entries().find((e) => slug(e.id) === m[1]);
    return entry ? { id: entry.id, tool: m[2] } : null;
  }

  describe(name, args) {
    const mcp = this.parseMcpName(name);
    if (mcp) {
      const e = this.entry(mcp.id);
      return { title: `${e?.def.name || mcp.id}: ${mcp.tool}`, detail: JSON.stringify(args || {}, null, 2).slice(0, 2000) };
    }
    const cli = this.entries().find((e) => e.def.kind === KINDS.CLI && `${slug(e.id)}_task` === name);
    if (cli) return { title: `Ask ${cli.def.name} to do this`, detail: String(args?.prompt || "").slice(0, 2000) };
    const app = this.entries().find((e) => e.def.kind === KINDS.APP && `${slug(e.id)}_open` === name);
    if (app) return { title: `Open in ${app.def.name}`, detail: args?.target || "the open project folder" };
    if (name === "session_click") return { title: `Click ${args?.selector} in ${args?.tool}`, detail: "" };
    if (name === "session_type") return { title: `Type into ${args?.selector} in ${args?.tool}`, detail: String(args?.text || "") };
    return null;
  }

  // ---------- running them ----------

  async call(name, args, ctx = {}) {
    const mcp = this.parseMcpName(name);
    if (mcp) return this.callMcp(mcp.id, mcp.tool, args);

    const cli = this.entries().find((e) => e.def.kind === KINDS.CLI && `${slug(e.id)}_task` === name);
    if (cli) return this.callCli(cli, args, ctx);

    const app = this.entries().find((e) => e.def.kind === KINDS.APP && `${slug(e.id)}_open` === name);
    if (app) return this.openApp(app, args, ctx);

    if (name.startsWith("session_")) return this.callSession(name.slice("session_".length), args, ctx);

    throw new Error(`No configured tool handles "${name}".`);
  }

  async callMcp(id, toolName, args) {
    const entry = this.entry(id);
    if (!entry?.enabled) throw new Error(`${entry?.def.name || id} is switched off in Tools.`);
    let state = this.connections.get(id);
    if (!state?.client) {
      await this.connect(id);
      state = this.connections.get(id);
    }
    if (!state?.client) throw new Error(state?.error || `${entry.def.name} is not connected.`);

    try {
      const result = await state.client.callTool(toolName, args);
      if (!result.ok) return { ok: false, tool: toolName, error: result.text || "The server reported an error." };
      return { ok: true, tool: toolName, result: result.text, ...(result.structured ? { data: result.structured } : {}) };
    } catch (err) {
      // An access token that expired mid-session: renew it and try once more before giving up.
      if (err.needsAuth && this.savedAuth(id)) {
        await this.connect(id);
        const retry = this.connections.get(id);
        if (retry?.client) {
          const result = await retry.client.callTool(toolName, args);
          return result.ok
            ? { ok: true, tool: toolName, result: result.text }
            : { ok: false, tool: toolName, error: result.text };
        }
      }
      throw err;
    }
  }

  callCli(entry, args, ctx) {
    const def = entry.def;
    const cfg = entry.config || {};
    const command = cfg.command || def.command;
    const prompt = String(args?.prompt || "").trim();
    if (!prompt) throw new Error(`${def.name} needs a task to work on.`);

    const argv = (def.args || []).map((a) => (a === "{prompt}" ? prompt : a));
    if (cfg.model) argv.unshift("--model", cfg.model);
    const cwd = args?.cwd || cfg.cwd || ctx.root || process.cwd();
    const timeoutMs = Math.max(30, Number(cfg.timeoutSec) || 600) * 1000;

    return new Promise((resolve) => {
      const [cmd, cmdArgs] = process.platform === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", command, ...argv]]
        : [command, argv];
      let child;
      try {
        child = spawn(cmd, cmdArgs, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        return resolve({ ok: false, agent: def.name, error: `Could not start ${command}: ${err.message}` });
      }
      let out = "";
      let err = "";
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs);
      child.stdout.on("data", (c) => { out = (out + c).slice(-MAX_CLI_OUTPUT); });
      child.stderr.on("data", (c) => { err = (err + c).slice(-MAX_CLI_OUTPUT); });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, agent: def.name, error: `${command} could not run: ${e.message}. Check the command in Tools.` });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          return resolve({ ok: false, agent: def.name, error: `${def.name} was still working after ${Math.round(timeoutMs / 1000)}s and was stopped.`, partial: out.trim().slice(-8000) || null });
        }
        resolve(
          code === 0
            ? { ok: true, agent: def.name, result: out.trim() || "(it finished without printing anything)" }
            : { ok: false, agent: def.name, exitCode: code, error: (err.trim() || out.trim() || `exited with code ${code}`).slice(-4000) }
        );
      });
    });
  }

  async openApp(entry, args, ctx) {
    const def = entry.def;
    const configured = entry.config?.path;
    const candidates = (configured ? [configured] : def[process.platform] || []).map(expandPath);
    const fsSync = require("node:fs");
    const exe = candidates.find((p) => { try { return fsSync.existsSync(p); } catch { return false; } });
    if (!exe) {
      throw new Error(
        `${def.name} was not found${candidates.length ? ` at ${candidates[0]}` : ""}. ` +
        `Set its application path in Tools.`
      );
    }
    const target = args?.target || ctx.root || process.cwd();
    if (process.platform === "darwin") {
      spawn("open", ["-a", exe, target], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn(exe, [target], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    }
    return { ok: true, opened: target, app: def.name };
  }

  async callSession(verb, args, ctx) {
    const id = String(args?.tool || "");
    const entry = this.entry(id);
    if (!entry) throw new Error(`No session tool called "${id}". Switch it on in Tools first.`);
    if (!entry.enabled) throw new Error(`${entry.def.name} is switched off in Tools.`);
    if (entry.def.kind !== KINDS.SESSION) throw new Error(`${entry.def.name} is not a session tool.`);

    const home = entry.config?.home || entry.def.home;
    return this.deps.runSessionAction(
      {
        tool: id,
        name: entry.def.name,
        // Its own cookie jar, so signing in to Gmail here has nothing to do with the browser
        // panel and one tool's session can never be mistaken for another's.
        partition: `persist:tool-${id}`,
        home,
        action: verb,
        url: args?.url || home,
        selector: args?.selector,
        text: args?.text,
        submit: Boolean(args?.submit),
      },
      ctx
    );
  }

  async closeAll() {
    for (const id of [...this.connections.keys()]) await this.disconnect(id);
  }
}

module.exports = { ToolRegistry, slug };
