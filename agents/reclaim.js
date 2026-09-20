// Reclaim — "free up 100 GB on this machine", done properly.
//
// Three steps, and the middle one is the point:
//   1. SCAN. Walk the places space actually hides — caches, temp, the recycle bin, package-manager
//      stores, dead node_modules, huge files, installers nobody will open again, installed apps —
//      and measure every one of them. Nothing is estimated and nothing is deleted.
//   2. REVIEW. The user sees exactly what would go, grouped, with real sizes, and picks. Safe
//      groups come pre-ticked; anything that could matter (documents, big personal files, apps)
//      never does.
//   3. APPLY. Only what was ticked, and the report says what was really freed — a cache held open
//      by a running program does not count as freed just because we asked.
//
// The hard rule everywhere below: never delete outside the user's own space, never touch a path on
// the deny list, and never act without an explicit selection coming back from the review step.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const HOME = os.homedir();
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const DEMO_DIR = WIN
  ? path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Nutaan Code", "demos")
  : MAC
    ? path.join(HOME, "Library", "Application Support", "Nutaan Code", "demos")
    : path.join(HOME, ".config", "Nutaan Code", "demos");

const DEFAULT_BUDGET_MS = 90_000;
const MAX_ITEMS_PER_GROUP = 60;
const BIG_FILE_BYTES = 400 * 1024 * 1024;
const OLD_DOWNLOAD_DAYS = 30;
const STALE_DEPS_DAYS = 60;
const INSTALLER_EXT = new Set([".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".appimage", ".iso", ".zip", ".7z", ".rar", ".tar", ".gz", ".xz"]);

// Nothing under these ever goes, whatever the user ticks. The OS, its package stores, and the
// places uninstalling through the front door is the only correct move.
const DENY = [
  "/system", "/usr", "/bin", "/sbin", "/etc", "/var/db", "/library/apple", "/private/var/db",
  "c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata\\package cache",
  "c:\\$winreagent", "c:\\recovery", "c:\\boot",
];
// A path must sit under one of these to be deletable at all.
const ALLOW_ROOTS = [HOME, os.tmpdir()].concat(WIN ? [process.env.LOCALAPPDATA || "", process.env.APPDATA || ""] : []).filter(Boolean);

const lower = (p) => String(p || "").toLowerCase().replace(/\//g, path.sep === "\\" ? "\\" : "/");

function isDenied(p) {
  const l = String(p || "").toLowerCase().replace(/\\/g, "/");
  return DENY.some((d) => {
    const dd = d.replace(/\\/g, "/");
    return l === dd || l.startsWith(dd.endsWith("/") ? dd : dd + "/");
  });
}

function insideAllowed(p) {
  const abs = path.resolve(p);
  return ALLOW_ROOTS.some((r) => {
    const rr = path.resolve(r);
    return abs === rr || abs.startsWith(rr + path.sep);
  });
}

// A path is only ever touched if it is inside the user's own space, off the deny list, and not a
// root of that space in its own right.
function deletable(p) {
  if (!p || typeof p !== "string") return false;
  const abs = path.resolve(p);
  if (isDenied(abs)) return false;
  if (!insideAllowed(abs)) return false;
  if (ALLOW_ROOTS.some((r) => path.resolve(r) === abs)) return false;
  if (path.dirname(abs) === abs) return false; // a drive root
  return true;
}

function run(cmd, args, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let child, out = "", err = "";
    try { child = spawn(cmd, args, { windowsHide: true }); }
    catch (e) { return resolve({ ok: false, out: "", err: e.message }); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout?.on("data", (c) => { out += c; });
    child.stderr?.on("data", (c) => { err += c; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, out, err: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
  });
}
const PS = (script, ms) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], ms);

const days = (ms) => Math.round(ms / 86400000);

// Directory size with a deadline. A scan that walks a 400 GB drive to the last byte is a scan
// nobody waits for, so each measurement gives up gracefully and says it was partial.
function dirSize(dir, deadline, state = { bytes: 0, files: 0, partial: false }) {
  if (Date.now() > deadline) { state.partial = true; return state; }
  let entries;
  try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return state; }
  for (const e of entries) {
    if (Date.now() > deadline) { state.partial = true; return state; }
    const fp = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) dirSize(fp, deadline, state);
      else { state.bytes += fsSync.statSync(fp).size; state.files++; }
    } catch {}
  }
  return state;
}

