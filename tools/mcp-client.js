// A Model Context Protocol client, dependency-free.
//
// Two transports, one interface. Remote servers speak JSON-RPC over HTTP POST and may answer
// either with plain JSON or with a one-shot SSE stream; local servers speak the same JSON-RPC as
// newline-delimited messages over stdin/stdout. Everything above this file — the registry, the
// agent loop, the UI — only ever sees connect / listTools / callTool / close.

const { spawn } = require("node:child_process");

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "nutaan-code", version: "1.0.0" };
const DEFAULT_TIMEOUT_MS = 60_000;

class McpError extends Error {
  constructor(message, { code = null, retryable = false, needsAuth = false, wwwAuthenticate = null } = {}) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.retryable = retryable;
    this.needsAuth = needsAuth;
    this.wwwAuthenticate = wwwAuthenticate;
  }
}

// A server may answer a POST with `application/json` or with `text/event-stream` carrying the one
// response as a single `data:` line. Accepting only the first is the usual reason a client works
// against one server and mysteriously hangs against another.
function parseRpcPayload(contentType, raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (String(contentType || "").includes("text/event-stream")) {
    let last = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const body = line.slice(5).trim();
      if (!body || body === "[DONE]") continue;
      try { last = JSON.parse(body); } catch {}
    }
    return last;
  }
  try { return JSON.parse(text); } catch { return null; }
}

class HttpTransport {
  constructor({ url, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.url = url;
    this.extraHeaders = headers;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      // Both, always: which one we get back is the server's choice, not ours.
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...this.extraHeaders,
    };
  }

  async send(message, { expectReply = true } = {}) {
    let res;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const code = err?.cause?.code || err?.name;
      throw new McpError(
        code === "TimeoutError" || err?.name === "TimeoutError"
          ? `${this.url} did not respond within ${Math.round(this.timeoutMs / 1000)}s`
          : `Could not reach ${this.url}${code ? ` (${code})` : ""}`,
        { code, retryable: true }
      );
    }

    // A session id arrives on initialize and must be echoed on every later call; stateless
    // servers never send one and must not be sent one back.
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (res.status === 401 || res.status === 403) {
      throw new McpError("This server needs you to sign in before it will answer.", {
        code: res.status,
        needsAuth: true,
        // Tells the OAuth layer exactly which metadata document describes this resource.
        wwwAuthenticate: res.headers.get("www-authenticate"),
      });
    }
    if (!expectReply) return null;
    const raw = await res.text();
    if (!res.ok) {
      throw new McpError(`${this.url} returned HTTP ${res.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`, {
        code: res.status,
        retryable: res.status >= 500,
      });
    }
    const parsed = parseRpcPayload(res.headers.get("content-type"), raw);
    if (!parsed) throw new McpError(`${this.url} sent a reply this client could not read: ${raw.slice(0, 200)}`);
    return parsed;
  }

  async close() {}
}

class StdioTransport {
  constructor({ command, args = [], env = {}, cwd = undefined, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.exited = null;
  }

  start() {
    if (this.child) return;
    // Most MCP servers are launched through a .cmd shim on Windows (npx, and anything installed
    // by npm), which is a script rather than an executable image and will not spawn directly.
    // Going through cmd.exe explicitly handles that without `shell: true`, which would concatenate
    // the arguments into one unescaped string.
    const [cmd, cmdArgs] = process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", this.command, ...this.args]]
      : [this.command, this.args];
    try {
      this.child = spawn(cmd, cmdArgs, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      throw new McpError(`Could not start "${this.command}": ${err.message}`);
    }

    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    // Servers use stderr for logging, so it is only interesting when something has gone wrong —
    // keep the tail of it to explain a failure, and let the rest go.
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    this.child.on("error", (err) => this.failAll(new McpError(`"${this.command}" could not run: ${err.message}`)));
    this.child.on("exit", (code, signal) => {
      this.exited = { code, signal };
      this.failAll(new McpError(
        `"${this.command}" exited (${signal || "code " + code})` +
        (this.stderr.trim() ? `:\n${this.stderr.trim().slice(-600)}` : "")
      ));
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString();
    // Messages are newline-delimited JSON. A large tools/list can arrive split across several
    // chunks, so only complete lines are parsed and the remainder stays buffered.
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // servers do print stray text; skip it
      const waiter = this.pending.get(msg.id);
      if (waiter) {
        this.pending.delete(msg.id);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
      }
    }
  }

  failAll(err) {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.pending.clear();
  }

  send(message, { expectReply = true } = {}) {
    this.start();
    if (this.exited) throw new McpError(`"${this.command}" is not running.`);
    const line = JSON.stringify(message) + "\n";
    if (!expectReply) {
      try { this.child.stdin.write(line); } catch {}
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(new McpError(`"${this.command}" did not answer ${message.method} within ${Math.round(this.timeoutMs / 1000)}s`));
      }, this.timeoutMs);
      this.pending.set(message.id, { resolve, reject, timer });
      try { this.child.stdin.write(line); } catch (err) {
        clearTimeout(timer);
        this.pending.delete(message.id);
        reject(new McpError(`Could not write to "${this.command}": ${err.message}`));
      }
    });
  }

