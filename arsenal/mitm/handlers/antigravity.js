/**
 * Antigravity IDE handler.
 *
 * Antigravity (the Gemini-based IDE) sends requests in native Gemini
 * GenerateContent format to cloudcode-pa.googleapis.com. This handler:
 *
 *   1. Parses the incoming Gemini JSON body
 *   2. Unwraps the cloudcode-pa envelope (`.request.*`) if present
 *   3. Converts to OpenAI chat.completions format
 *   4. Forwards to Nutaan API /v1/chat/completions
 *   5. Pipes the SSE response back to the IDE
 *
 * Two request shapes are handled:
 *   - cloudcode-pa envelope: { project, model, request: { contents, systemInstruction, ... } }
 *   - legacy /v1beta shape:  { contents, systemInstruction, generationConfig, ... }
 */
"use strict";

const { MitmHandlerBase } = require("./base");

class AntigravityHandler extends MitmHandlerBase {
  get agentId() { return "antigravity"; }

  async intercept(req, res, body, mappedModel) {
    try {
      const geminiBody = JSON.parse(body.toString());

      // Unwrap cloudcode-pa envelope if present
      const src = resolveGeminiSource(geminiBody);

      // Streaming: Antigravity uses :streamGenerateContent for streaming
      const isStream = (req.url || "").includes(":streamGenerateContent");

      const payload = convertGeminiToOpenAI(src, mappedModel, isStream);

      const upstream = await this.fetchNutaan(payload, "/v1/chat/completions", req.headers);

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        throw new Error(`Nutaan API ${upstream.status}: ${errText}`);
      }

      if (isStream) {
        await this.pipeSSE(upstream, res);
      } else {
        // Non-streaming: read full response and write it back
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

/**
 * Return the object that actually holds the Gemini conversation fields.
 * Antigravity's cloudcode-pa envelope wraps them under `.request`;
 * the legacy /v1beta path puts them at the top level.
 *
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
function resolveGeminiSource(body) {
  const inner = body.request;
  if (
    inner &&
    typeof inner === "object" &&
    ("contents" in inner || "systemInstruction" in inner || "generationConfig" in inner)
  ) {
    return inner;
  }
  return body;
}

/**
 * Join an array of Gemini parts into a single text string.
 * @param {Array<{ text?: string }>} parts
 * @returns {string}
 */
function joinPartsText(parts) {
  return (parts || [])
    .map((p) => p.text)
    .filter((t) => typeof t === "string" && t.length > 0)
    .join("\n");
}

/**
 * Convert a Gemini GenerateContent request body to an OpenAI chat.completions body.
 *
 * @param {Record<string, unknown>} src  — the resolved Gemini source (after envelope unwrap)
 * @param {string} model               — the mapped Nutaan model string
 * @param {boolean} stream             — whether to request streaming
 * @returns {Record<string, unknown>}
 */
function convertGeminiToOpenAI(src, model, stream) {
  const messages = [];

  // System instruction
  if (src.systemInstruction) {
    const systemText = joinPartsText(src.systemInstruction.parts);
    if (systemText) messages.push({ role: "system", content: systemText });
  }

  // Chat turns
  for (const content of (src.contents || [])) {
    const role = content.role === "model" ? "assistant" : "user";
    messages.push({ role, content: joinPartsText(content.parts) });
  }

  const payload = { model, messages, stream: !!stream };

  const cfg = src.generationConfig || {};
  if (cfg.maxOutputTokens != null) payload.max_tokens = cfg.maxOutputTokens;
  if (cfg.temperature     != null) payload.temperature = cfg.temperature;
  if (cfg.topP            != null) payload.top_p = cfg.topP;
  if (cfg.stopSequences && cfg.stopSequences.length) payload.stop = cfg.stopSequences;

  return payload;
}

module.exports = { AntigravityHandler, convertGeminiToOpenAI };
