/**
 * Test Nutaan OmniRoute Gateway & Interception Engine
 */
"use strict";

const assert = require("node:assert");
const gateway = require("../arsenal/gateway");
const { resolveModel, CATALOG, COMBOS } = require("../arsenal/gateway/catalog");
const {
  anthropicToOpenAiPayload,
  openAiToAnthropicResponse,
  translateOpenAiSseToAnthropic
} = require("../arsenal/gateway/translator");

async function runTests() {
  console.log("=== Testing Nutaan OmniRoute Engine ===");

  // 1. Test Catalog & Model Resolution
  console.log("1. Testing Model Catalog & Combos...");
  assert(CATALOG.length >= 15, "Catalog should have core models");
  assert(COMBOS["nutaan-auto-coding"], "nutaan-auto-coding combo exists");
  assert(COMBOS["nutaan-1.6b-free-pool"], "1.6B free tokens pool combo exists");

  const groqModel = resolveModel("groq/llama-3.3-70b-versatile");
  assert(groqModel && groqModel.provider === "groq", "Resolved Groq model");

  const cerebrasModel = resolveModel("cerebras/llama3.3-70b");
  assert(cerebrasModel && cerebrasModel.provider === "cerebras", "Resolved Cerebras model");

  const sambanovaModel = resolveModel("sambanova/DeepSeek-R1");
  assert(sambanovaModel && sambanovaModel.provider === "sambanova", "Resolved SambaNova DeepSeek-R1 model");

  const comboResolved = resolveModel("nutaan-auto-coding");
  assert(comboResolved && comboResolved.isCombo, "Resolved combo chain");
  console.log("✓ Catalog & Model Resolution Passed");

  // 2. Test Anthropic <-> OpenAI Protocol Translators
  console.log("2. Testing Protocol Translators (for Kiro/Claude Code interception)...");
  const anthropicReq = {
    model: "claude-3-5-sonnet-20241022",
    system: "You are Nutaan Assistant",
    messages: [
      { role: "user", content: "Hello from Kiro" }
    ]
  };
  const openAiTranslated = anthropicToOpenAiPayload(anthropicReq);
  assert.strictEqual(openAiTranslated.messages[0].role, "system");
  assert.strictEqual(openAiTranslated.messages[1].role, "user");
  assert.strictEqual(openAiTranslated.messages[1].content, "Hello from Kiro");

  const mockOpenAiRes = {
    id: "chatcmpl_123",
    model: "llama-3.3-70b",
    choices: [{ message: { role: "assistant", content: "Hi! I am routed through Nutaan." }, finish_reason: "stop" }]
  };
  const anthropicRes = openAiToAnthropicResponse(mockOpenAiRes, "claude-3-5-sonnet");
  assert.strictEqual(anthropicRes.content[0].text, "Hi! I am routed through Nutaan.");
  assert.strictEqual(anthropicRes.model, "claude-3-5-sonnet");

  const sseChunk = 'data: {"choices":[{"delta":{"content":"Streaming via Nutaan"}}]}\n\n';
  const anthropicSse = translateOpenAiSseToAnthropic(sseChunk, "msg_1", "claude-3-5-sonnet");
  assert(anthropicSse.length > 0, "Generated Anthropic SSE events");
  assert(anthropicSse[0].includes("Streaming via Nutaan"), "Translated delta content");
  console.log("✓ Protocol Translators Passed");

  // 3. Test Gateway Server Lifecycle & Endpoints
  console.log("3. Testing Gateway Server Lifecycle...");
  const startResult = await gateway.start({ port: 20129 }); // test port
  assert.strictEqual(startResult.status, "running");

  const status = gateway.getStatus();
  assert.strictEqual(status.running, true);
  assert.strictEqual(status.port, 20129);

  // Test /v1/models endpoint via HTTP
  const modelsRes = await fetch("http://127.0.0.1:20129/v1/models");
  assert.strictEqual(modelsRes.status, 200);
  const modelsJson = await modelsRes.json();
  assert(Array.isArray(modelsJson.data), "Models list returned");
  assert(modelsJson.data.some((m) => m.id === "nutaan-auto-coding"), "Contains combo models");
  assert(modelsJson.data.some((m) => m.id.includes("groq")), "Contains Groq models");
  assert(modelsJson.data.some((m) => m.id.includes("cerebras")), "Contains Cerebras models");

  // Stop server
  gateway.stop();
  const stoppedStatus = gateway.getStatus();
  assert.strictEqual(stoppedStatus.running, false);
  console.log("✓ Gateway Server Lifecycle & Endpoints Passed");

  console.log("\n===========================================");
  console.log("🎉 ALL NUTAAN OMNIROUTE TESTS PASSED SUCCESSFULLY!");
  console.log("===========================================\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
