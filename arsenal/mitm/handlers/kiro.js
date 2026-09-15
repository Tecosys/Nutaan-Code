/**
 * Kiro IDE handler.
 *
 * Kiro uses the Anthropic Messages API (POST /v1/messages with `x-api-key`).
 * We intercept the request, replace the `model` field with the mapped Nutaan
 * model, and forward to Nutaan's /v1/messages endpoint. The SSE response is
 * piped back to Kiro.
 */
"use strict";

const { MitmHandlerBase } = require("./base");

class KiroHandler extends MitmHandlerBase {
  get agentId() { return "kiro"; }

  async intercept(req, res, body, mappedModel) {
    try {
      const payload = JSON.parse(body.toString());
      payload.model = mappedModel;

      // Kiro uses Anthropic Messages API — forward to /v1/messages
      // Nutaan's gateway accepts both OpenAI and Anthropic formats
      const upstream = await this.fetchNutaan(payload, "/v1/messages", req.headers);

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        throw new Error(`Nutaan API ${upstream.status}: ${errText}`);
      }

      const isStream = payload.stream === true;

      if (isStream) {
        await this.pipeSSE(upstream, res);
      } else {
        const data = await upstream.json();
        if (!res.headersSent) {
          res.writeHead(upstream.status, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify(data));
      }
    } catch (err) {
      await this.writeError(res, err);
    }
  }
}

module.exports = { KiroHandler };
