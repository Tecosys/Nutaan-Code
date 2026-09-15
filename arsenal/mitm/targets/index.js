/**
 * Registry of all AgentBridge MITM targets.
 *
 * Exports:
 *   ALL_TARGETS          — ordered list of all supported targets
 *   resolveTarget(host)  — find target by hostname (case-insensitive exact match)
 *   routeConnection(host, bypass) — bypass / target / passthrough decision
 *
 * @typedef {{ id: string, name: string, icon: string, color: string,
 *             hosts: string[], port: number, endpointPatterns: string[],
 *             instructions: string[], authHeader: string,
 *             handlerModule: string, referenceIde?: string }} MitmTarget
 */
"use strict";

const { shouldBypass } = require("../passthrough");
const { ANTIGRAVITY_TARGET } = require("./antigravity");
const { KIRO_TARGET } = require("./kiro");

/** @type {MitmTarget[]} */
const ALL_TARGETS = [ANTIGRAVITY_TARGET, KIRO_TARGET];

/**
 * Find the target whose `hosts` list contains the given hostname.
 * Lookup is case-insensitive and uses exact equality.
 *
 * @param {string} hostname
 * @returns {MitmTarget | null}
 */
function resolveTarget(hostname) {
  if (!hostname) return null;
  const h = hostname.toLowerCase();
  for (const target of ALL_TARGETS) {
    if (target.hosts.some((host) => host.toLowerCase() === h)) return target;
  }
  return null;
}

/**
 * Decide what to do with a CONNECT/TLS connection to the given hostname.
 *
 * Precedence:
 *   1. bypass list (default + user) — never decrypt
 *   2. known target host — decrypt and dispatch to matching handler
 *   3. anything else — passthrough (transparent TCP forward)
 *
 * @param {string} hostname
 * @param {string[]} [userBypass]
 * @returns {{ kind: "bypass" } | { kind: "target", target: MitmTarget } | { kind: "passthrough" }}
 */
function routeConnection(hostname, userBypass = []) {
  if (shouldBypass(hostname, userBypass)) return { kind: "bypass" };
  const target = resolveTarget(hostname);
  if (target) return { kind: "target", target };
  return { kind: "passthrough" };
}

/**
 * Get all hostnames managed by the AgentBridge.
 * @returns {string[]}
 */
function getAllManagedHosts() {
  return ALL_TARGETS.flatMap((t) => t.hosts);
}

module.exports = { ALL_TARGETS, resolveTarget, routeConnection, getAllManagedHosts };
