/**
 * Nutaan Code AgentBridge — MITM Manager
 *
 * Orchestrates the full AgentBridge lifecycle:
 *   1. Generate (or load persisted) root CA key pair + certificate
 *   2. Install root CA into OS trust store
 *   3. Add /etc/hosts (or Windows hosts file) entries for target hosts
 *   4. Spawn the MITM proxy server child process (server.js)
 *
 * On stop():
 *   1. Remove hosts file entries
 *   2. Kill the child process
 *
 * Filesystem layout (under app.getPath("userData")/agentbridge/):
 *   ca.key       — root CA private key (PEM)
 *   ca.crt       — root CA certificate (PEM)
 *   server.pid   — PID of the running proxy process
 */
"use strict";

const path    = require("node:path");
const fs      = require("node:fs");
const os      = require("node:os");
const { spawn } = require("node:child_process");
const { app }   = require("electron");

const { generateRootCa, installRootCa, uninstallRootCa, isRootCaTrusted } = require("./cert");
const { addHostsEntries, removeHostsEntries, areAllHostsSpoofed } = require("./dns");
const { ALL_TARGETS } = require("./targets/index");
const { detectAntigravity } = require("./detection/antigravity");
const { detectKiro } = require("./detection/kiro");

// ---------------------------------------------------------------------------
// Storage directory
// ---------------------------------------------------------------------------
function mitmDataDir() {
  try {
    return path.join(app.getPath("userData"), "agentbridge");
  } catch {
    // Fallback when called outside Electron context (tests)
    return path.join(os.homedir(), ".nutaan", "agentbridge");
  }
}

function ensureDir() {
  const dir = mitmDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function caKeyPath()  { return path.join(ensureDir(), "ca.key"); }
function caCertPath() { return path.join(ensureDir(), "ca.crt"); }
function pidFilePath() { return path.join(ensureDir(), "server.pid"); }

// ---------------------------------------------------------------------------
// Root CA persistence
// ---------------------------------------------------------------------------
function loadOrCreateCa() {
  const keyPath  = caKeyPath();
  const certPath = caCertPath();

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      keyPem:  fs.readFileSync(keyPath,  "utf8"),
      certPem: fs.readFileSync(certPath, "utf8"),
    };
  }

  const ca = generateRootCa();
  fs.writeFileSync(keyPath,  ca.keyPem,  { mode: 0o600 });
  fs.writeFileSync(certPath, ca.certPem, { mode: 0o644 });
  return { keyPem: ca.keyPem, certPem: ca.certPem };
}

// ---------------------------------------------------------------------------
// PID file
// ---------------------------------------------------------------------------
function writePidFile(pid) {
  try { fs.writeFileSync(pidFilePath(), String(pid)); } catch { /* ignore */ }
}
function readPidFile() {
  try { return parseInt(fs.readFileSync(pidFilePath(), "utf8").trim(), 10); } catch { return null; }
}
function removePidFile() {
  try { fs.unlinkSync(pidFilePath()); } catch { /* ignore */ }
}
function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let _serverProcess = null;
let _starting = false;

