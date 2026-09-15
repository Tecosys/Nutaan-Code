/**
 * MitmHandlerBase — abstract base for all AgentBridge MITM handlers.
 *
 * Provides:
 *   - fetchNutaan(body, path, reqHeaders) — forward to Nutaan API
 *   - pipeSSE(upstream, res, onChunk)     — stream SSE back to IDE
 *   - writeError(res, err)                — sanitized error JSON
 *   - now()                              — performance.now() helper
 *
 * Concrete handlers: antigravity.js, kiro.js
 */
"use strict";

const { performance } = require("node:perf_hooks");
const { maskSecret } = require("../maskSecrets");
const { sanitizeHeaders } = require("../sanitizeHeaders");

class MitmHandlerBase {
  constructor(nutaanBaseUrl, nutaanApiKey) {
    this._baseUrl = (nutaanBaseUrl || "").replace(/\/+$/, "");
    this._apiKey  = nutaanApiKey || "";
  }

  get agentId() { throw new Error("Must implement agentId"); }

  /**
   * Override in concrete handler.
   * @param {import("http").IncomingMessage} req
   * @param {import("http").ServerResponse} res
   * @param {Buffer} body
   * @param {string} mappedModel
   */
  // eslint-disable-next-line no-unused-vars
  async intercept(req, res, body, mappedModel) {
    throw new Error("Must implement intercept()");
  }

  /**
   * Forward a prepared body to the Nutaan API.
   *
   * @param {unknown} body           — request body (will be JSON.stringify'd)
   * @param {string} endpointPath    — e.g. "/v1/chat/completions" or "/v1/messages"
   * @param {import("http").IncomingHttpHeaders} reqHeaders — original request headers
   * @returns {Promise<Response>}
   */
  async fetchNutaan(body, endpointPath, reqHeaders) {
    const url = `${this._baseUrl}${endpointPath}`;
    const sanitized = sanitizeHeaders(reqHeaders || {});
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this._apiKey ? { Authorization: `Bearer ${this._apiKey}` } : {}),
        "x-nutaan-source": "agent-bridge",
        "x-nutaan-agent": this.agentId,
        ...sanitized,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  /**
   * Pipe an SSE (or chunked) upstream Response back to the downstream ServerResponse.
   * Calls onChunk for each received Buffer (e.g. for logging).
   * Writes SSE-friendly headers if headers not already sent.
   *
   * @param {Response} upstream
   * @param {import("http").ServerResponse} res
   * @param {((chunk: Buffer) => void) | undefined} onChunk
   */
  async pipeSSE(upstream, res, onChunk) {
    if (!upstream.body) {
      if (!res.headersSent) res.writeHead(upstream.status, { "Content-Type": "application/json" });
      res.end();
      return;
    }

    if (!res.headersSent) {
      res.writeHead(upstream.status, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
    }

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        if (onChunk) {
          try { onChunk(buf); } catch { /* inspector must never break pipe */ }
        }
        res.write(buf);
      }
    } finally {
      try { res.end(); } catch { /* client may have disconnected */ }
    }
  }

  /**
   * Write a sanitized error JSON response.
   *
   * @param {import("http").ServerResponse} res
   * @param {unknown} err
   * @param {number} [statusCode]
   * @returns {Promise<string>} the sanitized error message
   */
  async writeError(res, err, statusCode = 500) {
    const safe = err instanceof Error ? err.message : String(err || "Unknown error");
    if (!res.headersSent) {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: { message: safe, type: "mitm_error" } }));
    return safe;
  }

  /** @returns {number} */
  now() { return performance.now(); }
}

module.exports = { MitmHandlerBase };
