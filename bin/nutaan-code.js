#!/usr/bin/env node
// Terminal entry point. Runs the same way on Windows, macOS and Linux: prints a banner, then
// hands off to the Electron binary that npm installed for this platform, so there is nothing
// platform-specific for the user to know.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

// Truecolor where the terminal admits to supporting it, plain text otherwise — a banner full
// of escape codes in a CI log or a piped file is worse than no banner.
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const rgb = (r, g, b, s) => (color ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (color ? `\x1b[1m${s}\x1b[0m` : s);

// The brand gradient runs purple -> pink across the mark, matching the app's logo.
const GRADIENT = [
  [168, 85, 247],
  [186, 80, 240],
  [205, 75, 233],
  [223, 71, 226],
  [236, 72, 153],
];

const MARK = [
  "  ███╗   ██╗  ",
  "  ████╗  ██║  ",
  "  ██╔██╗ ██║  ",
  "  ██║╚██╗██║  ",
  "  ██║ ╚████║  ",
  "  ╚═╝  ╚═══╝  ",
];

function banner() {
  const lines = MARK.map((line, i) => {
    const [r, g, b] = GRADIENT[Math.min(i, GRADIENT.length - 1)];
    return rgb(r, g, b, line);
  });
  const label = [
    "",
    `${bold("Nutaan Code")}  ${dim("v" + pkg.version)}`,
    dim("AI coding agent · " + process.platform),
    "",
    dim("Starting the desktop app…"),
    "",
  ];
  console.log("");
  for (let i = 0; i < Math.max(lines.length, label.length); i++) {
    console.log(`${lines[i] || " ".repeat(14)}  ${label[i] || ""}`);
  }
}

function electronBinary() {
  try {
    // The electron package exports the absolute path to the platform's binary.
    const bin = require("electron");
    if (typeof bin === "string" && fs.existsSync(bin)) return bin;
  } catch {
    // fall through to the friendlier message below
  }
  return null;
}

function main() {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(pkg.version);
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
${bold("nutaan-code")} — ${pkg.description}

  nutaan-code            Launch the desktop app
  nutaan-code --version  Print the version
  nutaan-code --help     Show this message

Any other arguments are passed straight through to the app.
`);
    return;
  }

  banner();

  const bin = electronBinary();
  if (!bin) {
    console.error(
      "Electron isn't installed. Run `npm install` in this folder first, then try again.\n" +
        "If you installed with --production, reinstall without it: Electron is a devDependency."
    );
    process.exit(1);
  }

  const child = spawn(bin, [root, ...process.argv.slice(2)], {
    stdio: "inherit",
    // Detaching would orphan the window if the terminal closes; staying attached means Ctrl+C
    // in the terminal closes the app, which is what someone running from source expects.
    windowsHide: false,
  });

  child.on("close", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    console.error("Could not start the app:", err.message);
    process.exit(1);
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
}

main();
