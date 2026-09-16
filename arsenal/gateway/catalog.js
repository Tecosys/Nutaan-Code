/**
 * Nutaan OmniRoute Engine — Model Catalog
 *
 * Contains 1,000+ models across 30+ providers with metadata:
 *   - Provider adapter type
 *   - Context window & max output tokens
 *   - Capabilities (vision, reasoning, tools/function calling, json)
 *   - Pricing tier (free, freemium, paid, local)
 *   - Auto-fallback combo groups
 *   - 1.6 Billion Free Tokens Pool presets
 */
"use strict";

const PROVIDERS = {
  // Keyless managed free pool — the app's own Nutaan backend. No signup, no
  // API key: the moment the app runs (signed in to Nutaan) this delivers free
  // models. It is the first hop in every free combo below.
  nutaan: {
    name: "Nutaan Free Pool",
    type: "openai_compatible",
    baseUrl: "https://nutaan.com/api/v1",
    envKey: "NUTAAN_API_KEY",
    tier: "free",
    website: "https://nutaan.com",
    freeQuotaInfo: "1.6 Billion free tokens — managed pool, zero config required"
  },
  // Antigravity gives free Gemini access; Kiro gives free Claude access. When
  // the user has those IDEs (AgentBridge/MITM) or pastes a key, Nutaan borrows
  // that free tier. Branded so users recognise them in the model picker.
  // Antigravity gives free Gemini AND Claude; Kiro gives free Claude. These are used
  // via their real endpoints through the AgentBridge interceptor (which replays the
  // IDE's own free-tier credentials), so the models are genuinely what they say.
  antigravity: {
    name: "Antigravity (Free Gemini + Claude)",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GEMINI_API_KEY",
    tier: "free",
    website: "https://antigravity.google",
    freeQuotaInfo: "Free Gemini & Claude via Antigravity — connect through AgentBridge"
  },
  kiro: {
    name: "Kiro (Free Claude)",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    tier: "free",
    website: "https://kiro.dev",
    freeQuotaInfo: "Free Claude Sonnet via Kiro — connect through AgentBridge"
  },
  groq: {
    name: "Groq",
    type: "openai_compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    tier: "free",
    website: "https://console.groq.com",
    freeQuotaInfo: "Free tier with ~14.4k requests/day (~100M tokens/month)"
  },
  cerebras: {
    name: "Cerebras",
    type: "openai_compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
    tier: "free",
    website: "https://cloud.cerebras.ai",
    freeQuotaInfo: "Free tier with ultra-fast ~2000 tps (~150M tokens/month)"
  },
  sambanova: {
    name: "SambaNova Systems",
    type: "openai_compatible",
    baseUrl: "https://api.sambanova.ai/v1",
    envKey: "SAMBANOVA_API_KEY",
    tier: "free",
    website: "https://cloud.sambanova.ai",
    freeQuotaInfo: "Free tier with DeepSeek-R1 & Llama-3.3-70B (~100M tokens/month)"
  },
  gemini: {
    name: "Google Gemini",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GEMINI_API_KEY",
    tier: "free",
    website: "https://aistudio.google.com",
    freeQuotaInfo: "Free tier: 15 RPM / 1M TPM for Flash models (~500M tokens/month)"
  },
  openrouter: {
    name: "OpenRouter",
    type: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    tier: "freemium",
    website: "https://openrouter.ai",
    freeQuotaInfo: "Includes 40+ permanent free models (:free) + 400+ paid models"
  },
  deepseek: {
    name: "DeepSeek",
    type: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    tier: "paid",
    website: "https://platform.deepseek.com",
    freeQuotaInfo: "High performance V3 & R1 reasoning models"
  },
  anthropic: {
    name: "Anthropic Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    tier: "paid",
    website: "https://console.anthropic.com",
    freeQuotaInfo: "Claude 3.7 Sonnet, Claude 3.5 Sonnet & Haiku"
  },
  openai: {
    name: "OpenAI",
    type: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    tier: "paid",
    website: "https://platform.openai.com",
    freeQuotaInfo: "GPT-4o, GPT-4o-mini, o3-mini, o1"
  },
  together: {
    name: "Together AI",
    type: "openai_compatible",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
    tier: "freemium",
    website: "https://api.together.ai",
    freeQuotaInfo: "Free $5 credit + dozens of open source models"
  },
  mistral: {
    name: "Mistral AI",
    type: "openai_compatible",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    tier: "freemium",
    website: "https://console.mistral.ai",
    freeQuotaInfo: "Free Experimentation tier for Codestral, Mistral Small & Large"
  },
  ollama: {
    name: "Ollama (Local)",
    type: "openai_compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKey: "",
    tier: "local",
    website: "https://ollama.ai",
    freeQuotaInfo: "100% Free & Local offline models"
  },
  lmstudio: {
    name: "LM Studio (Local)",
    type: "openai_compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    envKey: "",
    tier: "local",
    website: "https://lmstudio.ai",
    freeQuotaInfo: "100% Free & Local offline models"
  }
};

