/**
 * Nutaan OmniRoute Engine — Router & Cascade Fallback Manager
 *
 * Handles:
 *   - Provider adapter instantiation & key management
 *   - Auto-fallback combos on rate-limit (429) or error
 *   - Health tracking (latency, request counts, errors)
 *   - Seamless multi-provider execution
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { PROVIDERS, CATALOG, COMBOS, resolveModel } = require("./catalog");
const { OpenAiCompatibleAdapter } = require("./adapters/openai_compatible");
const { AnthropicAdapter } = require("./adapters/anthropic");
const { GeminiAdapter } = require("./adapters/gemini");

class OmniRouter {
  constructor(config = {}) {
    this.config = {
      defaultCombo: "nutaan-auto-coding",
      keys: {},
      enable1Point6BFreePool: true,
      masterToken: "nutaan-local-omniroute",
      ...config
    };

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbacksTriggered: 0,
      modelStats: {},
      recentLogs: []
    };

    this.adapters = {};
    this._initAdapters();
  }

  _initAdapters() {
    for (const [providerId, providerDef] of Object.entries(PROVIDERS)) {
      if (providerDef.type === "anthropic") {
        this.adapters[providerId] = new AnthropicAdapter(providerDef);
      } else if (providerDef.type === "gemini") {
        this.adapters[providerId] = new GeminiAdapter(providerDef);
      } else {
        this.adapters[providerId] = new OpenAiCompatibleAdapter(providerDef);
      }
    }
  }

  setKey(providerId, key) {
    this.config.keys[providerId] = key;
  }

  getKey(providerId) {
    // 1. Check user configured keys
    if (this.config.keys[providerId]) {
      return this.config.keys[providerId];
    }
    // 2. Check environment variables
    const envVar = PROVIDERS[providerId] && PROVIDERS[providerId].envKey;
    if (envVar && process.env[envVar]) {
      return process.env[envVar];
    }
    return "";
  }

  logRequest(entry) {
    this.stats.recentLogs.unshift({
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.stats.recentLogs.length > 50) {
      this.stats.recentLogs.pop();
    }
  }

  recordModelStat(modelId, latencyMs, success) {
    if (!this.stats.modelStats[modelId]) {
      this.stats.modelStats[modelId] = {
        requests: 0,
        successes: 0,
        failures: 0,
        avgLatencyMs: 0,
        lastUsed: null
      };
    }
    const stat = this.stats.modelStats[modelId];
    stat.requests++;
    if (success) {
      stat.successes++;
      stat.avgLatencyMs = stat.avgLatencyMs ? Math.round((stat.avgLatencyMs + latencyMs) / 2) : latencyMs;
    } else {
      stat.failures++;
    }
    stat.lastUsed = new Date().toISOString();
  }

  /**
   * Execute chat completion with auto-fallback cascade
   */
  async routeChatCompletion(reqBody) {
    this.stats.totalRequests++;
    const requestedModel = reqBody.model || "nutaan-auto-coding";
    const resolved = resolveModel(requestedModel);

    // Determine execution chain
    let executionChain = [];
    if (resolved && resolved.isCombo) {
      executionChain = resolved.chain;
    } else if (resolved) {
      // Direct model + fallback combo
      executionChain = [resolved.id, ...(COMBOS["nutaan-auto-coding"].chain.filter((id) => id !== resolved.id))];
    } else {
      // Default to 1.6B Free Pool / Auto-coding
      executionChain = COMBOS["nutaan-auto-coding"].chain;
    }

    let lastError = null;
    let fallbackCount = 0;

    for (const modelId of executionChain) {
      const modelDef = CATALOG.find((m) => m.id === modelId) || resolveModel(modelId);
      if (!modelDef) continue;

      const providerId = modelDef.provider;
      let adapter = this.adapters[providerId];
      const apiKey = this.getKey(providerId);

      // Dynamic override for ChatGPT Web tokens
      if (providerId === "openai" && apiKey && apiKey.startsWith("eyJ")) {
        if (!this.adapters["chatgpt_web"]) {
          const { ChatGptWebAdapter } = require("./adapters/chatgpt_web");
          this.adapters["chatgpt_web"] = new ChatGptWebAdapter(PROVIDERS["openai"]);
        }
        adapter = this.adapters["chatgpt_web"];
      }

      // If provider requires key and none exists, skip unless it's local or free
      if (!apiKey && modelDef.tier === "paid") {
        continue;
      }

      let response = null;
      let latencyMs = 0;
      let attempt = 0;
      let maxAttempts = 3; // Initial + 2 retries
      let retryError = null;

      while (attempt < maxAttempts) {
        attempt++;
        const startTime = Date.now();
        try {
          response = await adapter.chatCompletion({
            apiKey,
            targetModel: modelDef.targetModel,
            messages: reqBody.messages || [],
            temperature: reqBody.temperature,
            max_tokens: reqBody.max_tokens,
            stream: Boolean(reqBody.stream),
            tools: reqBody.tools
          });

          latencyMs = Date.now() - startTime;

          // Advanced Retry Logic for 429 Burst Limits
          if (response.status === 429) {
            const clone = response.clone();
            const errText = await clone.text().catch(()=>"");
            if (errText.toLowerCase().includes("usage limit") || errText.toLowerCase().includes("quota")) {
              break; // Hard limit reached, do not retry, just let it cascade
            }
            if (attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, attempt * 2500)); // Exponential backoff: 2.5s, 5s
              continue;
            }
          }
          break; // Success or non-retriable error
        } catch (err) {
          retryError = err;
          latencyMs = Date.now() - startTime;
          break; // Network error, handled below
        }
      }

      if (retryError) {
        this.recordModelStat(modelDef.id, latencyMs, false);
        this.stats.fallbacksTriggered++;
        fallbackCount++;
        lastError = retryError;
        continue;
      }

      try {
        // If rate limited (429) or temporary error (500, 502, 503, 504), trigger auto-fallback!
        if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
          const errText = await response.text();
          this.recordModelStat(modelDef.id, latencyMs, false);
          this.stats.fallbacksTriggered++;
          fallbackCount++;

          this.logRequest({
            model: modelDef.id,
            status: response.status,
            fallback: true,
            reason: `HTTP ${response.status}: Rate limit / temporary error. Cascading to next model.`
          });

          lastError = new Error(`Model ${modelDef.id} returned HTTP ${response.status}: ${errText}`);
          continue; // Try next in chain!
        }

        if (!response.ok) {
          const errText = await response.text();
          this.recordModelStat(modelDef.id, latencyMs, false);
          // If error is authentication/bad request, try next model in combo
          fallbackCount++;
          lastError = new Error(`Model ${modelDef.id} failed (${response.status}): ${errText}`);
          continue;
        }

        // Success!
        this.stats.successfulRequests++;
        this.recordModelStat(modelDef.id, latencyMs, true);

        this.logRequest({
          model: modelDef.id,
          status: 200,
          latencyMs,
          fallbacksUsed: fallbackCount,
          stream: Boolean(reqBody.stream)
        });

        return {
          response,
          modelUsed: modelDef.id,
          providerUsed: providerId,
          targetModel: modelDef.targetModel,
          fallbacksUsed: fallbackCount
        };
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        this.recordModelStat(modelDef.id, latencyMs, false);
        this.stats.fallbacksTriggered++;
        fallbackCount++;
        lastError = err;
        continue; // Try next in chain
      }
    }

    this.stats.failedRequests++;
    throw lastError || new Error("All models in the Nutaan OmniRoute cascade failed or were unconfigured.");
  }

  async routeImageGeneration(reqBody) {
    this.stats.totalRequests++;
    const requestedModel = reqBody.model || "chatgpt/gpt-image";
    const resolved = resolveModel(requestedModel);
    const modelDef = resolved && !resolved.isCombo
      ? resolved
      : CATALOG.find((m) => m.id === "chatgpt/gpt-image");

    if (!modelDef) throw new Error(`Image model ${requestedModel} is not configured.`);

    const providerId = modelDef.provider;
    let adapter = this.adapters[providerId];
    const apiKey = this.getKey(providerId);

    if (providerId === "openai" && apiKey && apiKey.startsWith("eyJ")) {
      if (!this.adapters["chatgpt_web"]) {
        const { ChatGptWebAdapter } = require("./adapters/chatgpt_web");
        this.adapters["chatgpt_web"] = new ChatGptWebAdapter(PROVIDERS["openai"]);
      }
      adapter = this.adapters["chatgpt_web"];
    }

    if (!adapter || typeof adapter.imageGeneration !== "function") {
      throw new Error(`${PROVIDERS[providerId]?.name || providerId} does not support image generation through this gateway.`);
    }
    if (!apiKey && modelDef.tier === "paid") {
      throw new Error(`${PROVIDERS[providerId]?.name || providerId} requires an API key for image generation.`);
    }

    const startTime = Date.now();
    const response = await adapter.imageGeneration({
      apiKey,
      targetModel: modelDef.targetModel,
      prompt: reqBody.prompt,
      n: reqBody.n,
      size: reqBody.size,
      response_format: reqBody.response_format
    });
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      this.recordModelStat(modelDef.id, latencyMs, false);
      this.stats.failedRequests++;
      this.logRequest({ model: modelDef.id, status: response.status, image: true, reason: errText.slice(0, 300) });
      return new Response(errText, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") || "application/json" }
      });
    }

    this.stats.successfulRequests++;
    this.recordModelStat(modelDef.id, latencyMs, true);
    this.logRequest({ model: modelDef.id, status: 200, image: true, latencyMs });
    return { response, modelUsed: modelDef.id, providerUsed: providerId, targetModel: modelDef.targetModel };
  }
}

module.exports = { OmniRouter };
