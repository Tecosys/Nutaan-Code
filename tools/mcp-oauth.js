// OAuth for remote MCP servers, the way the MCP spec lays it out.
//
// The point of all this is that the user never has to go and create an app registration. A server
// that says 401 tells us where its metadata lives; the metadata tells us where its authorisation
// server is; the authorisation server lets us register a client on the spot. So connecting to a
// hosted MCP server is one button and one browser sign-in, with no client id to paste anywhere.
//
// Discovery: RFC 9728 (protected resource) -> RFC 8414 (authorisation server metadata)
// Registration: RFC 7591 (dynamic client registration)
// Grant: authorization_code + PKCE (RFC 7636) on a loopback redirect (RFC 8252)

const crypto = require("node:crypto");
const http = require("node:http");

const REDIRECT_HOST = "127.0.0.1";

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`${url} returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// The 401 carries `resource_metadata="<url>"`. Without it we fall back to the well-known path,
// which is what servers that predate the header still use.
function resourceMetadataUrl(serverUrl, wwwAuthenticate) {
  const m = /resource_metadata="([^"]+)"/i.exec(String(wwwAuthenticate || ""));
  if (m) return m[1];
  const u = new URL(serverUrl);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`;
}

async function discover(serverUrl, wwwAuthenticate) {
  const resource = new URL(serverUrl).origin;
  let issuer = resource;
  let scopes = [];
  try {
    const meta = await getJson(resourceMetadataUrl(serverUrl, wwwAuthenticate));
    if (Array.isArray(meta.authorization_servers) && meta.authorization_servers.length) issuer = meta.authorization_servers[0];
    if (Array.isArray(meta.scopes_supported)) scopes = meta.scopes_supported;
  } catch {
    // No protected-resource document: assume the server is its own authorisation server.
  }

  const base = issuer.replace(/\/$/, "");
  const issuerPath = new URL(base).pathname.replace(/\/$/, "");
  const origin = new URL(base).origin;
  // RFC 8414 puts the suffix after the well-known segment; OpenID puts it before. Try both, plus
  // the plain form, because real servers are split across all three.
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${base}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration${issuerPath}`,
    `${base}/.well-known/openid-configuration`,
  ];
  for (const url of candidates) {
    try {
      const meta = await getJson(url);
      if (meta.authorization_endpoint && meta.token_endpoint) {
        return {
          issuer: meta.issuer || base,
          authorizationEndpoint: meta.authorization_endpoint,
          tokenEndpoint: meta.token_endpoint,
          registrationEndpoint: meta.registration_endpoint || null,
          scopesSupported: meta.scopes_supported || scopes,
          resource,
        };
      }
    } catch {
      // try the next shape
    }
  }
  throw new Error(
    `${issuer} does not publish OAuth metadata, so this server cannot be connected automatically. ` +
    `If it issues API tokens instead, add it as a custom MCP server with an Authorization header.`
  );
}

async function registerClient(meta, redirectUri) {
  if (!meta.registrationEndpoint) {
    throw new Error(
      `${meta.issuer} does not allow apps to register themselves, so it needs a client ID created by hand ` +
      `in its developer console. Add it as a custom MCP server once you have one.`
    );
  }
  const body = {
    client_name: "Nutaan Code",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // a desktop app cannot keep a secret
    application_type: "native",
  };
  const res = await fetch(meta.registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Registering with ${meta.issuer} failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  const reg = JSON.parse(text);
  if (!reg.client_id) throw new Error(`${meta.issuer} registered the app but returned no client id.`);
  return { clientId: reg.client_id, clientSecret: reg.client_secret || null };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// The redirect listener and the port it chose have to be available together, so this returns both
// rather than trying to smuggle the port out of a promise.
function startRedirectListener({ timeoutMs = 300_000 } = {}) {
  const server = http.createServer();
  let settle;
  const result = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  let settled = false;
  const finish = (kind, arg) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { server.close(() => {}); } catch {}
    settle[kind](arg);
  };
  const timer = setTimeout(() => finish("reject", new Error("Timed out waiting for the sign-in to finish.")), timeoutMs);

  server.on("request", (req, res) => {
    const url = new URL(req.url, `http://${REDIRECT_HOST}`);
    if (!url.pathname.startsWith("/callback")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const ok = !error && Boolean(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      `<!doctype html><meta charset="utf-8"><title>${ok ? "Connected" : "Sign-in failed"}</title>` +
      `<style>body{font:15px system-ui,sans-serif;background:#0f1117;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0}` +
      `div{text-align:center;max-width:30rem;padding:2rem}h1{font-size:1.15rem;margin:0 0 .5rem}p{color:#9aa1b1;margin:0}</style>` +
      `<div><h1>${ok ? "Connected to Nutaan Code" : "Sign-in failed"}</h1>` +
      `<p>${ok ? "You can close this tab and go back to the app." : escapeHtml(url.searchParams.get("error_description") || error || "No authorisation code was returned.")}</p></div>`
    );
    if (ok) finish("resolve", { code, state: url.searchParams.get("state") });
    else finish("reject", new Error(url.searchParams.get("error_description") || error || "Sign-in was cancelled."));
  });
  server.on("error", (err) => finish("reject", err));

  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, REDIRECT_HOST, () => resolve(server.address().port));
  });

  return { listening, result, cancel: () => finish("reject", new Error("Sign-in cancelled.")) };
}

