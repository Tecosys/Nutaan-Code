/**
 * Nutaan OmniRoute Engine — Google Gemini REST Adapter
 *
 * Supports Gemini 2.0 Flash, Gemini 2.0 Flash Thinking, Gemini 1.5 Pro via Google AI Studio API
 */
"use strict";

class GeminiAdapter {
  constructor(providerConfig) {
    this.name = providerConfig.name || "Google Gemini";
    this.baseUrl = (providerConfig.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  }

  /**
   * Convert OpenAI messages format to Gemini contents format
   */
  _formatContents(messages) {
    let systemInstruction = null;
    const contents = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }]
        };
      } else {
        const role = msg.role === "assistant" ? "model" : "user";
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content.map((p) => p.text || "").join("\n");
        }
        contents.push({
          role,
          parts: [{ text }]
        });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Execute Gemini generateContent request
   */
  async chatCompletion({ apiKey, targetModel, messages, temperature, max_tokens, stream = false }) {
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const url = `${this.baseUrl}/models/${targetModel}:${action}&key=${apiKey || ""}`;

    const { systemInstruction, contents } = this._formatContents(messages);

    const body = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(max_tokens ? { maxOutputTokens: max_tokens } : {})
      }
    };

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Nutaan-OmniRoute/1.0"
      },
      body: JSON.stringify(body)
    });
  }
}

module.exports = { GeminiAdapter };
