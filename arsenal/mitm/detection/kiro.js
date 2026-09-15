/**
 * Kiro IDE installation detection.
 * Purely filesystem-based — no shell interpolation.
 */
"use strict";

const fs   = require("node:fs");
const os   = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const PATHS = [
  // macOS
  "/Applications/Kiro.app",
  path.join(HOME, "Applications", "Kiro.app"),
  // Linux
  "/usr/bin/kiro",
  "/usr/local/bin/kiro",
  path.join(HOME, ".local", "bin", "kiro"),
  // Windows
  path.join(
    process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"),
    "Programs", "Kiro", "Kiro.exe"
  ),
];

/**
 * @returns {{ installed: boolean, path?: string }}
 */
function detectKiro() {
  for (const p of PATHS) {
    if (fs.existsSync(p)) return { installed: true, path: p };
  }
  return { installed: false };
}

module.exports = { detectKiro };
