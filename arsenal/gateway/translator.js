/**
 * Nutaan OmniRoute Engine — Protocol & Stream Translators
 *
 * Provides bidirectional translation between:
 *   - OpenAI Chat Completions format
 *   - Anthropic Messages format
 *   - Google Gemini generateContent format
 *
 * Ensures Antigravity (Gemini/CloudCode format) and Kiro (Anthropic format)
 * can seamlessly query ANY backend model through Nutaan OmniRoute!
 */
"use strict";

/**
 * Transform incoming Anthropic Messages payload to OpenAI Chat Completions payload
 */
function anthropicToOpenAiPayload(anthropicBody) {
  const { model, messages = [], system, max_tokens, temperature, stream } = anthropicBody;

  const openAiMessages = [];

  if (system) {
    openAiMessages.push({
      role: "system",
      content: typeof system === "string" ? system : JSON.stringify(system)
    });
  }

  for (const m of messages) {
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    }
    openAiMessages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: text
    });
  }

  return {
    model,
    messages: openAiMessages,
    ...(max_tokens ? { max_tokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    stream: Boolean(stream)
  };
}

/**
 * Transform OpenAI Chat Completion JSON response to Anthropic Messages JSON response
 */
function openAiToAnthropicResponse(openAiJson, requestedModel) {
  const choice = (openAiJson.choices && openAiJson.choices[0]) || {};
  const contentText = (choice.message && choice.message.content) || "";

  return {
    id: openAiJson.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: requestedModel || openAiJson.model || "claude-3-5-sonnet",
    content: [
      {
        type: "text",
        text: contentText
      }
    ],
    stop_reason: choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: (openAiJson.usage && openAiJson.usage.prompt_tokens) || 0,
      output_tokens: (openAiJson.usage && openAiJson.usage.completion_tokens) || 0
    }
  };
}

/**
 * Translate OpenAI SSE stream chunks into Anthropic SSE stream chunks
 *
 * @param {string} openAiChunkStr
 * @param {string} msgId
 * @param {string} modelName
 * @returns {string[]} Anthropic SSE formatted events
 */
function translateOpenAiSseToAnthropic(openAiChunkStr, msgId, modelName) {
  const lines = openAiChunkStr.split("\n");
  const outputEvents = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();

    if (payload === "[DONE]") {
      outputEvents.push(
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":10}}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`
      );
      continue;
    }

    try {
      const parsed = JSON.parse(payload);
      const delta = (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) || {};
      const content = delta.content || "";

      if (content) {
        outputEvents.push(
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(content)}}}\n\n`
        );
      }
    } catch {
      // Ignore non-json lines
    }
  }

  return outputEvents;
}

/**
 * Translate Gemini generateContent response to OpenAI Chat Completion format
 */
function geminiToOpenAiResponse(geminiJson, requestedModel) {
  const candidate = (geminiJson.candidates && geminiJson.candidates[0]) || {};
  const part = (candidate.content && candidate.content.parts && candidate.content.parts[0]) || {};
  const text = part.text || "";

  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel || "gemini-2.0-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text
        },
        finish_reason: candidate.finishReason === "STOP" ? "stop" : "stop"
      }
    ],
    usage: {
      prompt_tokens: (geminiJson.usageMetadata && geminiJson.usageMetadata.promptTokenCount) || 0,
      completion_tokens: (geminiJson.usageMetadata && geminiJson.usageMetadata.candidatesTokenCount) || 0,
      total_tokens: (geminiJson.usageMetadata && geminiJson.usageMetadata.totalTokenCount) || 0
    }
  };
}

module.exports = {
  anthropicToOpenAiPayload,
  openAiToAnthropicResponse,
  translateOpenAiSseToAnthropic,
  geminiToOpenAiResponse
};