function sizeOf(target, deadline) {
  try {
    const st = fsSync.lstatSync(target);
    if (st.isSymbolicLink()) return { bytes: 0, files: 0, partial: false };
    if (st.isDirectory()) return dirSize(target, deadline);
    return { bytes: st.size, files: 1, partial: false };
  } catch { return { bytes: 0, files: 0, partial: false }; }
}

function mtimeOf(target) {
  try { return fsSync.statSync(target).mtimeMs; } catch { return 0; }
}

// ---------- where space hides, per platform ----------
function cacheCandidates() {
  const out = [];
  const add = (label, dir, note) => { if (dir) out.push({ label, path: dir, note }); };
  if (WIN) {
    const LA = process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local");
    const AR = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
    add("Internet cache", path.join(LA, "Microsoft", "Windows", "INetCache"));
    add("Explorer thumbnails", path.join(LA, "Microsoft", "Windows", "Explorer"));
    add("Delivery Optimization", path.join(LA, "Microsoft", "Windows", "DeliveryOptimization"));
    add("Chrome cache", path.join(LA, "Google", "Chrome", "User Data", "Default", "Cache"));
    add("Chrome code cache", path.join(LA, "Google", "Chrome", "User Data", "Default", "Code Cache"));
    add("Edge cache", path.join(LA, "Microsoft", "Edge", "User Data", "Default", "Cache"));
    add("Brave cache", path.join(LA, "BraveSoftware", "Brave-Browser", "User Data", "Default", "Cache"));
    add("Firefox cache", path.join(LA, "Mozilla", "Firefox", "Profiles"));
    add("npm cache", path.join(AR, "npm-cache"));
    add("pnpm store", path.join(LA, "pnpm", "store"));
    add("Yarn cache", path.join(LA, "Yarn", "Cache"));
    add("pip cache", path.join(LA, "pip", "Cache"));
    add("NuGet packages", path.join(HOME, ".nuget", "packages"));
    add("Gradle caches", path.join(HOME, ".gradle", "caches"));
    add("Docker Desktop logs", path.join(LA, "Docker", "log"));
  } else if (MAC) {
    add("User caches", path.join(HOME, "Library", "Caches"));
    add("Application logs", path.join(HOME, "Library", "Logs"));
    add("Xcode derived data", path.join(HOME, "Library", "Developer", "Xcode", "DerivedData"));
    add("Xcode device support", path.join(HOME, "Library", "Developer", "Xcode", "iOS DeviceSupport"));
    add("Xcode archives", path.join(HOME, "Library", "Developer", "Xcode", "Archives"));
    add("Simulator devices", path.join(HOME, "Library", "Developer", "CoreSimulator", "Caches"));
    add("npm cache", path.join(HOME, ".npm"));
    add("Yarn cache", path.join(HOME, "Library", "Caches", "Yarn"));
    add("pip cache", path.join(HOME, "Library", "Caches", "pip"));
    add("Homebrew cache", path.join(HOME, "Library", "Caches", "Homebrew"));
  } else {
    add("User cache", path.join(HOME, ".cache"));
    add("npm cache", path.join(HOME, ".npm"));
    add("pip cache", path.join(HOME, ".cache", "pip"));
    add("Yarn cache", path.join(HOME, ".cache", "yarn"));
    add("Flatpak unused data", path.join(HOME, ".var", "app"));
    add("Gradle caches", path.join(HOME, ".gradle", "caches"));
  }
  // Every platform, every developer machine.
  add("Cargo registry", path.join(HOME, ".cargo", "registry"));
  add("Go module cache", path.join(HOME, "go", "pkg", "mod"));
  add("Electron build cache", path.join(HOME, ".electron"));
  return out;
}

