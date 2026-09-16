"use strict";

const crypto = require("node:crypto");

class ChatGptWebAdapter {
  constructor(providerConfig) {
    this.name = providerConfig.name;
    this.baseUrl = "https://chatgpt.com/backend-api/conversation";
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
}

module.exports = { ChatGptWebAdapter };