async function exchangeToken(meta, params) {
  const res = await fetch(meta.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Token endpoint returned something that is not JSON: ${text.slice(0, 120)}`); }
  if (!json.access_token) throw new Error("The authorisation server returned no access token.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    tokenType: json.token_type || "Bearer",
    // Refresh a minute early so a call never goes out with a token that expires mid-flight.
    expiresAt: json.expires_in ? Date.now() + (Number(json.expires_in) - 60) * 1000 : null,
    scope: json.scope || null,
  };
}

// `openBrowser` is injected so this file never has to know about Electron.
async function authorize({ serverUrl, wwwAuthenticate, saved, openBrowser, scopes }) {
  const meta = saved?.meta || (await discover(serverUrl, wwwAuthenticate));
  const listener = startRedirectListener();
  const port = await listener.listening;
  const redirectUri = `http://${REDIRECT_HOST}:${port}/callback`;

  // A client registered against a different port is still valid: the redirect URI is registered
  // per client, so a fresh registration is needed whenever the port changes.
  const client = await registerClient(meta, redirectUri);
  const { verifier, challenge } = makePkce();
  const state = b64url(crypto.randomBytes(16));

  const authUrl = new URL(meta.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  // RFC 8707: tells the authorisation server which resource the token is for, which servers
  // fronting several APIs need in order to issue a usable token.
  if (meta.resource) authUrl.searchParams.set("resource", meta.resource);
  const wanted = scopes || meta.scopesSupported;
  if (wanted?.length) authUrl.searchParams.set("scope", wanted.join(" "));

  await openBrowser(authUrl.toString());

  const { code, state: returnedState } = await listener.result;
  if (returnedState && returnedState !== state) throw new Error("The sign-in came back with the wrong state value; it was not completed safely.");

  const token = await exchangeToken(meta, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: client.clientId,
    code_verifier: verifier,
    ...(meta.resource ? { resource: meta.resource } : {}),
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
  });

  return { meta, client, token };
}

async function refresh({ meta, client, token }) {
  if (!token?.refreshToken) throw new Error("This connection has expired and cannot be renewed on its own — connect it again.");
  const fresh = await exchangeToken(meta, {
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
    client_id: client.clientId,
    ...(meta.resource ? { resource: meta.resource } : {}),
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
  });
  // Servers that rotate refresh tokens send a new one; those that don't expect the old one to be kept.
  return { ...fresh, refreshToken: fresh.refreshToken || token.refreshToken };
}

function isExpired(token) {
  return Boolean(token?.expiresAt && Date.now() >= token.expiresAt);
}

module.exports = { discover, authorize, refresh, isExpired, startRedirectListener };
