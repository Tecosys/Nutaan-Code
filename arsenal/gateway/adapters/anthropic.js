/**
 * Nutaan OmniRoute Engine — Anthropic Messages Adapter
 *
 * Supports Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku via Anthropic API
 */
"use strict";

class AnthropicAdapter {
  constructor(providerConfig) {
    this.name = providerConfig.name || "Anthropic";
    this.baseUrl = (providerConfig.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  }

  /**
   * Execute Anthropic messages request
   *
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.targetModel
   * @param {Array} options.messages
   * @param {string} [options.system]
   * @param {number} [options.max_tokens]
   * @param {boolean} [options.stream]
   * @param {Array} [options.tools]
   * @param {Object} [options.extra]
   * @returns {Promise<Response>}
   */
  async chatCompletion({ apiKey, targetModel, messages, system, max_tokens = 4096, stream = false, tools, ...extra }) {
    const url = `${this.baseUrl}/messages`;

    // Extract system prompt if present in OpenAI format messages
    let systemPrompt = system || "";
    const filteredMessages = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = (systemPrompt ? `${systemPrompt}\n\n` : "") + (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content));
      } else {
        filteredMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content
        });
      }
    }

    const body = {
      model: targetModel,
      messages: filteredMessages,
      max_tokens,
      stream,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools && tools.length ? { tools } : {}),
      ...extra
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01",
      "User-Agent": "Nutaan-OmniRoute/1.0"
    };

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }
}

module.exports = { AnthropicAdapter };
