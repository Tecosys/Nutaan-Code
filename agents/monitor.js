// Monitor — the health of the machine this app runs on, and of the web apps the user points it at.
//
// Two jobs, one module:
//   1. The device. Storage, free RAM, the GPU and whether anything is actually guarding this
//      machine against malware. Read live from the OS, never guessed, and summarised into one
//      traffic light that lives in the title bar.
//   2. Web apps. A list of URLs checked on a schedule: is it up, how slow, is the certificate about
//      to expire, is it missing the security headers it should have. Plus a real vulnerability scan
//      twice a week, at times chosen at random so the scan never becomes something a target can
//      schedule around.
//
// Everything is persisted, so a machine that was low on disk yesterday, a site that went down at
// 3am, and the findings of last week's scan are all still here after a restart. Nothing is
// simulated: every number comes from an OS query or a real HTTP request.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const TICK_MS = 30_000;
const DEVICE_REFRESH_MS = 60_000;
const SLOW_PROBE_REFRESH_MS = 30 * 60_000; // GPU + antivirus are expensive; they move slowly too
const MAX_HISTORY = 240;                   // per site, ~ a day at 5-minute checks
const MAX_EVENTS = 300;
const MAX_SCANS = 20;
const DEFAULT_EVERY_MIN = 5;
const SCANS_PER_WEEK = 2;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function run(cmd, args, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let child;
    let out = "";
    let err = "";
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, out: "", err: e.message });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout?.on("data", (c) => { out += c; });
    child.stderr?.on("data", (c) => { err += c; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, out, err: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
  });
}

const PS = (script) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);

// Windows reports antivirus state as a bit field in one integer. Bit 12 of the second byte means
// "enabled"; the low byte of the third means the definitions are out of date.
function decodeAvState(stateNum) {
  const n = Number(stateNum) || 0;
  return {
    enabled: (n & 0x1000) !== 0,
    outOfDate: (n & 0x10) !== 0,
  };
}

class Monitor {
  constructor({ userDataDir, notify, emit, arsenal, systemStats, log } = {}) {
    this.file = path.join(userDataDir || ".", "monitor.json");
    this.notify = notify || (() => {});
    this.emit = emit || (() => {});
    this.arsenal = arsenal || null;
    this.systemStats = systemStats || null;
    this.log = log || (() => {});

    this.state = {
      enabled: true,
      sites: [],
      events: [],
      scans: [],
      nextScanAt: 0,
      scanWeekStart: 0,
      scansThisWeek: 0,
      projectRoot: null,
    };
    this.device = null;
    this.deviceAt = 0;
    this.slow = null;     // GPU + security snapshot, refreshed rarely
    this.slowAt = 0;
    this.timer = null;
    this.busy = false;
  }