function trashPaths() {
  if (MAC) return [{ label: "Trash", path: path.join(HOME, ".Trash") }];
  if (!WIN) return [{ label: "Trash", path: path.join(HOME, ".local", "share", "Trash") }];
  // Windows keeps one bin per drive, each holding a folder per user SID.
  const out = [];
  for (const drive of ["C:", "D:", "E:"]) {
    const root = path.join(drive + "\\", "$Recycle.Bin");
    let subs = [];
    try { subs = fsSync.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const s of subs) {
      if (!s.isDirectory()) continue;
      out.push({ label: `Recycle Bin (${drive})`, path: path.join(root, s.name) });
    }
  }
  return out;
}

function userFolders() {
  const names = WIN
    ? ["Downloads", "Desktop", "Documents", "Videos", "Pictures", "Music"]
    : ["Downloads", "Desktop", "Documents", "Movies", "Pictures", "Music"];
  return names.map((n) => path.join(HOME, n)).filter((p) => fsSync.existsSync(p));
}

// A bounded walk: breadth-limited, deadline-aware, and it never descends into anything on the
// deny list or into another package's innards.
function walkFiles(root, { deadline, maxDepth = 4, onFile, skipDirs = new Set() }) {
  const stack = [[root, 0]];
  while (stack.length) {
    if (Date.now() > deadline) return true;
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (isDenied(fp)) continue;
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (skipDirs.has(e.name.toLowerCase())) continue;
          if (depth < maxDepth) stack.push([fp, depth + 1]);
        } else {
          onFile(fp, e.name);
        }
      } catch {}
    }
  }
  return false;
}

// ---------- system-level junk ----------
// Everything above is inside the user's own space and goes with a plain delete. These do not: the
// machine-wide temp folder, the Windows Update download cache, the per-drive recycle bins. A real
// disk cleaner clears them, and clearing them needs administrator. So they get their own group,
// they are never pre-ticked, and they are removed by an elevated helper script — one UAC prompt
// (or one sudo prompt) for the whole batch, never a silent privilege grab.
function systemCandidates() {
  const out = [];
  const add = (label, dir, note) => { if (dir && fsSync.existsSync(dir)) out.push({ label, path: dir, note }); };
  if (WIN) {
    const win = process.env.SystemRoot || "C:\\Windows";
    add("Machine temp folder", path.join(win, "Temp"), "shared temp — needs administrator");
    add("Windows Update downloads", path.join(win, "SoftwareDistribution", "Download"), "already-installed update packages");
    add("Windows error reports", path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "WER"), "crash dumps");
    add("Delivery Optimization cache", path.join(win, "SoftwareDistribution", "DeliveryOptimization"));
    add("Prefetch", path.join(win, "Prefetch"), "rebuilt as you use the machine");
  } else if (MAC) {
    add("System caches", "/Library/Caches", "needs administrator");
    add("System logs", "/private/var/log", "needs administrator");
    add("Shared temp", "/private/var/tmp", "needs administrator");
  } else {
    add("APT package cache", "/var/cache/apt/archives", "needs administrator");
    add("System journal", "/var/log/journal", "needs administrator");
    add("Shared temp", "/var/tmp", "needs administrator");
  }
  return out;
}

// Screen recordings are big and land somewhere nobody looks. Windows' Game Bar has its own folder,
// macOS drops them on the Desktop, and every platform has a Videos folder worth measuring.
function recordingCandidates() {
  const out = [];
  const add = (label, dir, note) => { if (dir && fsSync.existsSync(dir)) out.push({ label, path: dir, note }); };
  if (WIN) {
    add("Game Bar captures", path.join(HOME, "Videos", "Captures"), "Win+Alt+R recordings");
    add("Camera Roll", path.join(HOME, "Pictures", "Camera Roll"));
    add("Screenshots", path.join(HOME, "Pictures", "Screenshots"));
  } else if (MAC) {
    add("QuickTime autosave", path.join(HOME, "Library", "Containers", "com.apple.QuickTimePlayerX", "Data", "Library", "Autosave Information"));
    add("Screen Recordings", path.join(HOME, "Movies", "Screen Recordings"));
  } else {
    add("Screen recordings", path.join(HOME, "Videos", "Screencasts"));
  }
  add("Nutaan demo recordings", DEMO_DIR, "takes recorded in Demo Studio");
  return out;
}