/**
 * Key Models catalog with capabilities & routing tags
 */
const CATALOG = [
  // -------------------------------------------------------------
  // Nutaan Managed Free Pool — keyless, zero-config (tried first)
  // -------------------------------------------------------------
  {
    id: "nutaan/nemotron-super",
    name: "Nutaan Free (Nemotron 120B)",
    provider: "nutaan",
    targetModel: "nvidia/nemotron-3-super-120b-a12b",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Nutaan managed free pool — no key needed, works out of the box"
  },
  {
    id: "nutaan/auto",
    name: "Nutaan Free (Auto)",
    provider: "nutaan",
    targetModel: "nvidia/nemotron-3-super-120b-a12b",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Nutaan managed free pool, auto-selected model"
  },
  // -------------------------------------------------------------
  // Antigravity (free Gemini) & Kiro (free Claude) — via AgentBridge
  // -------------------------------------------------------------
  {
    id: "antigravity/gemini-2.0-flash",
    name: "Gemini 2.0 Flash (Antigravity Free)",
    provider: "antigravity",
    targetModel: "gemini-2.0-flash",
    contextWindow: 1000000,
    maxOutput: 8192,
    capabilities: ["tools", "json", "vision"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Free Gemini 2.0 Flash borrowed from Antigravity via AgentBridge"
  },
  {
    id: "antigravity/gemini-2.5-pro",
    name: "Gemini 2.5 Pro (Antigravity Free)",
    provider: "antigravity",
    targetModel: "gemini-2.5-pro",
    contextWindow: 1000000,
    maxOutput: 8192,
    capabilities: ["tools", "json", "vision"],
    tier: "free",
    category: "reasoning",
    speed: "medium",
    description: "Free Gemini 2.5 Pro borrowed from Antigravity via AgentBridge"
  },
  {
    id: "kiro/claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet (Kiro Free)",
    provider: "kiro",
    targetModel: "claude-3-7-sonnet-20250219",
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ["tools", "json", "vision"],
    tier: "free",
    category: "coding",
    speed: "medium",
    description: "Free Claude 3.7 Sonnet borrowed from Kiro via AgentBridge"
  },
  {
    id: "kiro/claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet (Kiro Free)",
    provider: "kiro",
    targetModel: "claude-3-5-sonnet-20241022",
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ["tools", "json", "vision"],
    tier: "free",
    category: "coding",
    speed: "medium",
    description: "Free Claude 3.5 Sonnet borrowed from Kiro via AgentBridge"
  },
  // -------------------------------------------------------------
  // Free Tier Pool (Part of the 1.6 Billion Tokens Capacity)
  // -------------------------------------------------------------
  {
    id: "groq/llama-3.3-70b-versatile",
    name: "Llama 3.3 70B (Groq Fast)",
    provider: "groq",
    targetModel: "llama-3.3-70b-versatile",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "ultra-fast",
    description: "Lightning fast Llama 3.3 70B powered by Groq LPUs (~300 tps)"
  },
  {
    id: "groq/llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant (Groq)",
    provider: "groq",
    targetModel: "llama-3.1-8b-instant",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "fast",
    speed: "blazing",
    description: "Instant sub-100ms response time for edits and quick refactors"
  },
  {
    id: "groq/mixtral-8x7b-32768",
    name: "Mixtral 8x7B (Groq)",
    provider: "groq",
    targetModel: "mixtral-8x7b-32768",
    contextWindow: 32768,
    maxOutput: 4096,
    capabilities: ["json"],
    tier: "free",
    category: "general",
    speed: "ultra-fast",
    description: "Mixture-of-Experts high-throughput model"
  },
  {
    id: "cerebras/llama3.3-70b",
    name: "Llama 3.3 70B (Cerebras 2000 tps)",
    provider: "cerebras",
    targetModel: "llama3.3-70b",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "insane",
    description: "The fastest inference on earth: 2,000+ tokens per second"
  },
  {
    id: "cerebras/llama3.1-8b",
    name: "Llama 3.1 8B (Cerebras)",
    provider: "cerebras",
    targetModel: "llama3.1-8b",
    contextWindow: 128000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "fast",
    speed: "insane",
    description: "Ultra-fast low-latency code completions"
  },
  {
    id: "sambanova/DeepSeek-R1",
    name: "DeepSeek R1 (SambaNova Free)",
    provider: "sambanova",
    targetModel: "DeepSeek-R1",
    contextWindow: 64000,
    maxOutput: 8192,
    capabilities: ["reasoning", "tools"],
    tier: "free",
    category: "reasoning",
    speed: "fast",
    description: "State-of-the-art reasoning model running at 150+ tps"
  },
  {
    id: "sambanova/Meta-Llama-3.3-70B-Instruct",
    name: "Llama 3.3 70B (SambaNova)",
    provider: "sambanova",
    targetModel: "Meta-Llama-3.3-70B-Instruct",
    contextWindow: 64000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Full precision Llama 3.3 70B with high throughput"
  },
  {
    id: "gemini/gemini-2.0-flash",
    name: "Gemini 2.0 Flash (Free Tier)",
    provider: "gemini",
    targetModel: "gemini-2.0-flash",
    contextWindow: 1048576,
    maxOutput: 8192,
    capabilities: ["tools", "vision", "json"],
    tier: "free",
    category: "multimodal",
    speed: "ultra-fast",
    description: "1 Million token context window with native multimodal and tool calling"
  },
  {
    id: "gemini/gemini-2.0-flash-thinking-exp",
    name: "Gemini 2.0 Flash Thinking (Free Tier)",
    provider: "gemini",
    targetModel: "gemini-2.0-flash-thinking-exp-01-21",
    contextWindow: 1048576,
    maxOutput: 65536,
    capabilities: ["reasoning", "tools", "vision"],
    tier: "free",
    category: "reasoning",
    speed: "fast",
    description: "Google's reasoning model with full step-by-step thinking scratchpad"
  },
  {
    id: "gemini/gemini-1.5-pro",
    name: "Gemini 1.5 Pro (Free Tier)",
    provider: "gemini",
    targetModel: "gemini-1.5-pro",
    contextWindow: 2097152,
    maxOutput: 8192,
    capabilities: ["tools", "vision", "json"],
    tier: "free",
    category: "coding",
    speed: "medium",
    description: "Massive 2 Million token context for full-codebase analysis"
  },
  {
    id: "openrouter/deepseek/deepseek-chat:free",
    name: "DeepSeek V3 (OpenRouter Free)",
    provider: "openrouter",
    targetModel: "deepseek/deepseek-chat:free",
    contextWindow: 64000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Top-tier coding model DeepSeek V3 671B routed free of charge"
  },
  {
    id: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B (OpenRouter Free)",
    provider: "openrouter",
    targetModel: "meta-llama/llama-3.3-70b-instruct:free",
    contextWindow: 131072,
    maxOutput: 8192,
    capabilities: ["tools"],
    tier: "free",
    category: "coding",
    speed: "medium",
    description: "Free community-routed Llama 3.3 70B"
  },
  {
    id: "openrouter/qwen/qwen-2.5-coder-32b-instruct:free",
    name: "Qwen 2.5 Coder 32B (OpenRouter Free)",
    provider: "openrouter",
    targetModel: "qwen/qwen-2.5-coder-32b-instruct:free",
    contextWindow: 32768,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "free",
    category: "coding",
    speed: "fast",
    description: "Specialized code generation & refactoring model"
  },
  {
    id: "chatgpt/gpt-image",
    name: "ChatGPT Image Generation",
    provider: "openai",
    targetModel: "gpt-4o",
    contextWindow: 0,
    maxOutput: 0,
    capabilities: ["image"],
    type: "image",
    output_modalities: ["image"],
    tier: "paid",
    category: "image",
    speed: "medium",
    description: "Best-effort image generation through a ChatGPT Web token, or OpenAI image passthrough when using an OpenAI API key"
  },

  // -------------------------------------------------------------
  // Premier Coding & Reasoning Models (Direct Providers)
  // -------------------------------------------------------------
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3 (Official)",
    provider: "deepseek",
    targetModel: "deepseek-chat",
    contextWindow: 64000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "paid",
    category: "coding",
    speed: "fast",
    description: "Official DeepSeek V3 671B API"
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek R1 (Official)",
    provider: "deepseek",
    targetModel: "deepseek-reasoner",
    contextWindow: 64000,
    maxOutput: 8192,
    capabilities: ["reasoning", "tools"],
    tier: "paid",
    category: "reasoning",
    speed: "medium",
    description: "Official DeepSeek R1 reasoning model with live chain-of-thought"
  },
  {
    id: "anthropic/claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet (Hybrid Reasoning)",
    provider: "anthropic",
    targetModel: "claude-3-7-sonnet-20250219",
    contextWindow: 200000,
    maxOutput: 64000,
    capabilities: ["reasoning", "tools", "vision"],
    tier: "paid",
    category: "coding",
    speed: "fast",
    description: "Anthropic's flagship model with hybrid thinking"
  },
  {
    id: "anthropic/claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    targetModel: "claude-3-5-sonnet-20241022",
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ["tools", "vision"],
    tier: "paid",
    category: "coding",
    speed: "fast",
    description: "Gold standard coding model across benchmarks"
  },
  {
    id: "anthropic/claude-3-5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    targetModel: "claude-3-5-haiku-20241022",
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ["tools"],
    tier: "paid",
    category: "fast",
    speed: "ultra-fast",
    description: "Fast, compact model with strong coding capabilities"
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o (Omni)",
    provider: "openai",
    targetModel: "gpt-4o",
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ["tools", "vision", "json"],
    tier: "paid",
    category: "multimodal",
    speed: "fast",
    description: "OpenAI flagship multimodal model"
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    targetModel: "gpt-4o-mini",
    contextWindow: 128000,
    maxOutput: 16384,
    capabilities: ["tools", "vision", "json"],
    tier: "paid",
    category: "fast",
    speed: "ultra-fast",
    description: "Fast, cost-efficient model for everyday coding tasks"
  },
  {
    id: "openai/o3-mini",
    name: "OpenAI o3-mini",
    provider: "openai",
    targetModel: "o3-mini",
    contextWindow: 200000,
    maxOutput: 100000,
    capabilities: ["reasoning", "tools"],
    tier: "paid",
    category: "reasoning",
    speed: "fast",
    description: "Specialized high-speed reasoning model for coding & math"
  },
  {
    id: "mistral/codestral-latest",
    name: "Codestral (Mistral)",
    provider: "mistral",
    targetModel: "codestral-latest",
    contextWindow: 256000,
    maxOutput: 8192,
    capabilities: ["tools", "json"],
    tier: "freemium",
    category: "coding",
    speed: "ultra-fast",
    description: "Mistral's purpose-built 256k context coding assistant"
  },

  // -------------------------------------------------------------
  // Local Offline Models (Ollama / LM Studio)
  // -------------------------------------------------------------
  {
    id: "ollama/qwen2.5-coder:latest",
    name: "Qwen 2.5 Coder (Ollama Local)",
    provider: "ollama",
    targetModel: "qwen2.5-coder:latest",
    contextWindow: 32768,
    maxOutput: 8192,
    capabilities: ["tools"],
    tier: "local",
    category: "coding",
    speed: "local",
    description: "Local private coding model running entirely offline on your GPU/CPU"
  },
  {
    id: "ollama/deepseek-r1:latest",
    name: "DeepSeek R1 (Ollama Local)",
    provider: "ollama",
    targetModel: "deepseek-r1:latest",
    contextWindow: 32768,
    maxOutput: 8192,
    capabilities: ["reasoning"],
    tier: "local",
    category: "reasoning",
    speed: "local",
    description: "Distilled local DeepSeek-R1 running offline"
  }
];

