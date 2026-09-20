/* ---------- Health monitor (renderer) ----------
   Two surfaces onto the same data: a traffic light in the title bar that is always there, and the
   detail on the Health page. Everything shown here was measured in the main process — the disks and
   RAM from the OS, the GPU and antivirus from a system query, the sites from a real HTTP request —
   so nothing on this page is an estimate. */
(function () {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = () => (window.nutaan && window.nutaan.monitor) || null;

  const S = { view: null, booted: false, popOpen: false };

  const ICONS = {
    storage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="6" rx="2"/><rect x="3" y="13.5" width="18" height="6" rx="2"/><circle cx="7" cy="7.5" r="0.9" fill="currentColor"/><circle cx="7" cy="16.5" r="0.9" fill="currentColor"/></svg>',
    ram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7V4.5M12 7V4.5M17 7V4.5M7 17v2.5M12 17v2.5M17 17v2.5"/></svg>',
    gpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="9" cy="12" r="2.6"/><path d="M15 9.5h3.5M15 12h3.5M15 14.5h3.5"/></svg>',
    virus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v5.4c0 4.3-3 8.2-7.5 9.6-4.5-1.4-7.5-5.3-7.5-9.6V6z"/><path d="M9.2 12.2l2 2 3.6-3.9"/></svg>',
  };

  const fmtWhen = (ts) => {
    if (!ts) return "never";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s <= 5 ? "just now" : s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
  };
  const fmtUntil = (ts) => {
    if (!ts) return "not scheduled";
    const m = Math.round((ts - Date.now()) / 60000);
    if (m <= 0) return "due now";
    if (m < 60) return "in " + m + " min";
    const h = Math.round(m / 60);
    if (h < 48) return "in " + h + "h";
    return new Date(ts).toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  };

  function overallLabel(v) {
    if (!v || v.overall === "unknown") return "Checking…";
    const bad = v.checks.filter((c) => c.status === "bad").length + v.sites.filter((s) => s.status === "bad" && !s.paused).length;
    const warn = v.checks.filter((c) => c.status === "warn").length + v.sites.filter((s) => s.status === "warn" && !s.paused).length;
    if (bad) return bad === 1 ? "1 problem" : bad + " problems";
    if (warn) return warn === 1 ? "1 warning" : warn + " warnings";
    return "All good";
  }

  // ---------- title-bar chip ----------
  function renderChip() {
    const v = S.view;
    const chip = el("healthChip");
    if (!chip) return;
    const overall = (v && v.overall) || "unknown";
    chip.className = "health-chip " + overall;
    el("hcLabel").textContent = overallLabel(v);
    const badge = el("hcBadge");
    const unread = (v && v.unread) || 0;
    badge.hidden = !unread;
    badge.textContent = String(unread);
    badge.title = `${unread} unread health alerts`;
    badge.setAttribute("aria-label", `${unread} unread health alerts`);
    chip.title = `${overallLabel(v)}${unread ? ` · ${unread} unread health alerts` : ""}. Open device and web-app health.`;
  }

  function checkRow(c, compact) {
    const pctBar = c.percent == null ? "" :
      `<div class="mc-bar"><div class="mc-fill ${esc(c.status)}" style="width:${Math.max(2, Math.min(100, c.percent))}%"></div></div>`;
    return `<div class="mc-item ${esc(c.status)}">
        <span class="mc-icon">${ICONS[c.id] || ICONS.gpu}</span>
        <div class="mc-body">
          <div class="mc-top"><span class="mc-label">${esc(c.label)}</span><span class="mc-value">${esc(c.value)}</span></div>
          ${compact ? "" : pctBar}
          ${c.detail ? `<div class="mc-detail">${esc(c.detail)}</div>` : ""}
        </div>
      </div>`;
  }

  function siteRow(s, compact) {
    const dot = `<span class="ms-dot ${esc(s.paused ? "off" : s.status)}"></span>`;
    const meta = s.lastError
      ? esc(s.lastError)
      : `${s.lastCode || "—"} · ${s.lastMs == null ? "—" : s.lastMs + " ms"}${s.uptime != null ? " · " + s.uptime + "% up" : ""}`;
    if (compact) {
      return `<div class="ms-compact">${dot}<span class="ms-name">${esc(s.name)}</span><span class="ms-meta">${esc(meta)}</span></div>`;
    }
    const issues = (s.findings || []).filter((f) => f.severity !== "info");
    const spark = (s.spark || []).map((h) => {
      const height = Math.max(3, Math.min(18, Math.round((h.ms || 0) / 120)));
      return `<i class="${h.ok ? "" : "bad"}" style="height:${height}px"></i>`;
    }).join("");
    const headers = s.headers
      ? Object.entries({ HSTS: s.headers.hsts, CSP: s.headers.csp, "X-CTO": s.headers.nosniff, Frame: s.headers.frame, Referrer: s.headers.referrer })
          .map(([k, v]) => `<span class="ms-hdr ${v ? "on" : "off"}">${k}</span>`).join("")
      : "";
    return `<div class="ms-card ${esc(s.paused ? "off" : s.status)}" data-id="${esc(s.id)}">
        <div class="ms-head">
          ${dot}
          <span class="ms-name">${esc(s.name)}</span>
          <span class="ms-url">${esc(s.url)}</span>
          <span class="spacer"></span>
          <button class="ms-act" data-act="check" title="Check it now">Check</button>
          <button class="ms-act" data-act="pause">${s.paused ? "Resume" : "Pause"}</button>
          <button class="ms-act danger" data-act="remove" title="Stop watching">Remove</button>
        </div>
        <div class="ms-stats">
          <span>${esc(meta)}</span>
          ${s.tlsDays != null ? `<span class="${s.tlsDays < 14 ? "bad" : s.tlsDays < 30 ? "warn" : ""}">TLS ${s.tlsDays}d left</span>` : ""}
          ${s.avgMs ? `<span>avg ${s.avgMs} ms</span>` : ""}
          <span>checked ${esc(fmtWhen(s.lastCheckAt))}</span>
          <span class="spacer"></span>
          <span class="ms-spark">${spark}</span>
        </div>
        ${headers ? `<div class="ms-headers">${headers}</div>` : ""}
        ${issues.length
          ? `<div class="ms-findings">${issues.slice(0, 4).map((f) =>
              `<div class="ms-finding ${esc(f.severity)}"><b>${esc(f.title)}</b>${f.detail ? " — " + esc(f.detail) : ""}</div>`).join("")}
             ${s.scannedAt ? `<div class="ms-scanned">scanned ${esc(fmtWhen(s.scannedAt))}</div>` : ""}</div>`
          : s.scannedAt ? `<div class="ms-findings ok">No security findings · scanned ${esc(fmtWhen(s.scannedAt))}</div>` : ""}
      </div>`;
  }

  function renderPop() {
    const v = S.view;
    if (!v || !el("hpChecks")) return;
    el("hpChecks").innerHTML = v.checks.map((c) => checkRow(c, true)).join("") || `<div class="st-note">No readings yet.</div>`;
    el("hpSites").innerHTML = v.sites.length
      ? v.sites.map((s) => siteRow(s, true)).join("")
      : `<div class="st-note">Nothing watched yet — add a URL on the Health page.</div>`;
    el("hpNextScan").textContent = "scan " + fmtUntil(v.nextScanAt);
  }

  function renderPage() {
    const v = S.view;
    if (!v || !el("monChecks")) return;
    el("monChecks").innerHTML = v.checks.map((c) => checkRow(c, false)).join("");
    el("monDeviceWhen").textContent = v.deviceAt ? "read " + fmtWhen(v.deviceAt) : "";
    el("monSiteCount").textContent = v.sites.length ? String(v.sites.length) : "";
    el("monSites").innerHTML = v.sites.length
      ? v.sites.map((s) => siteRow(s, false)).join("")
      : `<div class="page-empty">Nothing watched yet. Paste any web app's URL above — Nutaan will check it on a schedule, tell you when it goes down or slows, watch the certificate, and scan it for security problems twice a week.</div>`;
    el("monScanWhen").textContent = `${v.scansThisWeek}/${v.scansPerWeek} scans this week · next ${fmtUntil(v.nextScanAt)}`;
    el("monEventCount").textContent = v.events.length ? String(v.events.length) : "";
    el("monEvents").innerHTML = v.events.length
      ? v.events.map((e) => `<div class="mev ${esc(e.status || "ok")}${e.unread ? " unread" : ""}">
            <span class="mev-dot"></span>
            <div class="mev-body"><div class="mev-title">${esc(e.title)}</div>${e.body ? `<div class="mev-sub">${esc(e.body)}</div>` : ""}</div>
            <span class="mev-when">${esc(fmtWhen(e.at))}</span>
          </div>`).join("")
      : `<div class="page-empty">Nothing has happened yet. Outages, recoveries, low disk, a scan finding — they all land here, and each one also raises a desktop notification.</div>`;
  }

  // ---------- reclaimable space ----------
  // A dry run first: it measures what is there without touching anything, so the button can say a
  // real number instead of a promise. The clean itself reports what it actually managed to free —
  // a cache file held open by a running program does not count.
  const fmtMB = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : Math.round(mb) + " MB");

  async function scanCleanup() {
    const sum = el("mclSum");
    const btn = el("mclClean");
    if (!sum || !api().cleanup) return;
    sum.textContent = "Checking what is safe to delete…";
    btn.disabled = true;
    let res = null;
    try { res = await api().cleanup({ dryRun: true }); } catch {}
    if (!res) { sum.textContent = "Could not check."; return; }
    S.clean = res;
    sum.textContent = res.count
      ? `${fmtMB(res.scannedMB)} across ${res.count} location${res.count === 1 ? "" : "s"}`
      : "Nothing to clean — this machine is already tidy";
    btn.disabled = !res.count;
    btn.textContent = res.count ? `Clean up ${fmtMB(res.scannedMB)}` : "Nothing to clean";
    el("mclItems").innerHTML = (res.items || []).slice(0, 8).map((i) =>
      `<div class="mcl-item"><span class="mcl-label">${esc(i.label)}</span><span class="mcl-mb">${esc(fmtMB(i.mb))}</span></div>`).join("");
  }

  async function runCleanup() {
    const btn = el("mclClean");
    const sum = el("mclSum");
    btn.disabled = true;
    btn.textContent = "Cleaning…";
    let res = null;
    try { res = await api().cleanup({ dryRun: false }); } catch {}
    if (!res) { btn.textContent = "Clean up"; return; }
    sum.textContent = `Freed ${fmtMB(res.freedMB)}` + (res.blockedCount
      ? ` · ${fmtMB(res.blockedMB)} was in use by running programs and is still there`
      : "");
    el("mclItems").innerHTML = (res.items || []).slice(0, 8).map((i) =>
      `<div class="mcl-item ${i.removed ? "done" : "kept"}"><span class="mcl-label">${esc(i.label)}</span>` +
      `<span class="mcl-mb">${i.removed ? "freed " + esc(fmtMB(i.freedMB)) : esc(i.error || "kept")}</span></div>`).join("");
    btn.textContent = "Clean up";
    // The disk figure in the device strip is now wrong — re-read it.
    refresh({ refresh: true });
    setTimeout(scanCleanup, 1500);
  }


  // ---------- Free up space: scan → review → delete ----------
  // The agent can open this sheet and suggest what to tick. It cannot tick anything, and it cannot
  // press the button: every deletion on this machine goes through a human looking at this list.
  const RC = { scan: null, selected: new Set(), busy: false, targetGB: 0 };

  const rcFmt = (b) => {
    if (!b) return "0 B";
    if (b < 1024) return b + " B";
    if (b < 1048576) return Math.round(b / 1024) + " KB";
    if (b < 1073741824) return Math.round(b / 1048576) + " MB";
    return (b / 1073741824).toFixed(2) + " GB";
  };

  function rcSelectedBytes() {
    let n = 0;
    for (const g of RC.scan?.groups || []) {
      for (const i of g.items) if (RC.selected.has(i.id)) n += i.bytes;
    }
    return n;
  }

  function rcRenderFooter() {
    const bytes = rcSelectedBytes();
    const count = RC.selected.size;
    el("rcSelected").innerHTML = count
      ? `<b>${rcFmt(bytes)}</b> selected · ${count} item${count === 1 ? "" : "s"}`
      : "Nothing selected";
    el("rcDelete").disabled = !count || RC.busy;
    el("rcDelete").textContent = count ? `Delete ${rcFmt(bytes)} permanently` : "Delete permanently";
    if (RC.targetGB) {
      const pct = Math.min(100, (bytes / (RC.targetGB * 1073741824)) * 100);
      el("rcMeterFill").style.width = pct.toFixed(1) + "%";
      el("rcMeterFill").classList.toggle("done", pct >= 100);
      el("rcMeterLabel").textContent = `${rcFmt(bytes)} of the ${RC.targetGB} GB you asked for`;
    }
  }

  function rcRenderGroups() {
    const box = el("rcGroups");
    const scan = RC.scan;
    if (!box || !scan) return;
    box.hidden = false;
    el("rcScanning").hidden = true;
    box.innerHTML = scan.groups.map((g) => {
      const bytes = g.items.reduce((n, i) => n + i.bytes, 0);
      if (!g.items.length) return "";
      const isApps = g.kind === "apps";
      const on = g.items.filter((i) => RC.selected.has(i.id)).length;
      return `<section class="rc-group${g.defaultOn ? " safe" : ""}" data-group="${esc(g.id)}">
          <div class="rc-g-head">
            ${isApps ? "" : `<input type="checkbox" class="rc-g-check" data-group="${esc(g.id)}" ${on === g.items.length ? "checked" : ""} />`}
            <span class="rc-g-title">${esc(g.title)}</span>
            ${g.defaultOn ? `<span class="rc-tag safe">safe</span>` : ""}
            ${g.kind === "system" ? `<span class="rc-tag admin">administrator</span>` : ""}
            <span class="spacer"></span>
            <span class="rc-g-size">${rcFmt(bytes)}</span>
            <span class="rc-g-count">${g.items.length}</span>
            <button class="rc-g-toggle" type="button" data-group="${esc(g.id)}">▾</button>
          </div>
          <div class="rc-g-hint">${esc(g.hint || "")}</div>
          <div class="rc-items" data-group="${esc(g.id)}" hidden>
            ${g.items.map((i) => `
              <label class="rc-item${isApps ? " app" : ""}">
                ${isApps
                  ? `<button class="rc-uninstall" type="button" data-id="${esc(i.id)}">Uninstall</button>`
                  : `<input type="checkbox" class="rc-check" data-id="${esc(i.id)}" ${RC.selected.has(i.id) ? "checked" : ""} />`}
                <span class="rc-i-label" title="${esc(i.path || i.label)}">${esc(i.label)}</span>
                ${i.note ? `<span class="rc-i-note">${esc(i.note)}</span>` : ""}
                <span class="spacer"></span>
                <span class="rc-i-size">${rcFmt(i.bytes)}</span>
              </label>`).join("")}
          </div>
        </section>`;
    }).join("");
    rcRenderFooter();
  }

  function rcPreselect(groupIds) {
    RC.selected.clear();
    for (const g of RC.scan?.groups || []) {
      if (g.kind === "apps") continue; // an app is never bulk-ticked; it goes through its uninstaller
      const want = g.defaultOn || (groupIds || []).includes(g.id);
      if (want) for (const i of g.items) RC.selected.add(i.id);
    }
  }

  async function rcScan({ targetGB = 0, preselect = [] } = {}) {
    const api2 = window.nutaan.reclaim;
    if (!api2 || RC.busy) return;
    RC.busy = true;
    RC.targetGB = targetGB;
    el("rcOverlay").hidden = false;
    el("rcResult").hidden = true;
    el("rcGroups").hidden = true;
    el("rcScanning").hidden = false;
    el("rcMeter").hidden = !targetGB;
    el("rcSub").textContent = "Scanning this computer — nothing is being deleted.";
    el("rcTitle").textContent = targetGB ? `Free up ${targetGB} GB` : "Free up space";
    el("rcDelete").disabled = true;
    try {
      // 75s: long enough for a real sweep of a large disk, short enough that the sheet does not
      // feel hung. The progress label says which phase is running throughout.
      RC.scan = await api2.scan({ budgetMs: 75000 });
    } catch {
      RC.scan = null;
    }
    RC.busy = false;
    if (!RC.scan || RC.scan.error) {
      el("rcScanLabel").textContent = "The scan could not run: " + ((RC.scan && RC.scan.error) || "unknown error");
      return;
    }
    rcPreselect(preselect);
    el("rcSub").innerHTML = `<b>${rcFmt(RC.scan.totalBytes)}</b> found · <b>${rcFmt(RC.scan.safeBytes)}</b> of it safe to remove` +
      (RC.scan.partial ? " · the scan hit its time limit, so there may be more" : "");
    rcRenderGroups();
  }

  async function rcApply() {
    const api2 = window.nutaan.reclaim;
    const paths = [...RC.selected];
    if (!paths.length || RC.busy) return;
    const bytes = rcSelectedBytes();
    const hasSystem = (RC.scan.groups.find((g) => g.kind === "system")?.items || []).some((i) => RC.selected.has(i.id));
    // One last, explicit, unambiguous confirmation — this is permanent.
    const okToGo = confirm(
      `Permanently delete ${paths.length} item${paths.length === 1 ? "" : "s"}, about ${rcFmt(bytes)}?\n\n` +
      `This does not go to the recycle bin. It cannot be undone.` +
      (hasSystem ? `\n\nYour system will ask for administrator permission for the system-level items.` : "")
    );
    if (!okToGo) return;
    RC.busy = true;
    el("rcDelete").disabled = true;
    el("rcDelete").textContent = "Deleting…";
    el("rcGroups").hidden = true;
    el("rcScanning").hidden = false;
    el("rcScanLabel").textContent = "Deleting…";
    let res = null;
    try { res = await api2.apply(paths); } catch (e) { res = { error: e.message }; }
    RC.busy = false;
    el("rcScanning").hidden = true;
    const box = el("rcResult");
    box.hidden = false;
    if (!res || res.error) {
      box.className = "rc-result err";
      box.innerHTML = `<div class="rc-r-head">Nothing was deleted — ${esc((res && res.error) || "the delete failed")}</div>`;
    } else {
      box.className = "rc-result";
      const failed = res.results.filter((r) => !r.removed);
      box.innerHTML =
        `<div class="rc-r-head">Freed <b>${rcFmt(res.freed)}</b> · ${res.removed} removed${res.failed ? ` · ${res.failed} could not be` : ""}</div>` +
        `<div class="rc-r-list">${res.results.slice(0, 14).map((r) =>
          `<div class="rc-r-row ${r.removed ? "ok" : "bad"}"><span>${esc(r.label)}</span><span class="spacer"></span>` +
          `<span>${r.removed ? "freed " + rcFmt(r.freed) : esc(r.error || "kept")}</span></div>`).join("")}</div>` +
        (failed.length ? `<div class="st-note">Anything still listed is held open by a running program — close it and run this again.</div>` : "");
      RC.selected.clear();
      // The device strip and the reclaimable card are both stale now.
      refresh({ refresh: true });
      if (typeof scanCleanup === "function") setTimeout(scanCleanup, 1200);
    }
    el("rcDelete").textContent = "Delete permanently";
    rcRenderFooter();
  }

  function wireReclaim() {
    const overlay = el("rcOverlay");
    if (!overlay) return;
    const close = () => { if (!RC.busy) overlay.hidden = true; };
    el("rcClose").addEventListener("click", close);
    el("rcCancel").addEventListener("click", close);
    el("rcRescan").addEventListener("click", () => rcScan({ targetGB: RC.targetGB }));
    el("rcDelete").addEventListener("click", rcApply);

    el("rcGroups").addEventListener("change", (e) => {
      const one = e.target.closest(".rc-check");
      if (one) {
        if (e.target.checked) RC.selected.add(one.dataset.id);
        else RC.selected.delete(one.dataset.id);
        const sec = one.closest(".rc-group");
        const boxes = [...sec.querySelectorAll(".rc-check")];
        const head = sec.querySelector(".rc-g-check");
        if (head) head.checked = boxes.every((b) => b.checked);
        rcRenderFooter();
        return;
      }
      const all = e.target.closest(".rc-g-check");
      if (all) {
        const g = RC.scan.groups.find((x) => x.id === all.dataset.group);
        for (const i of g.items) { if (e.target.checked) RC.selected.add(i.id); else RC.selected.delete(i.id); }
        for (const b of all.closest(".rc-group").querySelectorAll(".rc-check")) b.checked = e.target.checked;
        rcRenderFooter();
      }
    });

    el("rcGroups").addEventListener("click", async (e) => {
      const toggle = e.target.closest(".rc-g-toggle");
      if (toggle) {
        const items = el("rcGroups").querySelector(`.rc-items[data-group="${toggle.dataset.group}"]`);
        items.hidden = !items.hidden;
        toggle.textContent = items.hidden ? "▾" : "▴";
        return;
      }
      const un = e.target.closest(".rc-uninstall");
      if (un) {
        un.disabled = true;
        un.textContent = "Opening…";
        const res = await window.nutaan.reclaim.uninstall(un.dataset.id);
        un.textContent = res && res.ok ? "Removed" : "Uninstall";
        un.disabled = !(res && res.ok);
        if (res && !res.ok && res.error) alert(res.error);
      }
    });

    if (window.nutaan.reclaim.onProgress) {
      window.nutaan.reclaim.onProgress((p) => {
        const label = el("rcScanLabel");
        if (!label || el("rcScanning").hidden) return;
        label.textContent = p.label
          ? p.label + "…"
          : `Deleting ${p.done}/${p.total} — freed ${rcFmt(p.freed || 0)}`;
      });
    }
    // The agent asked for the sheet; it still cannot touch anything in it.
    if (window.nutaan.reclaim.onReview) {
      window.nutaan.reclaim.onReview(({ targetGB, preselect }) => {
        rcScan({ targetGB: targetGB || 0, preselect: preselect || [] });
      });
    }
    const btn = el("mclFreeUp");
    if (btn) btn.addEventListener("click", () => rcScan({}));
  }

  function render() {
    renderChip();
    if (S.popOpen) renderPop();
    if (el("healthPage") && !el("healthPage").hidden) renderPage();
  }

  async function refresh(opts) {
    if (!api()) return;
    try { S.view = await api().view(opts); } catch { return; }
    render();
  }

  function wire() {
    const chip = el("healthChip");
    const pop = el("healthPop");
    if (!chip) return;

    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      S.popOpen = pop.hidden;
      pop.hidden = !S.popOpen;
      if (S.popOpen) { renderPop(); refresh({ refresh: true }); }
    });
    document.addEventListener("click", (e) => {
      if (!S.popOpen) return;
      if (e.target.closest("#healthPop") || e.target.closest("#healthChip")) return;
      S.popOpen = false;
      pop.hidden = true;
    });
    el("hpRefresh").addEventListener("click", (e) => { e.stopPropagation(); refresh({ refresh: true }); });
    el("hpOpen").addEventListener("click", () => {
      pop.hidden = true;
      S.popOpen = false;
      const row = [...document.querySelectorAll(".nav-row")].find((r) => r.textContent.includes("Health"));
      if (row) row.click();
    });
    el("hpScan").addEventListener("click", async (e) => {
      e.stopPropagation();
      el("hpScan").disabled = true;
      el("hpScan").textContent = "Scanning…";
      try { S.view = await api().scanNow(); render(); } catch {}
      el("hpScan").disabled = false;
      el("hpScan").textContent = "Scan now";
    });

    const form = el("monAddForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const url = el("monUrl").value.trim();
        if (!url) return;
        const res = await api().addSite({ url, everyMinutes: Number(el("monEvery").value) });
        if (!res.ok) {
          el("monUrl").classList.add("bad");
          el("monUrl").title = res.error || "";
          setTimeout(() => el("monUrl").classList.remove("bad"), 1800);
          return;
        }
        el("monUrl").value = "";
        refresh();
      });
    }

    el("monSites")?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".ms-act");
      if (!btn) return;
      const card = btn.closest(".ms-card");
      const id = card && card.dataset.id;
      if (!id) return;
      const act = btn.dataset.act;
      btn.disabled = true;
      if (act === "check") { S.view = await api().checkSite(id); render(); }
      else if (act === "pause") {
        const site = S.view.sites.find((x) => x.id === id);
        await api().updateSite(id, { paused: !site.paused });
        await refresh();
      } else if (act === "remove") {
        if (confirm("Stop watching this site? Its history goes too.")) { await api().removeSite(id); await refresh(); }
      }
      btn.disabled = false;
    });

    el("monRefresh")?.addEventListener("click", () => { refresh({ refresh: true }); scanCleanup(); });
    el("mclRescan")?.addEventListener("click", scanCleanup);
    el("mclClean")?.addEventListener("click", runCleanup);
    el("monScanNow")?.addEventListener("click", async (e) => {
      const b = e.target;
      b.disabled = true;
      b.textContent = "Scanning…";
      try { S.view = await api().scanNow(); render(); } catch {}
      b.disabled = false;
      b.textContent = "Scan now";
    });
    el("monMarkRead")?.addEventListener("click", async () => { S.view = await api().markRead(); render(); });
    el("monClearEvents")?.addEventListener("click", async () => { S.view = await api().clearEvents(); render(); });

    if (window.nutaan.onAutonomousEvent) {
      window.nutaan.onAutonomousEvent("monitor:changed", (v) => { S.view = v; render(); });
    }
    // The device reading is only refreshed in the main process every minute; re-rendering keeps the
    // relative times ("read 2 min ago") honest without asking for anything.
    setInterval(() => { if (S.view) render(); }, 30_000);
  }

  window.NutaanMonitor = {
    boot() {
      if (S.booted || !api()) return;
      S.booted = true;
      wire();
      wireReclaim();
      refresh();
    },
    onShowHealth() {
      refresh({ refresh: true });
      if (!S.clean) scanCleanup();
    },
    refresh,
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(() => window.NutaanMonitor.boot(), 0);
  } else {
    document.addEventListener("DOMContentLoaded", () => window.NutaanMonitor.boot());
  }
})();
