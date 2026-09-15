/**
 * Sanitize HTTP headers for safe logging and forwarding.
 * - Removes hop-by-hop headers that must not be forwarded upstream
 * - Applies maskSecret() to credential header values
 * - Coerces array values to comma-joined strings
 */
"use strict";

const { maskSecret } = require("./maskSecrets");

/**
 * Hop-by-hop headers that must never be forwarded upstream.
 * Includes connection management, framing, and host headers.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length", // recomputed by fetch
]);

/**
 * Headers whose values must be masked before logging.
 * These carry credentials/tokens that must not appear in any log.
 */
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "bearer",
  "proxy-authorization",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
function isSecretHeader(name) {
  return SECRET_HEADER_NAMES.has(name.toLowerCase());
}

/**
 * Sanitize HTTP headers.
 * Returns a plain Record<string, string> safe for logging and upstream forwarding.
 *
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {Record<string, string>}
 */
function sanitizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue;
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP.has(lowerKey)) continue;
    const strValue = Array.isArray(value) ? value.join(", ") : String(value);
    if (isSecretHeader(lowerKey)) {
      // set-cookie fully redacted — maskSecret heuristics don't catch session cookies
      result[lowerKey] = lowerKey === "set-cookie" ? "[REDACTED]" : maskSecret(strValue);
    } else {
      result[lowerKey] = strValue;
    }
  }
  return result;
}

module.exports = { sanitizeHeaders, HOP_BY_HOP, SECRET_HEADER_NAMES };