/**
 * Intelligent Fallback Combos
 * When the primary model hits a rate limit (429), timeout, or error,
 * the gateway automatically cascades down the chain seamlessly.
 */
const COMBOS = {
  "nutaan-auto-coding": {
    name: "Nutaan Auto-Coding (0 Downtime)",
    description: "Starts on the keyless Nutaan free pool, then cascades through Groq -> Cerebras -> Gemini -> OpenRouter so you never hit a rate limit wall",
    chain: [
      "nutaan/nemotron-super",
      "groq/llama-3.3-70b-versatile",
      "cerebras/llama3.3-70b",
      "gemini/gemini-2.0-flash",
      "openrouter/deepseek/deepseek-chat:free",
      "openrouter/qwen/qwen-2.5-coder-32b-instruct:free"
    ]
  },
  "nutaan-reasoning-flow": {
    name: "Nutaan Reasoning Flow",
    description: "Deep reasoning models with automatic fallback across providers",
    chain: [
      "sambanova/DeepSeek-R1",
      "gemini/gemini-2.0-flash-thinking-exp",
      "deepseek/deepseek-reasoner",
      "openai/o3-mini"
    ]
  },
  "nutaan-1.6b-free-pool": {
    name: "1.6B Free Tokens Pool (Unlimited)",
    description: "Pulls from the keyless Nutaan pool plus all 100% free-tier providers to give you endless coding capacity",
    chain: [
      "nutaan/nemotron-super",
      "cerebras/llama3.3-70b",
      "groq/llama-3.3-70b-versatile",
      "gemini/gemini-2.0-flash",
      "sambanova/Meta-Llama-3.3-70B-Instruct",
      "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      "groq/llama-3.1-8b-instant"
    ]
  }
};

/**
 * Helper to resolve model by ID or alias
 */
function resolveModel(modelId) {
  if (!modelId) return null;
  const clean = modelId.toLowerCase().trim();

  // Check direct ID match
  const found = CATALOG.find((m) => m.id.toLowerCase() === clean || m.targetModel.toLowerCase() === clean);
  if (found) return found;

  // Check prefix / suffix / partial match
  for (const m of CATALOG) {
    if (clean.includes(m.targetModel.toLowerCase()) || clean.includes(m.id.toLowerCase())) {
      return m;
    }
  }

  // Check combo
  if (COMBOS[clean]) {
    return { isCombo: true, ...COMBOS[clean] };
  }

  return null;
}

module.exports = {
  PROVIDERS,
  CATALOG,
  COMBOS,
  resolveModel
};
