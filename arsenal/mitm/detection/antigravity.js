/**
 * Antigravity IDE installation detection.
 * Purely filesystem-based — no shell interpolation.
 */
"use strict";

const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const PATHS = [
  // macOS
  "/Applications/Antigravity.app",
  path.join(HOME, "Applications", "Antigravity.app"),
  // Linux
  "/usr/bin/antigravity",
  "/usr/local/bin/antigravity",
  path.join(HOME, ".local", "bin", "antigravity"),
  // Windows
  path.join(
    process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"),
    "Programs", "Antigravity", "Antigravity.exe"
  ),
];

/**
 * @returns {{ installed: boolean, path?: string }}
 */
function detectAntigravity() {
  for (const p of PATHS) {
    if (fs.existsSync(p)) return { installed: true, path: p };
  }
  return { installed: false };
}

module.exports = { detectAntigravity };
