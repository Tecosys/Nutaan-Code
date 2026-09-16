"use strict";

const crypto = require("node:crypto");

class ChatGptWebAdapter {
  constructor(providerConfig) {
    this.name = providerConfig.name;
    this.baseUrl = "https://chatgpt.com/backend-api/conversation";
    this.webBaseUrl = "https://chatgpt.com/backend-api";
  }

  async chatCompletion({ apiKey, targetModel, messages, temperature, max_tokens, stream = false }) {
    // 1. Map messages to ChatGPT Web backend format
    const mappedMessages = messages.map(m => {
      let textContent = "";
      if (typeof m.content === "string") {
        textContent = m.content;
      } else if (Array.isArray(m.content)) {
        textContent = m.content.map(c => {
          if (c.type === "text") return c.text;
          if (c.type === "image_url") return "[Image omitted: ChatGPT Web adapter currently only supports text prompts]";
          return "";
        }).join("\n");
      }
      return {
        id: crypto.randomUUID(),
        author: { role: m.role === "assistant" ? "assistant" : "user" },
        content: { content_type: "text", parts: [textContent] },
        metadata: {}
      };
    });

    const body = {
      action: "next",
      messages: mappedMessages,
      parent_message_id: crypto.randomUUID(),
      model: targetModel,
      timezone_offset_min: -330,
      history_and_training_disabled: false
    };

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };

    // Note: Node's native fetch
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      return res; // Pass the 401/429 back to the router so it can fallback
    }

    if (!stream) {
      // Buffer the SSE stream and return standard JSON
      const text = await res.text();
      let fullText = "";
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.message && d.message.content && d.message.content.parts) {
              fullText = d.message.content.parts[0];
            }
          } catch(e) {}
        }
      }
      
      const fakeJson = {
        id: "chatcmpl-" + crypto.randomUUID(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: targetModel,
        choices: [{
          index: 0,
          message: { role: "assistant", content: fullText },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
      
      return new Response(JSON.stringify(fakeJson), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Streaming response
    let lastLength = 0;
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const str = Buffer.from(chunk).toString("utf-8");
        const lines = str.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.message && d.message.content && d.message.content.parts) {
                const currentFull = d.message.content.parts[0] || "";
                if (currentFull.length > lastLength) {
                  const diff = currentFull.slice(lastLength);
                  lastLength = currentFull.length;
                  
                  const fakeChunk = {
                    id: "chatcmpl-" + crypto.randomUUID(),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: targetModel,
                    choices: [{ index: 0, delta: { content: diff }, finish_reason: null }]
                  };
                  controller.enqueue(Buffer.from("data: " + JSON.stringify(fakeChunk) + "\n\n"));
                }
              }
            } catch(e) {}
          } else if (line.trim() === "data: [DONE]") {
            controller.enqueue(Buffer.from("data: [DONE]\n\n"));
          }
        }
      }
    });

    return new Response(res.body.pipeThrough(transformStream), {
      headers: { "Content-Type": "text/event-stream" }
    });
  }

  async imageGeneration({ apiKey, targetModel, prompt, n = 1, size, response_format, ...extra }) {
    // 1. Send the prompt to ChatGPT Web as a normal chat request, asking it to generate an image
    const body = {
      action: "next",
      messages: [{
        id: crypto.randomUUID(),
        author: { role: "user" },
        content: {
          content_type: "text",
          parts: [`Generate ${n || 1} image${Number(n) === 1 ? "" : "s"} from this prompt. Return the generated image itself, not instructions:\n\n${prompt}`]
        },
        metadata: {}
      }],
      parent_message_id: crypto.randomUUID(),
      model: targetModel || "gpt-4o",
      timezone_offset_min: -330,
      history_and_training_disabled: false
    };

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) return res;

    const text = await res.text();
    const events = this._parseSseJson(text);
    const candidates = this._extractImageCandidates(events);
    const data = [];
    const errors = [];

    for (const candidate of candidates) {
      if (candidate.kind === "fileId" || candidate.kind === "url") {
        let fileIdOrUrl = candidate.value;
        if (candidate.kind === "fileId") {
          fileIdOrUrl = String(candidate.value).replace(/^file-service:\/\//i, "");
        }
        const proxyUrl = `http://127.0.0.1:20128/v1/image-proxy?id=${encodeURIComponent(fileIdOrUrl)}&provider=openai`;
        data.push({ url: proxyUrl });
        if (data.length >= (Number(n) || 1)) break;
      }
    }

    if (!data.length) {
      const detail = errors.length ? ` Tried candidates:\n${errors.join("\n")}` : "";
      return new Response(JSON.stringify({
        error: {
          message: `ChatGPT Web did not return a downloadable generated image.${detail}`
        }
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      created: Math.floor(Date.now() / 1000),
      data
    }), { headers: { "Content-Type": "application/json" } });
  }

  _headers(apiKey) {
    return {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
  }

  _parseSseJson(text) {
    const out = [];
    for (const line of String(text || "").split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        out.push(JSON.parse(payload));
      } catch {}
    }
    return out;
  }

  _extractImageCandidates(events) {
    const candidates = [];
    const seen = new Set();
    const add = (kind, value) => {
      if (!value || typeof value !== "string") return;
      const key = `${kind}:${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ kind, value });
    };

    const visit = (node, key = "") => {
      if (!node) return;
      if (typeof node === "string") {
        if (/^data:image\//i.test(node)) add("dataUrl", node);
        if (/^file-service:\/\/file-/i.test(node)) add("fileId", node.replace(/^file-service:\/\//i, ""));
        if (/^file-[a-zA-Z0-9_-]+$/.test(node) && /file|image|asset|pointer|id/i.test(key)) add("fileId", node);
        if (/^https?:\/\//i.test(node) && /(oaiusercontent|chatgpt\.com|\/backend-api\/files\/|\/mnt\/data\/|image|download)/i.test(node)) add("url", node);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item, key);
        return;
      }
      if (typeof node === "object") {
        const mime = node.mime_type || node.mimeType || node.content_type || node.contentType || "";
        const name = node.name || node.filename || "";
        const fileId = node.file_id || node.fileId || node.id;
        const assetPointer = node.asset_pointer || node.assetPointer;
        const url = node.url || node.download_url || node.downloadUrl || node.image_url || node.imageUrl;
        if (/image\//i.test(mime) || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
          add("fileId", fileId);
          add("url", url);
          if (assetPointer) add("fileId", String(assetPointer).replace(/^file-service:\/\//i, ""));
        }
        for (const [childKey, value] of Object.entries(node)) visit(value, childKey);
      }
    };

    visit(events);
    return candidates;
  }

  async _downloadImageCandidate(apiKey, candidate) {
    if (candidate.kind === "dataUrl") {
      const [, b64 = ""] = candidate.value.split(",", 2);
      if (!b64) throw new Error("empty data URL");
      return Buffer.from(b64, "base64");
    }

    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
    let url = candidate.value;
    if (candidate.kind === "fileId") {
      const id = String(candidate.value).replace(/^file-service:\/\//i, "");
      url = `${this.webBaseUrl}/files/${encodeURIComponent(id)}/download`;
    }
    if (url.startsWith("/")) url = `https://chatgpt.com${url}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!/image|octet-stream/i.test(contentType)) {
      const prefix = (await res.text()).slice(0, 120);
      throw new Error(`not an image (${contentType || "unknown"}): ${prefix}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

module.exports = { ChatGptWebAdapter };
