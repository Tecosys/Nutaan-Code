/**
 * Nutaan Code AgentBridge MITM Proxy Server
 *
 * This is a standalone Node.js process spawned by MitmManager (index.js).
 * It listens on port 443 (or MITM_LOCAL_PORT env var) as an HTTPS CONNECT proxy.
 *
 * For known target hosts (cloudcode-pa.googleapis.com, api.anthropic.com):
 *   → Terminates TLS using a dynamically generated leaf cert (signed by our root CA)
 *   → Parses the HTTP request body
 *   → Dispatches to the appropriate handler (antigravity / kiro)
 *   → Forwards response back to the IDE
 *
 * For unknown hosts:
 *   → Passthrough: raw TCP tunnel without TLS decryption
 *
 * For bypass hosts (banks, .gov, okta, auth0):
 *   → Passthrough: raw TCP tunnel without TLS decryption
 *
 * Environment variables (set by MitmManager):
 *   MITM_LOCAL_PORT   — port to listen on (default 443)
 *   MITM_CA_KEY       — PEM of root CA private key
 *   MITM_CA_CERT      — PEM of root CA certificate
 *   NUTAAN_BASE_URL   — Nutaan API base URL
 *   NUTAAN_API_KEY    — Nutaan API key
 *   MITM_AGENT_MAP    — JSON: { agentId: { model: "..." } }
 *   MITM_BYPASS       — JSON: string[] of user bypass glob patterns
 */
"use strict";

const net  = require("node:net");
const tls  = require("node:tls");
const http = require("node:http");
const crypto = require("node:crypto");

const { routeConnection } = require("./targets/index");
const { generateLeafCert } = require("./cert");
const { AntigravityHandler } = require("./handlers/antigravity");
const { KiroHandler } = require("./handlers/kiro");

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------
const PORT        = parseInt(process.env.MITM_LOCAL_PORT || "443", 10);
const CA_KEY_PEM  = process.env.MITM_CA_KEY  || "";
const CA_CERT_PEM = process.env.MITM_CA_CERT || "";
const NUTAAN_URL  = process.env.NUTAAN_BASE_URL || "http://127.0.0.1:20128";
const NUTAAN_KEY  = process.env.NUTAAN_API_KEY  || "";
const AGENT_MAP   = JSON.parse(process.env.MITM_AGENT_MAP || "{}");
const USER_BYPASS = JSON.parse(process.env.MITM_BYPASS    || "[]");

if (!CA_KEY_PEM || !CA_CERT_PEM) {
  process.stderr.write("❌ MITM_CA_KEY or MITM_CA_CERT not provided — cannot start proxy\n");
  process.exit(1);
}

const caCredentials = { keyPem: CA_KEY_PEM, certPem: CA_CERT_PEM };

// ---------------------------------------------------------------------------
// Leaf cert cache — one cert per hostname
// ---------------------------------------------------------------------------
const leafCertCache = new Map();

function getLeafCert(hostname) {
  if (!leafCertCache.has(hostname)) {
    const leaf = generateLeafCert(hostname, caCredentials);
    leafCertCache.set(hostname, leaf);
  }
  return leafCertCache.get(hostname);
}

// ---------------------------------------------------------------------------
// Handler instances
// ---------------------------------------------------------------------------
const HANDLERS = {
  antigravity: new AntigravityHandler(NUTAAN_URL, NUTAAN_KEY),
  kiro:        new KiroHandler(NUTAAN_URL, NUTAAN_KEY),
};

function getModel(agentId) {
  return (AGENT_MAP[agentId] && AGENT_MAP[agentId].model) || "";
}

// ---------------------------------------------------------------------------
// Parse raw HTTP request from a Buffer
// ---------------------------------------------------------------------------
function parseHttpRequest(buf) {
  const str = buf.toString("utf8");
  const headEnd = str.indexOf("\r\n\r\n");
  if (headEnd < 0) return null;

  const headerSection = str.slice(0, headEnd);
  const lines = headerSection.split("\r\n");
  const [method, url] = lines[0].split(" ");

  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    if (colon < 0) continue;
    const key   = lines[i].slice(0, colon).trim().toLowerCase();
    const value = lines[i].slice(colon + 1).trim();
    headers[key] = value;
  }

  const body = buf.slice(headEnd + 4);
  return { method, url, headers, body };
}