// ---------------------------------------------------------------------------
// Agent detection
// ---------------------------------------------------------------------------
function detectAgents() {
  return {
    antigravity: detectAntigravity(),
    kiro:        detectKiro(),
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
async function getStatus() {
  // Check in-memory process first
  let running = _serverProcess !== null && !_serverProcess.killed;
  let pid     = running ? (_serverProcess.pid || null) : null;

  // Fallback: PID file
  if (!running) {
    const savedPid = readPidFile();
    if (savedPid && isPidAlive(savedPid)) {
      running = true;
      pid     = savedPid;
    } else if (savedPid) {
      removePidFile(); // stale
    }
  }

  // Check each target's DNS
  const allHosts = ALL_TARGETS.flatMap((t) => t.hosts);
  const dnsConfigured = areAllHostsSpoofed(allHosts);
  const certTrusted   = isRootCaTrusted();
  const certExists    = fs.existsSync(caCertPath());

  return { running, pid, dnsConfigured, certTrusted, certExists };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
/**
 * Start the AgentBridge MITM proxy.
 *
 * @param {{ nutaanKey: string, nutaanBaseUrl?: string, agentMap?: Record<string, { model: string }>, userBypass?: string[] }} opts
 * @returns {Promise<{ running: true, pid: number|null, certTrusted: boolean }>}
 */
async function start(opts = {}) {
  if (_starting) throw new Error("AgentBridge is already starting");
  const status = await getStatus();
  if (status.running) throw new Error("AgentBridge is already running");

  _starting = true;
  try {
    return await _startInternal(opts);
  } finally {
    _starting = false;
  }
}

async function _startInternal(opts) {
  // 1. Load or generate the root CA
  const ca = loadOrCreateCa();

  // 2. Install root CA into OS trust store
  let certTrusted = false;
  try {
    const result = installRootCa(caCertPath());
    certTrusted = result.installed;
    if (!result.installed) {
      console.warn("[agentbridge] Root CA not auto-trusted:", result.reason);
    }
  } catch (err) {
    console.warn("[agentbridge] Root CA install threw:", err.message);
  }

  // 3. Add hosts file entries
  const allHosts = ALL_TARGETS.flatMap((t) => t.hosts);
  try {
    addHostsEntries(allHosts);
  } catch (err) {
    console.warn("[agentbridge] Hosts file update failed:", err.message, "(continuing)");
  }

  // 4. Spawn the MITM server child process
  const serverScript = path.join(__dirname, "server.js");
  const nutaanBaseUrl = opts.nutaanBaseUrl || "https://nutaan.com/api/v1";
  const agentMap  = opts.agentMap  || {};
  const userBypass = opts.userBypass || [];
  const port = opts.port || 443;

  _serverProcess = spawn(process.execPath, [serverScript], {
    windowsHide: true,
    env: {
      ...process.env,
      MITM_LOCAL_PORT:  String(port),
      MITM_CA_KEY:      ca.keyPem,
      MITM_CA_CERT:     ca.certPem,
      NUTAAN_BASE_URL:  nutaanBaseUrl,
      NUTAAN_API_KEY:   opts.nutaanKey || "",
      MITM_AGENT_MAP:   JSON.stringify(agentMap),
      MITM_BYPASS:      JSON.stringify(userBypass),
      NODE_ENV:         "production",
    },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const proc = _serverProcess;

  if (proc.pid) writePidFile(proc.pid);

  let stderrBuf = "";
  proc.stdout?.on("data", (d) => { console.log("[agentbridge-server]", d.toString().trim()); });
  proc.stderr?.on("data", (d) => {
    stderrBuf = (stderrBuf + d.toString()).slice(-4000);
    console.error("[agentbridge-server]", d.toString().trim());
  });

  proc.on("exit", (code) => {
    console.log("[agentbridge] server exited with code", code);
    _serverProcess = null;
    removePidFile();
  });

  // Wait 1500ms to see if startup fails immediately
  const started = await new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => { if (!resolved) { resolved = true; resolve(true); } }, 1500);
    proc.on("exit", () => {
      clearTimeout(timeout);
      if (!resolved) { resolved = true; resolve(false); }
    });
    proc.stderr?.on("data", (d) => {
      if (d.toString().includes("❌")) {
        clearTimeout(timeout);
        if (!resolved) { resolved = true; resolve(false); }
      }
    });
  });

  if (!started) {
    const reason = stderrBuf.includes("EADDRINUSE") ? `Port ${port} is already in use`
      : stderrBuf.includes("EACCES") || stderrBuf.includes("permission") ? `Permission denied for port ${port} (try running as administrator)`
      : stderrBuf.trim() || "Server exited immediately";
    throw new Error("AgentBridge failed to start: " + reason);
  }

  return { running: true, pid: proc.pid || null, certTrusted };
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------
async function stop() {
  // 1. Remove hosts entries FIRST (clients stop resolving to loopback)
  try {
    removeHostsEntries();
  } catch (err) {
    console.warn("[agentbridge] Hosts cleanup failed:", err.message);
  }

  // 2. Kill the server process
  const proc = _serverProcess;
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    if (!proc.killed) proc.kill("SIGKILL");
    _serverProcess = null;
  }

  // Fallback: kill by PID file
  const savedPid = readPidFile();
  if (savedPid && isPidAlive(savedPid)) {
    try {
      process.kill(savedPid, "SIGTERM");
      await new Promise((r) => setTimeout(r, 800));
      if (isPidAlive(savedPid)) process.kill(savedPid, "SIGKILL");
    } catch { /* ignore */ }
  }
  removePidFile();

  return { running: false, pid: null };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { start, stop, getStatus, detectAgents };