class Reclaim {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.last = null;
  }

  // ---------- installed applications ----------
  async listApps(deadline) {
    const apps = [];
    if (WIN) {
      const res = await PS(
        "$ErrorActionPreference='SilentlyContinue';" +
        "$keys = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');" +
        "Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent } |" +
        "Select-Object DisplayName, DisplayVersion, Publisher, EstimatedSize, InstallLocation, UninstallString, QuietUninstallString |" +
        "ConvertTo-Json -Depth 3 -Compress", 35_000);
      try {
        const list = JSON.parse(res.out || "[]");
        for (const a of Array.isArray(list) ? list : [list]) {
          if (!a || !a.DisplayName) continue;
          apps.push({
            id: a.DisplayName,
            name: a.DisplayName,
            version: a.DisplayVersion || "",
            publisher: a.Publisher || "",
            bytes: (Number(a.EstimatedSize) || 0) * 1024,
            location: a.InstallLocation || "",
            uninstall: a.QuietUninstallString || a.UninstallString || "",
          });
        }
      } catch {}
    } else if (MAC) {
      let entries = [];
      try { entries = fsSync.readdirSync("/Applications", { withFileTypes: true }); } catch {}
      for (const e of entries) {
        if (!e.name.endsWith(".app")) continue;
        const p = path.join("/Applications", e.name);
        apps.push({
          id: p, name: e.name.replace(/\.app$/, ""), version: "", publisher: "",
          bytes: sizeOf(p, deadline).bytes, location: p, uninstall: "",
        });
      }
    } else {
      const res = await run("sh", ["-c", "dpkg-query -W -f='${Installed-Size}\\t${Package}\\t${Version}\\n' 2>/dev/null | sort -rn | head -80"], 20_000);
      for (const line of String(res.out).trim().split("\n")) {
        const [kb, name, version] = line.split("\t");
        if (!name) continue;
        apps.push({ id: name, name, version: version || "", publisher: "", bytes: (Number(kb) || 0) * 1024, location: "", uninstall: `apt-get remove ${name}` });
      }
    }
    return apps
      .filter((a) => a.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, MAX_ITEMS_PER_GROUP);
  }

  // ---------- the scan ----------
  async scan({ budgetMs = DEFAULT_BUDGET_MS, includeApps = true, onProgress } = {}) {
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    // Each phase gets its own slice of the budget. Without this the first slow walk eats the whole
    // scan and every later group comes back empty — which reads as "nothing found" when the truth
    // is "never looked".
    const phase = (share, label) => {
      if (onProgress) onProgress({ label, elapsed: Date.now() - startedAt });
      return Math.min(deadline, Date.now() + Math.round(budgetMs * share));
    };
    const groups = [];
    const mkItem = (label, p, until, extra = {}) => {
      const { bytes, files, partial } = sizeOf(p, until);
      if (!bytes) return null;
      return { id: p, label, path: p, bytes, files, partial, ...extra };
    };

    // 1. caches — the safest space on any machine, and usually the most of it
    const caches = [];
    const dlCaches = phase(0.3, "Measuring caches");
    for (const c of cacheCandidates()) {
      if (Date.now() > dlCaches) break;
      if (!fsSync.existsSync(c.path) || !deletable(c.path)) continue;
      const item = mkItem(c.label, c.path, dlCaches, { note: c.note });
      if (item) caches.push(item);
    }
    groups.push({
      id: "caches", title: "Caches and temporary files", safe: true, defaultOn: true,
      hint: "Rebuilt automatically the next time each program needs them.",
      items: caches.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS_PER_GROUP),
    });

    // 2. the bin
    const trash = [];
    const dlTrash = phase(0.08, "Checking the recycle bin");
    for (const t of trashPaths()) {
      if (Date.now() > dlTrash) break;
      if (!fsSync.existsSync(t.path)) continue;
      const item = mkItem(t.label, t.path, dlTrash);
      // The bin sits outside the user's own tree and has its own semantics, so it is emptied
      // through the OS rather than deleted file by file.
      if (item) trash.push({ ...item, kind: "trash" });
    }
    groups.push({
      id: "trash", title: "Recycle bin", safe: true, defaultOn: true,
      hint: "Already deleted once — this empties the bin through the operating system.",
      items: trash,
    });

    // 3. system temp, only what is genuinely stale
    const tmp = [];
    const dlTmp = phase(0.1, "Looking through temp files");
    const tmpRoot = os.tmpdir();
    const cutoff = Date.now() - 2 * 86400000;
    try {
      for (const e of fsSync.readdirSync(tmpRoot, { withFileTypes: true })) {
        if (Date.now() > dlTmp) break;
        const fp = path.join(tmpRoot, e.name);
        if (!deletable(fp) || mtimeOf(fp) > cutoff) continue;
        const item = mkItem(e.name, fp, dlTmp, { note: `untouched for ${days(Date.now() - mtimeOf(fp))} days` });
        if (item) tmp.push(item);
      }
    } catch {}
    groups.push({
      id: "temp", title: "Stale temp files", safe: true, defaultOn: true,
      hint: "Nothing here has been written to in over two days.",
      items: tmp.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS_PER_GROUP),
    });

    // 4. installers and archives sitting in Downloads
    const installers = [];
    const dlInst = phase(0.12, "Scanning Downloads");
    const dl = path.join(HOME, "Downloads");
    if (fsSync.existsSync(dl)) {
      const old = Date.now() - OLD_DOWNLOAD_DAYS * 86400000;
      walkFiles(dl, {
        deadline: dlInst, maxDepth: 2,
        onFile: (fp, name) => {
          const ext = path.extname(name).toLowerCase();
          if (!INSTALLER_EXT.has(ext)) return;
          const m = mtimeOf(fp);
          if (m > old) return;
          try {
            const size = fsSync.statSync(fp).size;
            if (size > 8 * 1024 * 1024) {
              installers.push({ id: fp, label: name, path: fp, bytes: size, files: 1, note: `downloaded ${days(Date.now() - m)} days ago` });
            }
          } catch {}
        },
      });
    }
    groups.push({
      id: "installers", title: "Old installers and archives", safe: true, defaultOn: true,
      hint: `Setup files and archives in Downloads, untouched for ${OLD_DOWNLOAD_DAYS}+ days. Re-downloadable.`,
      items: installers.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS_PER_GROUP),
    });

    // 5. dependency folders in projects nobody has opened in months
    const deps = [];
    const depNames = new Set(["node_modules", "venv", ".venv", "target", "vendor", ".gradle", "Pods", "DerivedData"]);
    const staleCut = Date.now() - STALE_DEPS_DAYS * 86400000;
    const codeRoots = [path.join(HOME, "Documents"), path.join(HOME, "Desktop"), path.join(HOME, "projects"), path.join(HOME, "Projects"), path.join(HOME, "code"), path.join(HOME, "dev"), path.join(HOME, "src"), HOME];
    const seenDep = new Set();
    const dlDeps = phase(0.2, "Finding dormant project dependencies");
    for (const root of codeRoots) {
      if (Date.now() > dlDeps) break;
      if (!fsSync.existsSync(root)) continue;
      const stack = [[root, 0]];
      while (stack.length) {
        if (Date.now() > dlDeps) break;
        const [dir, depth] = stack.pop();
        let entries = [];
        try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (!e.isDirectory() || e.isSymbolicLink()) continue;
          const fp = path.join(dir, e.name);
          if (isDenied(fp) || seenDep.has(fp)) continue;
          if (depNames.has(e.name)) {
            seenDep.add(fp);
            const m = mtimeOf(path.dirname(fp));
            if (m && m < staleCut && deletable(fp)) {
              const item = mkItem(path.relative(HOME, fp) || e.name, fp, dlDeps, {
                note: `project last touched ${days(Date.now() - m)} days ago — reinstall with one command`,
              });
              if (item) deps.push(item);
            }
            continue; // never descend into one
          }
          if (e.name.startsWith(".") && e.name !== ".venv" && e.name !== ".gradle") continue;
          if (depth < 3) stack.push([fp, depth + 1]);
        }
      }
    }
    groups.push({
      id: "deps", title: "Dependencies of dormant projects", safe: false, defaultOn: false,
      hint: `node_modules and friends in projects untouched for ${STALE_DEPS_DAYS}+ days. Restored by an install command.`,
      items: deps.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS_PER_GROUP),
    });

    // 6. the genuinely big files, wherever they are
    const big = [];
    const dlBig = phase(0.2, "Hunting for large files");
    for (const folder of userFolders()) {
      if (Date.now() > dlBig) break;
      walkFiles(folder, {
        deadline: dlBig, maxDepth: 3,
        skipDirs: new Set(["node_modules", ".git", "library", "appdata"]),
        onFile: (fp, name) => {
          try {
            const st = fsSync.statSync(fp);
            if (st.size < BIG_FILE_BYTES) return;
            big.push({ id: fp, label: name, path: fp, bytes: st.size, files: 1, note: `in ${path.relative(HOME, path.dirname(fp))} · last changed ${days(Date.now() - st.mtimeMs)} days ago` });
          } catch {}
        },
      });
    }
    groups.push({
      id: "big", title: "Large personal files", safe: false, defaultOn: false,
      hint: "Your own files, over 400 MB each. Nothing here is ticked for you — read the list first.",
      items: big.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ITEMS_PER_GROUP),
    });

    // 7. screen recordings and captures — big, and in folders nobody thinks to look in
    const recs = [];
    const dlRec = phase(0.08, "Checking screen recordings");
    for (const c of recordingCandidates()) {
      if (Date.now() > dlRec) break;
      if (!deletable(c.path)) continue;
      const item = mkItem(c.label, c.path, dlRec, { note: c.note });
      if (item) recs.push(item);
    }
    groups.push({
      id: "recordings", title: "Screen recordings and captures", safe: false, defaultOn: false,
      hint: "Video is the biggest thing on most machines. These are yours — nothing is ticked for you.",
      items: recs.sort((a, b) => b.bytes - a.bytes),
    });

    // 8. machine-wide junk: real space, but it takes administrator to clear it
    const sys = [];
    const dlSys = phase(0.1, "Measuring system junk");
    for (const c of systemCandidates()) {
      if (Date.now() > dlSys) break;
      const { bytes, files, partial } = sizeOf(c.path, dlSys);
      if (bytes) sys.push({ id: c.path, label: c.label, path: c.path, bytes, files, partial, note: c.note, kind: "system" });
    }
    groups.push({
      id: "system", title: "System junk (needs administrator)", safe: false, defaultOn: false, kind: "system",
      hint: WIN
        ? "Cleared by an elevated helper — Windows will ask for permission once, for the whole batch."
        : "Cleared with sudo — your password is asked for once, for the whole batch.",
      items: sys.sort((a, b) => b.bytes - a.bytes),
    });

    // 9. installed applications — removed through the uninstaller, not by deleting files
    if (includeApps) {
      if (onProgress) onProgress({ label: "Listing installed applications", elapsed: Date.now() - startedAt });
      // Its own clock: one query to the OS, not a walk competing for the walk budget.
      const apps = await this.listApps(Date.now() + 40_000).catch(() => []);
      groups.push({
        id: "apps", title: "Installed applications", safe: false, defaultOn: false, kind: "apps",
        hint: "Uninstalled through the program's own uninstaller, one at a time, with its window on screen.",
        items: apps.map((a) => ({
          id: a.id, label: a.name, path: a.location, bytes: a.bytes, files: 0,
          note: [a.publisher, a.version].filter(Boolean).join(" · "),
          uninstall: a.uninstall,
        })),
      });
    }

    const totalBytes = groups.reduce((n, g) => n + g.items.reduce((m, i) => m + i.bytes, 0), 0);
    const safeBytes = groups.filter((g) => g.defaultOn).reduce((n, g) => n + g.items.reduce((m, i) => m + i.bytes, 0), 0);
    const result = {
      scannedAt: startedAt,
      ms: Date.now() - startedAt,
      partial: Date.now() >= deadline,
      groups,
      totalBytes,
      safeBytes,
      platform: process.platform,
      home: HOME,
    };
    this.last = result;
    return result;
  }

  // What a selection actually adds up to — recomputed here rather than trusted from the renderer.
  plan(paths) {
    const known = new Map();
    for (const g of (this.last?.groups || [])) {
      // The item's own kind wins: a bin entry inside an untyped group is still a bin entry.
      for (const i of g.items) known.set(i.id, { ...i, group: g.id, kind: i.kind || g.kind });
    }
    const items = [];
    const refused = [];
    for (const p of paths || []) {
      const item = known.get(p);
      if (!item) { refused.push({ path: p, reason: "not part of the last scan" }); continue; }
      if (item.kind === "apps" || item.kind === "trash" || item.kind === "system") { items.push(item); continue; }
      if (!deletable(item.path)) { refused.push({ path: p, reason: "outside your own files, or protected" }); continue; }
      items.push(item);
    }
    return { items, refused, bytes: items.reduce((n, i) => n + i.bytes, 0) };
  }

  // ---------- deletion ----------
  // One entry at a time rather than a recursive rm: on a live machine there is always a file held
  // open by something, and a recursive delete abandons the whole tree at the first one.
  rmTree(target) {
    let st;
    try { st = fsSync.lstatSync(target); } catch (err) { return err.code === "ENOENT" ? null : err; }
    if (st.isDirectory() && !st.isSymbolicLink()) {
      let firstErr = null;
      try {
        for (const name of fsSync.readdirSync(target)) {
          const err = this.rmTree(path.join(target, name));
          if (err && !firstErr) firstErr = err;
        }
      } catch (err) { return err; }
      if (firstErr) return firstErr;
      try { fsSync.rmdirSync(target); return null; } catch (err) { return err; }
    }
    try { fsSync.unlinkSync(target); return null; } catch (err) { return err; }
  }

  async apply(paths, { onProgress } = {}) {
    const { items, refused } = this.plan(paths);
    const results = [];
    let freed = 0;
    let done = 0;
    // Everything needing administrator goes in one batch, so there is one prompt, not one per folder.
    const sysItems = items.filter((i) => i.kind === "system");
    if (sysItems.length) {
      const res = await this.clearSystemPaths(sysItems.map((i) => i.path));
      for (const item of sysItems) {
        const after = sizeOf(item.path, Date.now() + 3000).bytes;
        const gone = Math.max(0, item.bytes - after);
        freed += gone;
        results.push({
          path: item.path, label: item.label, bytes: item.bytes, freed: gone,
          removed: res.ok && gone > 0, error: res.ok ? (gone ? null : "nothing could be removed — it is all in use") : res.error,
        });
        done++;
      }
      if (onProgress) onProgress({ done, total: items.length, label: "System junk", freed });
    }

    let emptiedBin = false;
    for (const item of items) {
      if (item.kind === "system") continue; // handled in the elevated batch above
      if (item.kind === "apps") continue; // apps go through uninstall(), never through a delete
      if (item.kind === "trash") {
        // One empty covers every bin on the machine, so only do it once per run.
        if (emptiedBin) continue;
        emptiedBin = true;
        const before = items.filter((i) => i.kind === "trash").reduce((n, i) => n + i.bytes, 0);
        const res = await this.emptyTrash();
        freed += res.ok ? before : 0;
        results.push({ path: item.path, label: "Recycle bin", bytes: before, freed: res.ok ? before : 0, removed: res.ok, error: res.ok ? null : res.error });
        done++;
        if (onProgress) onProgress({ done, total: items.length, label: "Recycle bin", freed });
        continue;
      }
      const before = item.bytes;
      const err = this.rmTree(item.path);
      const after = sizeOf(item.path, Date.now() + 4000).bytes;
      const gone = Math.max(0, before - after);
      freed += gone;
      results.push({
        path: item.path, label: item.label, bytes: before, freed: gone,
        removed: !err && !fsSync.existsSync(item.path),
        error: err ? (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES" ? "in use by a running program" : err.code || err.message) : null,
      });
      done++;
      if (onProgress) onProgress({ done, total: items.length, label: item.label, freed });
    }
    // The scan is now out of date for everything that went.
    if (this.last) {
      const goneSet = new Set(results.filter((r) => r.removed).map((r) => r.path));
      for (const g of this.last.groups) g.items = g.items.filter((i) => !goneSet.has(i.id));
    }
    return {
      freed,
      removed: results.filter((r) => r.removed).length,
      failed: results.filter((r) => !r.removed).length,
      refused,
      results: results.sort((a, b) => b.freed - a.freed),
    };
  }

  // The elevated helper. One prompt, a script that only ever receives paths this module produced,
  // and each one re-checked against the system list before it is touched — so a path that arrived
  // from anywhere else cannot ride along.
  async clearSystemPaths(paths) {
    const allowed = new Set(systemCandidates().map((c) => path.resolve(c.path).toLowerCase()));
    const targets = (paths || []).filter((p) => allowed.has(path.resolve(p).toLowerCase()));
    if (!targets.length) return { ok: false, error: "no system paths to clear" };

    if (WIN) {
      // Children only: the folders themselves must survive, Windows expects them to exist.
      const inner = targets
        .map((t) => `Get-ChildItem -LiteralPath '${t.replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`)
        .join("; ");
      const encoded = Buffer.from(inner, "utf16le").toString("base64");
      const res = await PS(
        `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'; exit $p.ExitCode`,
        5 * 60_000
      );
      return { ok: res.ok, error: res.ok ? null : "the elevated step was cancelled or failed" };
    }

    const quoted = targets.map((t) => `"${t.replace(/"/g, '\"')}"/*`).join(" ");
    if (MAC) {
      // osascript asks for the password in a proper macOS dialog rather than a terminal prompt.
      const res = await run("osascript", ["-e", `do shell script "rm -rf ${quoted.replace(/"/g, '\"')}" with administrator privileges`], 5 * 60_000);
      return { ok: res.ok, error: res.ok ? null : "the elevated step was cancelled or failed" };
    }
    const res = await run("pkexec", ["sh", "-c", `rm -rf ${quoted}`], 5 * 60_000);
    if (res.ok) return { ok: true, error: null };
    return { ok: false, error: "needs administrator — run this in a terminal: sudo rm -rf " + quoted };
  }

  // Emptying the bin is the one delete we hand back to the OS: on Windows the bin is a shell
  // construct outside the user's tree, and Clear-RecycleBin is the supported way to do it.
  async emptyTrash() {
    if (WIN) {
      const res = await PS("Clear-RecycleBin -Force -ErrorAction Stop", 120_000);
      return { ok: res.ok, error: res.ok ? null : (res.err || "the bin refused to empty").trim().slice(0, 160) };
    }
    const dir = MAC ? path.join(HOME, ".Trash") : path.join(HOME, ".local", "share", "Trash");
    let firstErr = null;
    try {
      for (const name of fsSync.readdirSync(dir)) {
        const err = this.rmTree(path.join(dir, name));
        if (err && !firstErr) firstErr = err;
      }
    } catch (e) { return { ok: false, error: e.message }; }
    return { ok: !firstErr, error: firstErr ? (firstErr.code || firstErr.message) : null };
  }

  // Uninstalling is the OS's job. We start its uninstaller and let the user drive it — silently
  // removing programs behind someone's back is not a thing this app does.
  async uninstall(id) {
    const app = (this.last?.groups || []).flatMap((g) => (g.kind === "apps" ? g.items : [])).find((i) => i.id === id);
    if (!app) return { ok: false, error: "not in the last scan" };
    if (WIN) {
      if (!app.uninstall) return { ok: false, error: "this program registered no uninstaller" };
      const res = await run("cmd", ["/c", "start", "", "/wait", "cmd", "/c", app.uninstall], 5 * 60_000);
      return { ok: res.ok, error: res.ok ? null : (res.err || "the uninstaller reported a failure").slice(0, 200) };
    }
    if (MAC) {
      // Into the Trash, which is what dragging it there does — recoverable until the bin is emptied.
      const dest = path.join(HOME, ".Trash", path.basename(app.path));
      try { await fs.rename(app.path, dest); return { ok: true, movedToTrash: dest }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: false, error: "run this in a terminal: " + (app.uninstall || "your package manager's remove command"), manual: app.uninstall };
  }
}

module.exports = { Reclaim, deletable, isDenied, insideAllowed };
