/**
 * Nutaan OmniRoute Engine — Universal Gateway HTTP Server
 *
 * Runs locally on 127.0.0.1:20128
 * Exposes:
 *   - Local Web UI Dashboard: http://127.0.0.1:20128/
 *   - OpenAI Compatible API:   http://127.0.0.1:20128/v1/chat/completions
 *   - OpenAI Images API:       http://127.0.0.1:20128/v1/images/generations
 *   - OpenAI Models Catalog:   http://127.0.0.1:20128/v1/models
 *   - Anthropic Messages API:  http://127.0.0.1:20128/v1/messages
 *   - Stats & Health:          http://127.0.0.1:20128/api/stats
 */
"use strict";

const http = require("node:http");
const fs   = require("node:fs");
const path = require("node:path");

const { OmniRouter } = require("./router");
const { CATALOG, COMBOS } = require("./catalog");
const { getDashboardHtml } = require("./dashboard");
const {
  anthropicToOpenAiPayload,
  openAiToAnthropicResponse,
  translateOpenAiSseToAnthropic
} = require("./translator");

class OmniRouteServer {
  constructor(options = {}) {
    this.port = options.port || 20128;
    this.router = new OmniRouter(options.routerConfig || {});
    this.server = null;
    this.configFile = options.configFile || null;
    this._loadSavedConfig();
  }

  _loadSavedConfig() {
    if (!this.configFile) return;
    try {
      if (fs.existsSync(this.configFile)) {
        const saved = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
        if (saved.keys) {
          for (const [provider, key] of Object.entries(saved.keys)) {
            this.router.setKey(provider, key);
          }
        }
      }
    } catch {
      // Ignore initial load error
    }
  }

  _saveConfig(newConfig) {
    if (!this.configFile) return;
    try {
      const dir = path.dirname(this.configFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configFile, JSON.stringify(newConfig, null, 2), "utf8");
    } catch {
      // Ignore save error
    }
  }

