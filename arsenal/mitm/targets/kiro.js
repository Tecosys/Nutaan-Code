/**
 * Kiro IDE target descriptor.
 *
 * Kiro removed its Base URL / API Key UI. It sends Anthropic Messages API
 * requests to api.anthropic.com with an x-api-key header. We intercept these
 * requests via MITM and route them through Nutaan.
 */
"use strict";

const HOSTS = ["api.anthropic.com"];
const ENDPOINT_PATTERNS = ["/v1/messages"];

const INSTRUCTIONS = [
  "1. Click 'Start AgentBridge' — a local HTTPS proxy starts on port 443",
  "2. The Nutaan Code root CA is installed into your system trust store",
  "3. Your hosts file is updated to redirect Kiro traffic through Nutaan",
  "4. Open Kiro IDE — API calls will be automatically routed through Nutaan",
  "5. Verify: check proxy logs in Nutaan Code",
];

/** @type {import('./index').MitmTarget} */
const KIRO_TARGET = {
  id: "kiro",
  name: "Kiro IDE",
  icon: "code_blocks",
  color: "#8B5CF6",
  hosts: HOSTS,
  port: 443,
  endpointPatterns: ENDPOINT_PATTERNS,
  instructions: INSTRUCTIONS,
  authHeader: "x-api-key",
  referenceIde: "antigravity",
  handlerModule: "./handlers/kiro",
};

module.exports = { KIRO_TARGET };
