/**
 * Nutaan OmniRoute Engine — OpenAI-Compatible Adapter
 *
 * Supports OpenAI, OpenRouter, Groq, Cerebras, SambaNova, DeepSeek, Together,
 * Mistral, Ollama, LM Studio, etc.
 */
"use strict";

class OpenAiCompatibleAdapter {
  constructor(providerConfig) {
    this.name = providerConfig.name;
    this.baseUrl = (providerConfig.baseUrl || "").replace(/\/+$/, "");
  }

  /**
   * Execute chat completion request (streaming or buffered)
   *
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.targetModel
   * @param {Array} options.messages
   * @param {number} [options.temperature]
   * @param {number} [options.max_tokens]
   * @param {boolean} [options.stream]
   * @param {Array} [options.tools]
   * @param {Object} [options.extra]
   * @returns {Promise<Response>}
   */
  async chatCompletion({ apiKey, targetModel, messages, temperature, max_tokens, stream = false, tools, ...extra }) {
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model: targetModel,
      messages,
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max_tokens ? { max_tokens } : {}),
      ...(tools && tools.length ? { tools } : {}),
      ...extra
    };

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Nutaan-OmniRoute/1.0",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    };

    // OpenRouter requires specific attribution headers
    if (this.name === "OpenRouter") {
      headers["HTTP-Referer"] = "https://nutaan.com";
      headers["X-Title"] = "Nutaan Code";
    }

    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }
}

module.exports = { OpenAiCompatibleAdapter };
