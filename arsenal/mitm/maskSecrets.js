/**
 * Secret masking for MITM traffic inspection.
 * Applied to all headers/bodies before any log or storage.
 * Regex patterns are pre-compiled (ORDER IS SIGNIFICANT — BEARER first).
 *
 * Approach mirrors OmniRoute's AgentBridge maskSecrets.ts.
 */
"use strict";

// Pre-compiled regexes — ORDER IS SIGNIFICANT (BEARER must run first).
// BEARER matches the token after a standalone "Bearer " (not only after
// a literal "authorization:" prefix) so short/opaque tokens don't leak.
// Char class is bounded + linear (no nested quantifiers) → ReDoS-safe.
const BEARER    = /(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const SK_KEY    = /\b(sk|ak|pk)-[A-Za-z0-9_-]{16,}\b/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Mask secrets in a string value.
 * - Bearer tokens   → replaces the token part with "***"
 * - sk-/ak-/pk- keys → keeps first 6 + last 2 chars
 * - Long opaque tokens (≥40 chars) → keeps first 4 + last 2 chars
 *
 * @param {string} value
 * @returns {string}
 */
function maskSecret(value) {
  return String(value)
    .replace(BEARER, "$1***")
    .replace(SK_KEY, (m) => `${m.slice(0, 6)}…${m.slice(-2)}`)
    .replace(LONG_TOKEN, (m) => `${m.slice(0, 4)}…${m.slice(-2)}`);
}

module.exports = { maskSecret };
