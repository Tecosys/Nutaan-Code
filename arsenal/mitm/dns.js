/**
 * Hosts file manipulation for MITM DNS spoofing.
 *
 * Adds entries like: 127.0.0.1 cloudcode-pa.googleapis.com  # nutaan-mitm
 * and removes them by marker on stop.
 *
 * Windows: C:\Windows\System32\drivers\etc\hosts  (requires elevation)
 * Linux/macOS: /etc/hosts (requires sudo — but MitmManager spawns server.js
 *   with elevated privileges, so this runs inside the elevated child)
 *
 * Hard Rule: only declarative host entries — no shell interpolation, no eval.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER = "# nutaan-mitm";
const LOOPBACK = "127.0.0.1";

function hostsFilePath() {
  if (process.platform === "win32") {
    return path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32", "drivers", "etc", "hosts"
    );
  }
  return "/etc/hosts";
}

/**
 * Read the hosts file. Returns an empty string on failure.
 * @returns {string}
 */
function readHostsFile() {
  try {
    return fs.readFileSync(hostsFilePath(), "utf8");
  } catch {
    return "";
  }
}

/**
 * Write the hosts file. Throws on permission errors.
 * @param {string} content
 */
function writeHostsFile(content) {
  fs.writeFileSync(hostsFilePath(), content, "utf8");
}

/**
 * Add hosts file entries for the given hostnames, pointing to 127.0.0.1.
 * Idempotent — skips hostnames already present.
 *
 * @param {string[]} hostnames
 */
function addHostsEntries(hostnames) {
  if (!hostnames.length) return;
  let content = readHostsFile();
  const lines = content.split(/\r?\n/);
  const toAdd = [];

  for (const host of hostnames) {
    const entry = `${LOOPBACK} ${host}`;
    // Skip if already present (with or without our marker)
    const alreadyPresent = lines.some((l) => {
      const trimmed = l.replace(/#.*$/, "").trim();
      return trimmed.toLowerCase() === entry.toLowerCase();
    });
    if (!alreadyPresent) {
      toAdd.push(`${entry}  ${MARKER}`);
    }
  }

  if (!toAdd.length) return;

  // Add a section header if this is the first time
  const hasSection = lines.some((l) => l.includes(MARKER));
  if (!hasSection && toAdd.length) {
    content = content.trimEnd() + "\n\n# Added by Nutaan Code AgentBridge\n";
  }

  const appended = content.trimEnd() + "\n" + toAdd.join("\n") + "\n";
  writeHostsFile(appended);
}

/**
 * Remove all hosts file entries that were added by Nutaan Code (marked with MARKER).
 */
function removeHostsEntries() {
  let content = readHostsFile();
  if (!content.includes(MARKER)) return;

  const lines = content.split(/\r?\n/);
  const kept = lines.filter((l) => !l.includes(MARKER));

  // Also remove the section header if we left one
  const cleaned = kept
    .join("\n")
    .replace(/\n# Added by Nutaan Code AgentBridge\n?/g, "\n")
    .trimEnd() + "\n";

  writeHostsFile(cleaned);
}

/**
 * Check if a hostname is currently pointing to loopback in the hosts file.
 * @param {string} hostname
 * @returns {boolean}
 */
function isHostSpoofed(hostname) {
  const content = readHostsFile();
  const lines = content.split(/\r?\n/);
  return lines.some((l) => {
    const trimmed = l.replace(/#.*$/, "").trim();
    const parts = trimmed.split(/\s+/);
    return parts.length >= 2 && parts[0] === LOOPBACK && parts[1].toLowerCase() === hostname.toLowerCase();
  });
}

/**
 * Check if ALL of the given hostnames are currently spoofed.
 * @param {string[]} hostnames
 * @returns {boolean}
 */
function areAllHostsSpoofed(hostnames) {
  if (!hostnames.length) return false;
  return hostnames.every((h) => isHostSpoofed(h));
}

module.exports = { addHostsEntries, removeHostsEntries, isHostSpoofed, areAllHostsSpoofed, hostsFilePath };