// ---------------------------------------------------------------------------
// Handle an intercepted HTTPS connection (TLS terminated)
// ---------------------------------------------------------------------------
function handleInterceptedSocket(tlsSocket, hostname) {
  const chunks = [];

  tlsSocket.on("data", (chunk) => {
    chunks.push(chunk);
    // Wait for the request body — heuristic: stop collecting after 256KB or
    // when we have a complete request (Content-Length satisfied)
    const buf = Buffer.concat(chunks);
    const parsed = parseHttpRequest(buf);
    if (!parsed) return;

    const contentLength = parseInt(parsed.headers["content-length"] || "0", 10);
    if (parsed.body.length < contentLength) return; // not yet complete

    tlsSocket.removeAllListeners("data");
    dispatchRequest(tlsSocket, hostname, parsed.method, parsed.url, parsed.headers, parsed.body);
  });

  tlsSocket.on("error", () => { /* ignore client disconnect */ });
}

/**
 * Dispatch an intercepted request to the appropriate handler.
 */
async function dispatchRequest(socket, hostname, method, url, headers, body) {
  // Find the target for this hostname
  const { kind, target } = routeConnection(hostname, USER_BYPASS);

  if (kind !== "target" || !target || !HANDLERS[target.id]) {
    // Shouldn't happen — we only intercept known targets — but fail safe
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
    return;
  }

  const handler = HANDLERS[target.id];
  const mappedModel = getModel(target.id);

  // Build a fake IncomingMessage-like object
  const req = {
    method,
    url,
    headers: { ...headers, host: hostname },
  };

  // Build a fake ServerResponse-like object backed by the raw socket
  let headersSent = false;
  const res = {
    get headersSent() { return headersSent; },
    writeHead(statusCode, hdrs) {
      headersSent = true;
      let head = `HTTP/1.1 ${statusCode} ${httpStatus(statusCode)}\r\n`;
      for (const [k, v] of Object.entries(hdrs || {})) {
        head += `${k}: ${v}\r\n`;
      }
      head += "\r\n";
      socket.write(head);
    },
    write(chunk) {
      socket.write(chunk);
    },
    end(chunk) {
      if (chunk) socket.write(chunk);
      socket.end();
    },
  };

  try {
    await handler.intercept(req, res, body, mappedModel);
  } catch (err) {
    if (!headersSent) {
      const msg = JSON.stringify({ error: { message: String(err.message || err), type: "mitm_error" } });
      socket.write(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
      socket.end();
    }
  }
}

function httpStatus(code) {
  const MAP = { 200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable" };
  return MAP[code] || "Unknown";
}

// ---------------------------------------------------------------------------
// CONNECT proxy server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  res.writeHead(405); res.end("Use CONNECT");
});

server.on("connect", (req, clientSocket, head) => {
  const [hostname, portStr] = (req.url || "").split(":");
  const port = parseInt(portStr || "443", 10);
  const route = routeConnection(hostname, USER_BYPASS);

  if (route.kind === "bypass" || route.kind === "passthrough") {
    // Transparent TCP tunnel — connect to real upstream
    const remote = net.connect(port, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) remote.write(head);
      remote.pipe(clientSocket);
      clientSocket.pipe(remote);
    });
    remote.on("error", () => { clientSocket.destroy(); });
    clientSocket.on("error", () => { remote.destroy(); });
    return;
  }

  // Intercept — send 200 Connection Established then wrap in TLS
  clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head && head.length) {
    // head may contain the first bytes of the TLS ClientHello
  }

  const leaf = getLeafCert(hostname);
  const tlsSocket = new tls.TLSSocket(clientSocket, {
    isServer: true,
    key: leaf.keyPem,
    cert: leaf.certPem + CA_CERT_PEM, // leaf + CA chain
    SNICallback: (serverName, cb) => {
      const sniLeaf = getLeafCert(serverName);
      cb(null, tls.createSecureContext({
        key: sniLeaf.keyPem,
        cert: sniLeaf.certPem + CA_CERT_PEM,
      }));
    },
  });

  tlsSocket.on("secure", () => {
    handleInterceptedSocket(tlsSocket, hostname);
  });

  tlsSocket.on("error", () => { /* ignore */ });
  clientSocket.on("error", () => { tlsSocket.destroy(); });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Nutaan AgentBridge MITM proxy listening on 127.0.0.1:${PORT}\n`);
});

server.on("error", (err) => {
  process.stderr.write(`❌ MITM server error: ${err.message}\n`);
  process.exit(1);
});

// Clean shutdown
process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT",  () => { server.close(); process.exit(0); });
