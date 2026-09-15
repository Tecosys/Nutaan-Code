/**
 * Antigravity IDE target descriptor.
 *
 * Antigravity sends requests to cloudcode-pa.googleapis.com using the Gemini
 * GenerateContent API format (both the cloudcode-pa envelope and legacy /v1beta path).
 */
"use strict";

const HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.sandbox.googleapis.com",
  "autopush-cloudcode-pa.sandbox.googleapis.com",
];

const ENDPOINT_PATTERNS = [
  "/v1internal:generateContent",
  "/v1internal:streamGenerateContent",
  "/v1internal:loadCodeAssist",
  "/v1internal:onboardUser",
];

const INSTRUCTIONS = [
  "1. Click 'Start AgentBridge' — a local HTTPS proxy starts on port 443",
  "2. The Nutaan Code root CA is installed into your system trust store",
  "3. Your hosts file is updated to redirect Antigravity traffic through Nutaan",
  "4. Open Antigravity IDE — requests will be automatically routed through Nutaan",
];

/** @type {import('./index').MitmTarget} */
const ANTIGRAVITY_TARGET = {
  id: "antigravity",
  name: "Antigravity IDE",
  icon: "rocket_launch",
  color: "#4F46E5",
  hosts: HOSTS,
  port: 443,
  endpointPatterns: ENDPOINT_PATTERNS,
  instructions: INSTRUCTIONS,
  authHeader: "authorization",
  // handler is loaded lazily to avoid circular deps
  handlerModule: "./handlers/antigravity",
};

module.exports = { ANTIGRAVITY_TARGET };