  async start() {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      // Enable CORS for all local tools
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version, x-nutaan-source");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

      try {
        // -------------------------------------------------------------
        // Dashboard / Web UI
        // -------------------------------------------------------------
        if (url.pathname === "/" || url.pathname === "/dashboard") {
          const html = getDashboardHtml({
            port: this.port,
            activeModelsCount: CATALOG.length + 1000,
            stats: this.router.stats,
            keys: this.router.config.keys
          });
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }

        // -------------------------------------------------------------
        // Models list (/v1/models)
        // -------------------------------------------------------------
        if (url.pathname === "/v1/models" && req.method === "GET") {
          const modelList = [
            ...Object.keys(COMBOS).map((comboId) => ({
              id: comboId,
              object: "model",
              created: 1700000000,
              owned_by: "nutaan-omniroute",
              description: COMBOS[comboId].description
            })),
            ...CATALOG.map((m) => ({
              id: m.id,
              object: "model",
              created: 1700000000,
              owned_by: "nutaan-omniroute",
              permission: [],
              root: m.id,
              parent: null,
              description: m.description,
              context_window: m.contextWindow,
              type: m.type,
              output_modalities: m.output_modalities,
              tier: m.tier
            }))
          ];

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: modelList }));
          return;
        }

        // -------------------------------------------------------------
        // Stats & Config API
        // -------------------------------------------------------------
        if (url.pathname === "/api/stats" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "ok",
            stats: this.router.stats,
            modelsCount: CATALOG.length
          }));
          return;
        }

        if (url.pathname === "/api/config" && req.method === "POST") {
          const body = await this._readBodyJson(req);
          if (body.keys) {
            for (const [provider, key] of Object.entries(body.keys)) {
              this.router.setKey(provider, key);
            }
            this._saveConfig({ keys: this.router.config.keys });
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", message: "Saved" }));
          return;
        }

        // -------------------------------------------------------------
        // OpenAI Chat Completions (/v1/chat/completions)
        // -------------------------------------------------------------
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
          const body = await this._readBodyJson(req);
          await this._handleChatCompletions(req, res, body);
          return;
        }

        // -------------------------------------------------------------
        // OpenAI Image Generations (/v1/images/generations)
        // -------------------------------------------------------------
        if (url.pathname === "/v1/images/generations" && req.method === "POST") {
          const body = await this._readBodyJson(req);
          await this._handleImageGenerations(req, res, body);
          return;
        }

        // -------------------------------------------------------------
        // Anthropic Messages API (/v1/messages)
        // -------------------------------------------------------------
        if (url.pathname === "/v1/messages" && req.method === "POST") {
          const body = await this._readBodyJson(req);
          await this._handleAnthropicMessages(req, res, body);
          return;
        }

        // -------------------------------------------------------------
        // Image Proxy Router (/v1/image-proxy)
        // -------------------------------------------------------------
        if (url.pathname === "/v1/image-proxy" && req.method === "GET") {
          await this._handleImageProxy(req, res, url);
          return;
        }

        // Unknown route
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Cannot ${req.method} ${url.pathname}` } }));
      } catch (err) {
        console.error("OmniRoute error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: { message: err.message || "Internal server error" } }));
      }
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, "127.0.0.1", () => {
        resolve({ port: this.port, host: "127.0.0.1" });
      });
      this.server.on("error", reject);
    });
  }

  async _handleChatCompletions(req, res, body) {
    const isStream = Boolean(body.stream);
    const { response, modelUsed } = await this.router.routeChatCompletion(body);

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      if (!response.body) {
        res.end("data: [DONE]\n\n");
        return;
      }

      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        res.end();
      }
    } else {
      const data = await response.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    }
  }

  async _handleImageGenerations(req, res, body) {
    const result = await this.router.routeImageGeneration(body);
    const routedResponse = result.response || result;
    const data = await routedResponse.json().catch(async () => ({
      error: { message: await routedResponse.text() }
    }));
    res.writeHead(routedResponse.status || 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  async _handleAnthropicMessages(req, res, body) {
    const isStream = Boolean(body.stream);
    const openAiBody = anthropicToOpenAiPayload(body);
    const { response, modelUsed } = await this.router.routeChatCompletion(openAiBody);

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      const msgId = `msg_${Date.now()}`;
      res.write(`event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","model":"${modelUsed}","content":[]}}\n\n`);
      res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`);

      if (!response.body) {
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        res.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = decoder.decode(value);
          const anthropicEvents = translateOpenAiSseToAnthropic(chunkStr, msgId, modelUsed);
          for (const ev of anthropicEvents) {
            res.write(ev);
          }
        }
      } finally {
        res.end();
      }
    } else {
      const openAiJson = await response.json();
      const anthropicJson = openAiToAnthropicResponse(openAiJson, body.model);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(anthropicJson));
    }
  }

  async _handleImageProxy(req, res, url) {
    const fileId = url.searchParams.get("id");
    const providerId = url.searchParams.get("provider");
    
    if (!fileId || !providerId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing id or provider parameter");
      return;
    }

    const token = this.router.getKey(providerId);
    if (!token) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("No token available for provider " + providerId);
      return;
    }

    try {
      const headers = {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };
      
      const fetchUrl = `https://chatgpt.com/backend-api/files/${encodeURIComponent(fileId)}/download`;
      const proxyRes = await fetch(fetchUrl, { headers });
      
      if (!proxyRes.ok) {
        res.writeHead(proxyRes.status, { "Content-Type": "text/plain" });
        res.end(await proxyRes.text());
        return;
      }

      res.writeHead(200, {
        "Content-Type": proxyRes.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=31536000"
      });

      if (proxyRes.body) {
        const reader = proxyRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      } else {
        res.end();
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Image Proxy Error: " + err.message);
    }
  }

  _readBodyJson(req) {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = { OmniRouteServer };