  async close() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.failAll(new McpError("Connection closed."));
    try { child.stdin.end(); } catch {}
    // Give it a moment to shut down on its own before insisting.
    await new Promise((r) => setTimeout(r, 300));
    try { child.kill(); } catch {}
  }
}

class McpClient {
  constructor(spec) {
    this.spec = spec;
    this.transport = spec.transport === "stdio" ? new StdioTransport(spec) : new HttpTransport(spec);
    this.nextId = 1;
    this.serverInfo = null;
    this.capabilities = null;
    this.tools = [];
  }

  async rpc(method, params) {
    const id = this.nextId++;
    const reply = await this.transport.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    if (!reply) throw new McpError(`No reply to ${method}`);
    if (reply.error) {
      throw new McpError(reply.error.message || `${method} failed`, { code: reply.error.code });
    }
    return reply.result;
  }

  notify(method, params) {
    return this.transport.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }, { expectReply: false });
  }

  async connect() {
    const result = await this.rpc("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: false }, sampling: {} },
      clientInfo: CLIENT_INFO,
    });
    this.serverInfo = result?.serverInfo || null;
    this.capabilities = result?.capabilities || {};
    // Required by the spec before any other request; servers that enforce it reject tools/list
    // outright without it.
    try { await this.notify("notifications/initialized"); } catch {}
    if (this.capabilities.tools) await this.refreshTools();
    return { serverInfo: this.serverInfo, capabilities: this.capabilities, tools: this.tools };
  }

  async refreshTools() {
    const tools = [];
    let cursor;
    // Paginated: a server with many tools hands back a cursor rather than the whole list.
    do {
      const page = await this.rpc("tools/list", cursor ? { cursor } : undefined);
      for (const t of page?.tools || []) {
        tools.push({
          name: t.name,
          title: t.title || t.annotations?.title || null,
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object", properties: {} },
          // Servers that annotate their tools tell us which ones only read — the registry uses
          // this to decide what can run without stopping to ask the user.
          readOnly: t.annotations?.readOnlyHint === true,
          destructive: t.annotations?.destructiveHint === true,
        });
      }
      cursor = page?.nextCursor;
    } while (cursor && tools.length < 500);
    this.tools = tools;
    return tools;
  }

  async callTool(name, args) {
    const result = await this.rpc("tools/call", { name, arguments: args || {} });
    return normaliseToolResult(result);
  }

  async close() {
    try { await this.transport.close(); } catch {}
  }
}

// MCP returns content as a list of typed blocks. The agent loop wants something it can put in a
// message, so text is joined and anything else is described rather than dropped silently.
function normaliseToolResult(result) {
  if (!result) return { ok: true, text: "" };
  if (result.structuredContent && !result.content?.length) {
    return { ok: !result.isError, structured: result.structuredContent, text: JSON.stringify(result.structuredContent) };
  }
  const parts = [];
  const images = [];
  for (const block of result.content || []) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "image") images.push({ mimeType: block.mimeType, data: block.data });
    else if (block.type === "resource" && block.resource) {
      parts.push(block.resource.text || `[resource: ${block.resource.uri || "unnamed"}]`);
    } else if (block.type === "resource_link") parts.push(`[${block.name || "resource"}: ${block.uri}]`);
    else parts.push(`[${block.type}]`);
  }
  return {
    ok: !result.isError,
    text: parts.join("\n").trim(),
    ...(images.length ? { images } : {}),
    ...(result.structuredContent ? { structured: result.structuredContent } : {}),
  };
}

module.exports = { McpClient, McpError, PROTOCOL_VERSION, parseRpcPayload, normaliseToolResult };
