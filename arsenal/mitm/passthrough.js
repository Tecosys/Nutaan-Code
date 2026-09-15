/**
 * Passthrough / bypass logic for the MITM server.
 * Determines which hostnames should be tunnelled without TLS decryption.
 *
 * Precedence: bypass list > target match > passthrough default.
 */
"use strict";

/**
 * Built-in bypass patterns — hosts that must NEVER be TLS-decrypted.
 * Banks, government sites, and corporate SSO providers.
 * @type {RegExp[]}
 */
const DEFAULT_BYPASS_PATTERNS = [
  /\.bank\./i,
  /(^|\.)gov(\.|$)/i,
  /(^|\.)okta\.com$/i,
  /(^|\.)auth0\.com$/i,
];

/**
 * Match a hostname against a simple glob pattern (only * as wildcard).
 * Implemented without RegExp to avoid ReDoS on user-supplied patterns (CWE-1333).
 * Uses a linear split-and-check algorithm.
 *
 * @param {string} hostname
 * @param {string} pattern
 * @returns {boolean}
 */
function globMatch(hostname, pattern) {
  // Guard: reject patterns with more than 8 segments after split
  const segments = pattern.toLowerCase().split("*");
  if (segments.length > 9) return false;

  const h = hostname.toLowerCase();

  // No wildcard — exact match
  if (segments.length === 1) return h === segments[0];

  // Must start with the first segment (if non-empty)
  const first = segments[0];
  if (first && !h.startsWith(first)) return false;

  // Must end with the last segment (if non-empty)
  const last = segments[segments.length - 1];
  if (last && !h.endsWith(last)) return false;

  // Walk through middle segments
  let pos = first.length;
  for (let i = 1; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === "") continue; // consecutive wildcards — skip
    const idx = h.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }

  if (last) {
    const minEnd = pos + last.length;
    if (minEnd > h.length) return false;
  }

  return true;
}

/**
 * Determine if a hostname should be bypassed (tunnelled without TLS decryption).
 *
 * @param {string} hostname
 * @param {string[]} userBypass - user-configured glob patterns
 * @returns {boolean}
 */
function shouldBypass(hostname, userBypass = []) {
  if (DEFAULT_BYPASS_PATTERNS.some((re) => re.test(hostname))) return true;
  return userBypass.some((p) => globMatch(hostname, p));
}

module.exports = { shouldBypass, globMatch, DEFAULT_BYPASS_PATTERNS };
