"use strict";
/**
 * Nutaan OmniRoute — lifecycle manager (native, in-process).
 *
 * Runs the self-contained OmniRouteServer (server.js + router + catalog +
 * adapters) directly inside the Electron main process — no external npm
 * package, no child process, no port-spawn race. This is what actually
 * delivers the free-model pool: the app's own Nutaan managed backend is the
 * first hop in every free combo, so free models work with zero user config.
 */

const path = require("node:path");
const { OmniRouteServer } = require("./server");
const { CATALOG, COMBOS, PROVIDERS } = require("./catalog");

let electronApp = null;
try { electronApp = require("electron").app; } catch { electronApp = null; }

let PORT = 20128;
let BASE = `http://127.0.0.1:${PORT}`;

let server = null;
let starting = null;
let lastError = "";
// Persisted + injected provider keys (incl. the keyless "nutaan" managed key).
const injectedKeys = {};
let apiKey = "";

function configFile() {
  try {
    return path.join(electronApp.getPath("userData"), "omniroute-config.json");
  } catch {
    return null;
  }
}

/**
 * Accept configuration from the main process. Recognized fields:
 *   apiKey       — optional master client token (unused for local, kept for UI)
 *   keys         — { providerId: key } map (e.g. { groq, gemini, openrouter })
 *   nutaanKey    — the user's Nutaan managed key → wired as the keyless free hop
 *   nutaanBase   — override for the Nutaan managed base URL
 */
function configure(config = {}) {
  if (config.apiKey !== undefined) apiKey = String(config.apiKey || "");
  if (config.keys && typeof config.keys === "object") {
    for (const [p, k] of Object.entries(config.keys)) {
      if (k) injectedKeys[p] = String(k);
    }
  }
  if (config.nutaanKey) injectedKeys.nutaan = String(config.nutaanKey);
  if (config.nutaanBase && PROVIDERS.nutaan) {
    PROVIDERS.nutaan.baseUrl = String(config.nutaanBase).replace(/\/+$/, "");
  }
  // If the server is already up, push new keys straight into the live router.
  if (server && server.router) {
    for (const [p, k] of Object.entries(injectedKeys)) server.router.setKey(p, k);
  }
}

async function start(opts = {}) {
  if (opts && Object.keys(opts).length) configure(opts);
  if (opts && opts.port) { PORT = Number(opts.port); BASE = `http://127.0.0.1:${PORT}`; }
  if (server) return { status: "running", port: PORT, host: "127.0.0.1", url: BASE };
  if (starting) return starting;

  starting = (async () => {
    try {
      lastError = "";
      const srv = new OmniRouteServer({
        port: PORT,
        configFile: configFile(),
        routerConfig: { keys: { ...injectedKeys } }
      });
      // Make sure keys handed to us before start() reach the router.
      for (const [p, k] of Object.entries(injectedKeys)) srv.router.setKey(p, k);
      await srv.start();
      server = srv;
      return { status: "running", port: PORT, host: "127.0.0.1", url: BASE };
    } catch (err) {
      lastError = err && err.code === "EADDRINUSE"
        ? `Port ${PORT} is already in use by another process.`
        : (err && err.message) || "OmniRoute failed to start.";
      throw new Error(lastError);
    } finally {
      starting = null;
    }
  })();

  return starting;
}

function stop() {
  if (server) {
    try { server.stop(); } catch { /* ignore */ }
    server = null;
  }
  return { status: "stopped" };
}

function getStatus() {
  return {
    running: !!server,
    starting: !!starting,
    port: PORT,
    url: BASE,
    dashboardUrl: BASE,
    freeTiersUrl: BASE,
    error: lastError,
    modelsCount: CATALOG.length,
    freePoolActive: true,
    stats: server && server.router ? server.router.stats : {},
    managed: !!server
  };
}

async function getModels() {
  const combos = Object.keys(COMBOS).map((id) => ({
    id,
    name: COMBOS[id].name,
    description: COMBOS[id].description,
    tier: "free",
    provider: "nutaan-omniroute"
  }));
  const models = CATALOG.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: m.provider,
    contextWindow: m.contextWindow,
    tier: m.tier
  }));
  const providers = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    tier: p.tier,
    website: p.website,
    freeQuotaInfo: p.freeQuotaInfo,
    hasKey: !!injectedKeys[id],
    keyless: id === "nutaan"
  }));
  return { models, combos, providers, modelsCount: models.length };
}

async function saveConfig(config = {}) {
  configure(config);
  return { ok: true, ...(await getModels()) };
}

if (electronApp) {
  electronApp.on("before-quit", () => { try { stop(); } catch { /* ignore */ } });
}

module.exports = { start, stop, getStatus, getModels, saveConfig, configure };