  // ---------- persistence ----------
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.state = { ...this.state, ...saved };
    } catch {}
    if (!Array.isArray(this.state.sites)) this.state.sites = [];
    if (!Array.isArray(this.state.events)) this.state.events = [];
    if (!Array.isArray(this.state.scans)) this.state.scans = [];
    return this.state;
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(this.state, null, 2), "utf8");
    } catch (e) {
      this.log("could not save: " + e.message);
    }
  }

  start() {
    if (this.timer) return;
    this.planScans();
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    // One pass straight away so the title bar has a real reading within seconds of launch.
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  projectOpened(root) {
    this.state.projectRoot = root || null;
  }

  // ---------- device ----------
  async readSlowProbes() {
    const gpu = { name: "", driver: "", memMB: 0, usage: null };
    const sec = { antivirus: [], firewall: null, realtime: null, sigAgeDays: null, lastScanDays: null };

    if (process.platform === "win32") {
      const res = await PS([
        "$ErrorActionPreference='SilentlyContinue'",
        "$g = Get-CimInstance Win32_VideoController | Select-Object -First 1",
        "$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { [pscustomobject]@{ name=$_.displayName; state=$_.productState } })",
        "$fw = @(Get-NetFirewallProfile | Where-Object { $_.Enabled -eq 'True' } | ForEach-Object { $_.Name })",
        "$mp = Get-MpComputerStatus",
        "$gpuUse = $null",
        "try { $gpuUse = [Math]::Round((((Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum).Sum), 1) } catch {}",
        "[pscustomobject]@{",
        "  gpuName = $g.Name; gpuDriver = $g.DriverVersion; gpuMemMB = [Math]::Round(($g.AdapterRAM / 1MB), 0); gpuUse = $gpuUse",
        "  av = $av; firewall = $fw",
        "  realtime = $mp.RealTimeProtectionEnabled; sigAge = $mp.AntivirusSignatureAge; quickScanAge = $mp.QuickScanAge",
        "} | ConvertTo-Json -Depth 4 -Compress",
      ].join("\n"));
      try {
        const j = JSON.parse(res.out);
        gpu.name = j.gpuName || "";
        gpu.driver = j.gpuDriver || "";
        // AdapterRAM is a signed 32-bit field, so anything past 4 GB comes back negative or wrong.
        gpu.memMB = j.gpuMemMB > 0 ? j.gpuMemMB : 0;
        gpu.usage = typeof j.gpuUse === "number" ? Math.min(100, j.gpuUse) : null;
        const avList = Array.isArray(j.av) ? j.av : j.av ? [j.av] : [];
        sec.antivirus = avList.map((a) => ({ name: a.name, ...decodeAvState(a.state) }));
        sec.firewall = Array.isArray(j.firewall) ? j.firewall : j.firewall ? [j.firewall] : [];
        sec.realtime = typeof j.realtime === "boolean" ? j.realtime : null;
        sec.sigAgeDays = typeof j.sigAge === "number" ? j.sigAge : null;
        sec.lastScanDays = typeof j.quickScanAge === "number" ? j.quickScanAge : null;
      } catch {}
    } else if (process.platform === "darwin") {
      const [disp, sip] = await Promise.all([
        run("system_profiler", ["SPDisplaysDataType"]),
        run("csrutil", ["status"]),
      ]);
      const name = (disp.out.match(/Chipset Model:\s*(.+)/) || [])[1];
      const vram = (disp.out.match(/VRAM \(.*?\):\s*(\d+)\s*(MB|GB)/) || []);
      gpu.name = (name || "").trim();
      if (vram[1]) gpu.memMB = Number(vram[1]) * (vram[2] === "GB" ? 1024 : 1);
      // macOS has no third-party AV API; SIP + Gatekeeper are the protections that always exist.
      const sipOn = /enabled/i.test(sip.out);
      sec.antivirus = [{ name: "macOS SIP + XProtect", enabled: sipOn, outOfDate: false }];
      sec.realtime = sipOn;
    } else {
      const [lspci, nvidia] = await Promise.all([
        run("sh", ["-c", "lspci | grep -i 'vga\\|3d\\|display' | head -1"]),
        run("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.total", "--format=csv,noheader,nounits"]),
      ]);
      if (nvidia.ok && nvidia.out.trim()) {
        const [n, u, m] = nvidia.out.trim().split(",").map((x) => x.trim());
        gpu.name = n;
        gpu.usage = Number(u);
        gpu.memMB = Number(m);
      } else if (lspci.out) {
        gpu.name = (lspci.out.split(":").pop() || "").trim();
      }
      const clam = await run("sh", ["-c", "systemctl is-active clamav-daemon 2>/dev/null || pgrep -x clamd >/dev/null && echo active"]);
      const active = /active/.test(clam.out);
      sec.antivirus = active ? [{ name: "ClamAV", enabled: true, outOfDate: false }] : [];
      sec.realtime = active ? true : null;
    }
    return { gpu, sec };
  }

  async readDevice(force) {
    const now = Date.now();
    if (!force && this.device && now - this.deviceAt < DEVICE_REFRESH_MS) return this.device;

    if (force || !this.slow || now - this.slowAt > SLOW_PROBE_REFRESH_MS) {
      this.slow = await this.readSlowProbes().catch(() => null);
      this.slowAt = now;
    }

    let disks = [];
    let cpuPercent = null;
    if (this.systemStats) {
      try {
        const st = await this.systemStats();
        disks = st.disks || [];
        cpuPercent = typeof st.cpuPercent === "number" ? st.cpuPercent : null;
      } catch {}
    }

    const checks = [];

    // ---- storage ----
    const worst = disks.slice().sort((a, b) => pct(a.freeGB, a.totalGB) - pct(b.freeGB, b.totalGB))[0];
    if (worst) {
      const free = pct(worst.freeGB, worst.totalGB);
      checks.push({
        id: "storage",
        label: "Device storage",
        status: free < 7 ? "bad" : free < 15 ? "warn" : "ok",
        value: `${worst.freeGB} GB free`,
        detail: `${worst.drive} · ${free}% of ${worst.totalGB} GB`,
        percent: 100 - free,
        drives: disks.map((d) => ({ drive: d.drive, freeGB: d.freeGB, totalGB: d.totalGB, freePct: pct(d.freeGB, d.totalGB) })),
      });
    } else {
      checks.push({ id: "storage", label: "Device storage", status: "unknown", value: "—", detail: "the disk list could not be read" });
    }

    // ---- memory ----
    const totalMB = Math.round(os.totalmem() / 1048576);
    const freeMB = Math.round(os.freemem() / 1048576);
    const freePct = pct(freeMB, totalMB);
    checks.push({
      id: "ram",
      label: "RAM free",
      status: freePct < 7 ? "bad" : freePct < 15 ? "warn" : "ok",
      value: `${(freeMB / 1024).toFixed(1)} GB free`,
      detail: `${freePct}% of ${(totalMB / 1024).toFixed(1)} GB · ${cpuPercent == null ? "" : cpuPercent + "% CPU"}`.trim(),
      percent: 100 - freePct,
    });

    // ---- gpu ----
    const probed = !!this.slow;
    const gpu = (this.slow && this.slow.gpu) || {};
    checks.push({
      id: "gpu",
      label: "GPU",
      // A GPU is not a thing that is "unhealthy" at rest — it is reported, and only flagged when
      // it is pinned, which is the thing a user would actually want to know about.
      status: gpu.name ? (gpu.usage != null && gpu.usage > 92 ? "warn" : "ok") : "unknown",
      value: gpu.name || (probed ? "not detected" : "reading…"),
      detail: [gpu.usage != null ? `${gpu.usage}% busy` : null, gpu.memMB ? `${gpu.memMB} MB` : null, gpu.driver ? `driver ${gpu.driver}` : null]
        .filter(Boolean).join(" · "),
      percent: gpu.usage == null ? null : gpu.usage,
    });

    // ---- malware protection ----
    const sec = (this.slow && this.slow.sec) || { antivirus: [] };
    const live = sec.antivirus.filter((a) => a.enabled);
    const stale = live.filter((a) => a.outOfDate);
    let avStatus = "ok";
    let avValue = live.map((a) => a.name).join(", ");
    let avDetail = [];
    if (!probed) { avStatus = "unknown"; avValue = "reading…"; }
    else if (!sec.antivirus.length) { avStatus = "unknown"; avValue = "not detected"; }
    else if (!live.length) { avStatus = "bad"; avValue = "protection is off"; }
    else if (stale.length) { avStatus = "warn"; avDetail.push("definitions out of date"); }
    if (sec.realtime === false) { avStatus = "bad"; avDetail.push("real-time protection off"); }
    if (sec.sigAgeDays != null) {
      avDetail.push(`signatures ${sec.sigAgeDays === 0 ? "current" : sec.sigAgeDays + "d old"}`);
      if (sec.sigAgeDays > 7 && avStatus === "ok") avStatus = "warn";
    }
    if (sec.lastScanDays != null) avDetail.push(`last scan ${sec.lastScanDays === 0 ? "today" : sec.lastScanDays + "d ago"}`);
    if (Array.isArray(sec.firewall)) {
      avDetail.push(sec.firewall.length ? `firewall on (${sec.firewall.join(", ")})` : "firewall off");
      if (!sec.firewall.length && avStatus === "ok") avStatus = "warn";
    }
    checks.push({ id: "virus", label: "Malware protection", status: avStatus, value: avValue || "—", detail: avDetail.join(" · ") });

    this.device = { checks, at: now };
    this.deviceAt = now;
    return this.device;
  }

  // ---------- sites ----------
  normaliseUrl(url) {
    let u = String(url || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try { return new URL(u).toString(); } catch { return ""; }
  }

  addSite({ url, name, everyMinutes } = {}) {
    const clean = this.normaliseUrl(url);
    if (!clean) return { ok: false, error: "that does not look like a URL" };
    if (this.state.sites.some((s) => s.url === clean)) return { ok: false, error: "already being watched" };
    const site = {
      id: "site" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      url: clean,
      name: (name || new URL(clean).hostname).slice(0, 60),
      everyMinutes: Math.max(1, Number(everyMinutes) || DEFAULT_EVERY_MIN),
      createdAt: Date.now(),
      lastCheckAt: 0,
      status: "unknown",
      history: [],
      findings: [],
    };
    this.state.sites.push(site);
    this.save();
    this.checkSite(site.id).catch(() => {});
    return { ok: true, site };
  }

  removeSite(id) {
    this.state.sites = this.state.sites.filter((s) => s.id !== id);
    this.save();
    return { ok: true };
  }

  updateSite(id, patch) {
    const s = this.state.sites.find((x) => x.id === id);
    if (!s) return { ok: false };
    if (patch.everyMinutes) s.everyMinutes = Math.max(1, Number(patch.everyMinutes));
    if (patch.name) s.name = String(patch.name).slice(0, 60);
    if (typeof patch.paused === "boolean") s.paused = patch.paused;
    this.save();
    return { ok: true, site: s };
  }

  // How long is the certificate good for? Read from the live handshake, not from a header.
  tlsDaysLeft(hostname, port) {
    return new Promise((resolve) => {
      let socket;
      const done = (v) => { try { socket && socket.destroy(); } catch {} resolve(v); };
      try {
        const tls = require("node:tls");
        socket = tls.connect({ host: hostname, port: port || 443, servername: hostname, timeout: 8000 }, () => {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) return done(null);
          done(Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000));
        });
        socket.on("error", () => done(null));
        socket.on("timeout", () => done(null));
      } catch { done(null); }
    });
  }

  async checkSite(id) {
    const site = this.state.sites.find((s) => s.id === id);
    if (!site) return null;
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let entry = { at: started, ms: 0, code: 0, ok: false, error: "" };
    try {
      const res = await fetch(site.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "NutaanCode-Monitor/1.0", Accept: "*/*" },
      });
      entry.ms = Date.now() - started;
      entry.code = res.status;
      entry.ok = res.status < 400;
      // Read (and discard) the body so the timing covers the real response, not just the headers.
      try { await res.arrayBuffer(); } catch {}
      const h = {};
      for (const [k, v] of res.headers.entries()) h[k.toLowerCase()] = v;
      site.server = h.server || "";
      site.headers = {
        hsts: !!h["strict-transport-security"],
        csp: !!h["content-security-policy"],
        nosniff: (h["x-content-type-options"] || "").toLowerCase() === "nosniff",
        frame: !!h["x-frame-options"] || /frame-ancestors/i.test(h["content-security-policy"] || ""),
        referrer: !!h["referrer-policy"],
      };
    } catch (e) {
      entry.ms = Date.now() - started;
      entry.error = e.name === "AbortError" ? "timed out after 15s" : e.message;
    }
    clearTimeout(timer);

    let u = null;
    try { u = new URL(site.url); } catch {}
    if (u && u.protocol === "https:") {
      site.tlsDays = await this.tlsDaysLeft(u.hostname, u.port ? Number(u.port) : 443);
    } else {
      site.tlsDays = null;
    }

    const prev = site.status;
    site.status = entry.ok
      ? (entry.ms > 3000 || (site.tlsDays != null && site.tlsDays < 14) ? "warn" : "ok")
      : entry.code >= 400 && entry.code < 500 ? "warn" : "bad";
    site.lastCheckAt = started;
    site.lastMs = entry.ms;
    site.lastCode = entry.code;
    site.lastError = entry.error;
    site.history.push(entry);
    if (site.history.length > MAX_HISTORY) site.history = site.history.slice(-MAX_HISTORY);

    const up = site.history.filter((x) => x.ok).length;
    site.uptime = Math.round((up / site.history.length) * 1000) / 10;
    site.avgMs = Math.round(site.history.reduce((n, x) => n + x.ms, 0) / site.history.length);

    // Only a change of state is worth a notification. A site that has been down for an hour should
    // not ring every five minutes.
    if (prev !== "unknown" && prev !== site.status) {
      const recovered = site.status === "ok";
      this.addEvent({
        kind: "site",
        siteId: site.id,
        status: site.status,
        title: `${site.name} ${recovered ? "is back up" : site.status === "bad" ? "is down" : "is degraded"}`,
        body: entry.error || `HTTP ${entry.code} in ${entry.ms} ms`,
      });
      this.notify({
        title: `${site.name} ${recovered ? "recovered" : site.status === "bad" ? "is down" : "is slow"}`,
        body: entry.error || `HTTP ${entry.code} · ${entry.ms} ms`,
      });
    }
    await this.save();
    this.emit("monitor:changed", this.view());
    return site;
  }

  addEvent(ev) {
    this.state.events.unshift({ id: "ev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), unread: true, ...ev });
    if (this.state.events.length > MAX_EVENTS) this.state.events.length = MAX_EVENTS;
  }

  markEventsRead() {
    for (const e of this.state.events) e.unread = false;
    this.save();
    return { ok: true };
  }

  clearEvents() {
    this.state.events = [];
    this.save();
    return { ok: true };
  }

  // ---------- scheduled vulnerability scans ----------
  // Twice a week, at a time picked at random inside the week. A fixed Sunday-03:00 scan is a
  // window anyone watching can work around, and it also means every finding is a week stale.
  planScans(force) {
    const now = Date.now();
    if (!force && this.state.nextScanAt > now) return;
    if (force || !this.state.scanWeekStart || now - this.state.scanWeekStart > WEEK_MS) {
      this.state.scanWeekStart = now;
      this.state.scansThisWeek = 0;
    }
    const remaining = Math.max(1, SCANS_PER_WEEK - this.state.scansThisWeek);
    const windowMs = Math.max(60 * 60_000, (this.state.scanWeekStart + WEEK_MS - now) / remaining);
    // Somewhere in the next window, but never in the first few minutes after a launch.
    this.state.nextScanAt = now + 10 * 60_000 + Math.floor(Math.random() * windowMs);
    this.save();
  }

  async runScan(reason) {
    if (this.busy) return null;
    this.busy = true;
    const startedAt = Date.now();
    const targets = this.state.sites.filter((s) => !s.paused);
    const report = { id: "scan" + startedAt.toString(36), at: startedAt, reason: reason || "scheduled", sites: [], project: null, findings: 0 };
    try {
      for (const site of targets) {
        if (!this.arsenal) break;
        let recon = null;
        try { recon = await this.arsenal.httpRecon(site.url); } catch (e) { recon = { error: e.message }; }
        const findings = summariseRecon(recon);
        site.findings = findings;
        site.scannedAt = startedAt;
        report.sites.push({ id: site.id, name: site.name, url: site.url, findings });
        report.findings += findings.filter((f) => f.severity !== "info").length;
      }
      if (this.state.projectRoot && this.arsenal && this.arsenal.scanProject) {
        try {
          const res = await this.arsenal.scanProject(this.state.projectRoot, { maxFiles: 600 });
          const list = (res && (res.findings || res.issues)) || [];
          report.project = {
            root: this.state.projectRoot,
            count: list.length,
            top: list.slice(0, 8).map((f) => ({
              severity: f.severity || "medium",
              title: f.rule || f.title || f.type || "finding",
              file: f.file || f.path || "",
              line: f.line || 0,
            })),
          };
          report.findings += list.length;
        } catch (e) {
          report.project = { root: this.state.projectRoot, error: e.message };
        }
      }
    } finally {
      this.busy = false;
    }
    report.ms = Date.now() - startedAt;
    this.state.scans.unshift(report);
    if (this.state.scans.length > MAX_SCANS) this.state.scans.length = MAX_SCANS;
    this.state.scansThisWeek = (this.state.scansThisWeek || 0) + 1;
    this.state.lastScanAt = startedAt;
    this.planScans(this.state.scansThisWeek >= SCANS_PER_WEEK);

    const worst = report.sites.flatMap((s) => s.findings).filter((f) => f.severity === "high").length;
    this.addEvent({
      kind: "scan",
      status: worst ? "bad" : report.findings ? "warn" : "ok",
      title: report.findings
        ? `Security scan: ${report.findings} finding${report.findings === 1 ? "" : "s"}`
        : "Security scan: nothing found",
      body: `${report.sites.length} site${report.sites.length === 1 ? "" : "s"}${report.project ? " + this project" : ""} · ${(report.ms / 1000).toFixed(1)}s`,
      scanId: report.id,
    });
    if (report.findings) {
      this.notify({
        title: worst ? "Security scan found something serious" : "Security scan finished",
        body: `${report.findings} finding${report.findings === 1 ? "" : "s"} across ${report.sites.length} site${report.sites.length === 1 ? "" : "s"}`,
      });
    }
    await this.save();
    this.emit("monitor:changed", this.view());
    return report;
  }

  // ---------- the loop ----------
  async tick() {
    if (!this.state.enabled) return;
    const now = Date.now();
    await this.readDevice().catch(() => {});

    for (const site of this.state.sites) {
      if (site.paused) continue;
      if (now - (site.lastCheckAt || 0) < site.everyMinutes * 60_000) continue;
      await this.checkSite(site.id).catch(() => {});
    }

    const dev = this.device;
    if (dev) {
      // Device problems also deserve one notification per transition, not one per minute.
      if (!this.lastDeviceStatus) this.lastDeviceStatus = {};
      for (const c of dev.checks) {
        const prev = this.lastDeviceStatus[c.id];
        if (prev && prev !== c.status && (c.status === "bad" || c.status === "warn")) {
          this.addEvent({ kind: "device", status: c.status, title: `${c.label}: ${c.value}`, body: c.detail || "" });
          this.notify({ title: c.label, body: `${c.value}${c.detail ? " — " + c.detail : ""}` });
          await this.save();
        }
        this.lastDeviceStatus[c.id] = c.status;
      }
    }

    if (this.state.nextScanAt && now >= this.state.nextScanAt) {
      if (this.state.sites.length || this.state.projectRoot) await this.runScan("scheduled").catch(() => {});
      else this.planScans(true);
    }

    this.emit("monitor:changed", this.view());
  }

  // ---------- the view the UI renders ----------
  view() {
    const checks = (this.device && this.device.checks) || [];
    const siteStatuses = this.state.sites.filter((s) => !s.paused).map((s) => s.status);
    const all = [...checks.map((c) => c.status), ...siteStatuses];
    const overall = all.includes("bad") ? "bad" : all.includes("warn") ? "warn" : all.length ? "ok" : "unknown";
    return {
      enabled: this.state.enabled,
      overall,
      checks,
      deviceAt: this.deviceAt,
      sites: this.state.sites.map((s) => ({
        id: s.id, name: s.name, url: s.url, status: s.status, paused: !!s.paused,
        everyMinutes: s.everyMinutes, lastCheckAt: s.lastCheckAt, lastMs: s.lastMs,
        lastCode: s.lastCode, lastError: s.lastError, uptime: s.uptime, avgMs: s.avgMs,
        tlsDays: s.tlsDays, headers: s.headers, server: s.server,
        findings: s.findings || [], scannedAt: s.scannedAt || 0,
        spark: (s.history || []).slice(-40).map((h) => ({ ok: h.ok, ms: h.ms })),
      })),
      events: this.state.events.slice(0, 60),
      unread: this.state.events.filter((e) => e.unread).length,
      scans: this.state.scans.slice(0, 6),
      nextScanAt: this.state.nextScanAt,
      lastScanAt: this.state.lastScanAt || 0,
      scansThisWeek: this.state.scansThisWeek || 0,
      scansPerWeek: SCANS_PER_WEEK,
    };
  }

  setEnabled(on) {
    this.state.enabled = !!on;
    this.save();
    return this.view();
  }
}

// Turn a raw httpRecon result into a short, ranked list a human can act on.
function summariseRecon(recon) {
  const out = [];
  if (!recon || recon.error) {
    return [{ severity: "info", title: "Could not scan", detail: (recon && recon.error) || "no response" }];
  }
  const h = recon.headers || {};
  const sec = recon.securityHeaders || {};
  const missing = [];
  const has = (name, alt) => !!(h[name] || (sec && (sec[name] || (alt && sec[alt]))));
  if (!has("strict-transport-security", "hsts")) missing.push("HSTS");
  if (!has("content-security-policy", "csp")) missing.push("Content-Security-Policy");
  if (!has("x-content-type-options", "nosniff")) missing.push("X-Content-Type-Options");
  if (!has("x-frame-options") && !/frame-ancestors/i.test(h["content-security-policy"] || "")) missing.push("X-Frame-Options");
  if (!has("referrer-policy")) missing.push("Referrer-Policy");
  if (missing.length) {
    out.push({
      severity: missing.length >= 4 ? "high" : "medium",
      title: `${missing.length} security header${missing.length === 1 ? "" : "s"} missing`,
      detail: missing.join(", "),
    });
  }
  for (const c of recon.cookies || []) {
    const flags = [];
    if (!c.secure) flags.push("no Secure");
    if (!c.httpOnly) flags.push("no HttpOnly");
    if (!c.sameSite) flags.push("no SameSite");
    if (flags.length) {
      out.push({ severity: flags.length >= 2 ? "high" : "medium", title: `Cookie "${c.name}" is weakly set`, detail: flags.join(", ") });
    }
  }
  for (const e of recon.credentialExposure || []) {
    out.push({ severity: "high", title: "Possible secret in the page", detail: typeof e === "string" ? e : e.type || e.match || "match" });
  }
  if (recon.server) out.push({ severity: "info", title: "Server", detail: String(recon.server) });
  return out;
}

module.exports = { Monitor, summariseRecon, decodeAvState };
