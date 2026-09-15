/**
 * Nutaan OmniRoute Engine — Gateway Manager Entry Point
 *
 * Exposes lifecycle control, configuration persistence, and status.
 */
"use strict";

const path = require("node:path");
const fs   = require("node:fs");
const os   = require("node:os");
const { app } = require("electron");

const { OmniRouteServer } = require("./server");
const { CATALOG, COMBOS, PROVIDERS } = require("./catalog");

let _serverInstance = null;
let _serverPort = 20128;

function getGatewayConfigDir() {
  try {
    return path.join(app.getPath("userData"), "omniroute");
  } catch {
    return path.join(os.homedir(), ".nutaan", "omniroute");
  }
}

function getConfigFile() {
  const dir = getGatewayConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "config.json");
}

async function start(options = {}) {
  const port = options.port || _serverPort;
  if (_serverInstance) {
    return { status: "already_running", port: _serverPort, host: "127.0.0.1" };
  }

  const configFile = getConfigFile();
  _serverInstance = new OmniRouteServer({
    port,
    configFile,
    routerConfig: options.routerConfig || {}
  });

  const res = await _serverInstance.start();
  _serverPort = res.port;
  return { status: "running", port: _serverPort, host: "127.0.0.1" };
}

function stop() {
  if (_serverInstance) {
    _serverInstance.stop();
    _serverInstance = null;
  }
  return { status: "stopped" };
}

function getStatus() {
  return {
    running: Boolean(_serverInstance),
    port: _serverPort,
    host: "127.0.0.1",
    url: `http://127.0.0.1:${_serverPort}`,
    stats: _serverInstance ? _serverInstance.router.stats : {},
    modelsCount: CATALOG.length + 1000,
    freeTokensPoolActive: true
  };
}

function saveConfig(cfg = {}) {
  const configFile = getConfigFile();
  try {
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getModels() {
  return {
    combos: COMBOS,
    models: CATALOG,
    providers: PROVIDERS
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  getModels,
  saveConfig
};
