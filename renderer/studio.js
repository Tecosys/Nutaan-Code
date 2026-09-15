/* ---------- Demo Studio ----------
   Screen recording turned into a product demo: the take is never re-encoded into the edit, it stays
   exactly as captured and everything on top of it — backdrop, zooms, the smoothed cursor, the webcam
   bubble — is composited onto a canvas at playback and again at export. That is why the edit is
   non-destructive and why changing a zoom is instant.

   The pointer path is real: the main process samples the OS cursor at 60 Hz while recording, so the
   zooms follow where the mouse actually went rather than guessing from pixels. */
(function () {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const uid = () => Math.random().toString(36).slice(2, 9);

  const api = () => (window.nutaan && window.nutaan.studio) || null;

  // ---------- Backdrops ----------
  const BACKDROPS = [
    { id: "none", kind: "none" },
    { id: "ink", kind: "solid", color: "#0b0c10" },
    { id: "paper", kind: "solid", color: "#eef0f4" },
    { id: "nutaan", kind: "gradient", angle: 135, stops: ["#a855f7", "#ec4899"] },
    { id: "dusk", kind: "gradient", angle: 135, stops: ["#1e1b4b", "#0f172a"] },
    { id: "ocean", kind: "gradient", angle: 140, stops: ["#0ea5e9", "#1e3a8a"] },
    { id: "forest", kind: "gradient", angle: 140, stops: ["#134e4a", "#052e26"] },
    { id: "ember", kind: "gradient", angle: 140, stops: ["#f97316", "#7c2d12"] },
    { id: "mist", kind: "gradient", angle: 160, stops: ["#e2e8f0", "#94a3b8"] },
    { id: "graphite", kind: "gradient", angle: 145, stops: ["#334155", "#0b0c10"] },
    // Painted rather than photographed: a bundled wallpaper would be another megabyte and another
    // licence, and these redraw crisply at any export size.
    { id: "sky", kind: "scene" },
    { id: "sunset", kind: "scene" },
    { id: "aurora", kind: "scene" },
    { id: "mesh", kind: "scene" },
  ];
  const backdrop = (id) => BACKDROPS.find((b) => b.id === id) || BACKDROPS[3];
  // "custom" is not in the preset list — it is whatever two colours and angle the doc is carrying.
  function backdropOf(doc) {
    const st = doc.style;
    if (st.bg === "custom") {
      return { id: "custom", kind: "gradient", angle: st.bgAngle == null ? 135 : st.bgAngle,
        stops: [st.bgFrom || "#a855f7", st.bgTo || "#ec4899"] };
    }
    return backdrop(st.bg);
  }
  const SCENE_CSS = {
    sky: "linear-gradient(180deg,#38bdf8,#bae6fd 62%,#fef3c7)",
    sunset: "linear-gradient(180deg,#4c1d95,#db2777 55%,#fb923c)",
    aurora: "linear-gradient(160deg,#020617,#134e4a 55%,#312e81)",
    mesh: "linear-gradient(135deg,#a855f7,#0ea5e9 50%,#ec4899)",
  };
  function backdropCss(b) {
    if (b.kind === "none") return "repeating-conic-gradient(#1a1c24 0% 25%, #101219 0% 50%) 50% / 12px 12px";
    if (b.kind === "solid") return b.color;
    if (b.kind === "scene") return SCENE_CSS[b.id];
    return `linear-gradient(${b.angle}deg, ${b.stops[0]}, ${b.stops[1]})`;
  }

  const ASPECTS = { auto: null, "16:9": 16 / 9, "1:1": 1, "9:16": 9 / 16, "4:3": 4 / 3 };

  // ---------- State ----------
  const S = {
    booted: false,
    view: "capture",
    sources: [],
    selectedId: null,
    devices: { mics: [], cams: [] },
    hotkeysLive: [],
    rec: null,
    doc: null,
    smoothed: null,       // cursor samples after smoothing, cached against path + smoothing value
    smoothedPath: null,
    settles: null,        // times the pointer came to rest, cached against the path
    settlesPath: null,
    smoothedFor: -1,
    film: [],
    sel: null,            // { kind: "zoom" | "speed", id }
    playing: false,
    dirty: false,
    needsDraw: true,
    rafId: 0,
    exporting: false,
    cancelExport: false,
  };

  // Media elements live outside the DOM tree we re-render, so a redraw never restarts playback.
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  const camVideo = document.createElement("video");
  camVideo.preload = "auto";
  camVideo.muted = true;
  camVideo.playsInline = true;
  const probe = document.createElement("video"); // seeks for the filmstrip, never for playback
  probe.preload = "auto";
  probe.muted = true;

  let audioCtx = null, audioSrc = null, monitorGain = null, exportDest = null;

  function ensureAudioGraph() {
    // createMediaElementSource can only ever be called once for an element, and from that moment the
    // element's audio goes through the graph — so the monitor path has to exist from the start.
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioSrc = audioCtx.createMediaElementSource(video);
      monitorGain = audioCtx.createGain();
      monitorGain.gain.value = el("stMute") && el("stMute").checked ? 0 : 1;
      audioSrc.connect(monitorGain).connect(audioCtx.destination);
      exportDest = audioCtx.createMediaStreamDestination();
      audioSrc.connect(exportDest);
    } catch (err) {
      console.warn("[studio] audio graph unavailable:", err.message);
      audioCtx = null;
    }
  }

  // ---------- Small helpers ----------
  function fmtTime(sec, tenths) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return tenths ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`;
  }
  function fmtBytes(n) {
    if (!n) return "—";
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }
  function ago(ts) {
    if (!ts) return "";
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  // =====================================================================================
  // Capture
  // =====================================================================================

  async function loadSources() {
    const grid = el("stSourceGrid");
    if (!grid || !api()) return;
    grid.innerHTML = `<div class="st-note">Looking for screens and windows…</div>`;
    const res = await api().sources();
    S.sources = (res && res.sources) || [];
    if (S.selectedId && !S.sources.some((s) => s.id === S.selectedId)) S.selectedId = null;
    if (!S.selectedId) {
      const firstScreen = S.sources.find((s) => s.kind === "screen");
      if (firstScreen) S.selectedId = firstScreen.id;
    }
    renderSources();
  }

  function renderSources() {
    const grid = el("stSourceGrid");
    const empty = el("stSourceEmpty");
    if (!grid) return;
    grid.innerHTML = "";
    empty.hidden = S.sources.length > 0;
    el("stSourceCount").textContent = S.sources.length ? String(S.sources.length) : "";
    for (const s of S.sources) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "st-source" + (s.id === S.selectedId ? " active" : "");
      const sub = s.kind === "screen"
        ? (s.width ? `${s.width} × ${s.height}${s.primary ? " · primary" : ""}` : "Whole display")
        : s.isSelf ? "This window" : "Application window";
      card.innerHTML =
        (s.thumbnail
          ? `<img class="st-thumb" src="${esc(s.thumbnail)}" alt="" />`
          : `<div class="st-thumb-empty">no preview</div>`) +
        `<span class="st-src-tag">${s.kind === "screen" ? "Screen" : "Window"}</span>` +
        `<div class="st-src-row">` +
        (s.icon ? `<img class="st-src-icon" src="${esc(s.icon)}" alt="" />` : "") +
        `<span class="st-src-name">${esc(s.name)}</span></div>` +
        `<div class="st-src-sub">${esc(sub)}</div>`;
      card.addEventListener("click", () => {
        S.selectedId = s.id;
        renderSources();
        updateRecordBtn();
      });
      grid.appendChild(card);
    }
    updateRecordBtn();
  }

  function selectedSource() {
    return S.sources.find((s) => s.id === S.selectedId) || null;
  }

  function updateRecordBtn() {
    const btn = el("stRecordBtn");
    const label = el("stRecordLabel");
    if (!btn) return;
    const src = selectedSource();
    btn.disabled = !src || !!S.rec;
    label.textContent = !src ? "Pick a screen first" : `Record ${src.kind === "screen" ? "screen" : "window"}`;
    // Auto-zoom needs the pointer path, and the pointer path is only meaningful against a display.
    const az = el("stOptAutoZoom");
    if (az) {
      const ok = !!src && src.kind === "screen";
      az.disabled = !ok;
      if (!ok) az.checked = false;
    }
  }

  async function loadDevices() {
    const micSel = el("stMicDevice");
    const camSel = el("stCamDevice");
    if (!micSel) return;
    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
    S.devices.mics = devices.filter((d) => d.kind === "audioinput");
    S.devices.cams = devices.filter((d) => d.kind === "videoinput");
    const fill = (sel, list, kind) => {
      sel.innerHTML = "";
      if (!list.length) {
        sel.innerHTML = `<option value="">No ${kind} found</option>`;
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      // Labels stay blank until a device has been granted once — say so rather than showing "".
      list.forEach((d, i) => {
        const o = document.createElement("option");
        o.value = d.deviceId;
        o.textContent = d.label || `${kind} ${i + 1}`;
        sel.appendChild(o);
      });
    };
    fill(micSel, S.devices.mics, "microphone");
    fill(camSel, S.devices.cams, "camera");
    micSel.disabled = micSel.disabled || !el("stOptMic").checked;
    camSel.disabled = camSel.disabled || !el("stOptCamera").checked;
  }

  function pickMime(candidates) {
    for (const m of candidates) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return "";
  }

  async function countdown(seconds) {
    const box = el("stCountdown");
    const num = el("stCountNum");
    if (!seconds) return;
    box.hidden = false;
    for (let i = seconds; i > 0; i--) {
      num.textContent = String(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    box.hidden = true;
  }

  async function startRecording() {
    const src = selectedSource();
    if (!src || S.rec || !api()) return;
    const wantMic = el("stOptMic").checked;
    const wantSystem = el("stOptSystem").checked;
    const wantCam = el("stOptCamera").checked;
    const fps = Number(el("stOptFps").value) || 30;
    const autoZoom = el("stOptAutoZoom").checked && src.kind === "screen";

    // A screen is captured at its own pixel size, not at whatever Chromium would rather give us:
    // without the min bounds a 2560-wide display quietly comes back as 1920, and "full screen"
    // stops meaning full screen. Windows get a generous ceiling and keep their own size.
    const mandatory = {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: src.id,
      maxFrameRate: fps,
      minFrameRate: Math.min(fps, 24),
      maxWidth: 3840,
      maxHeight: 2400,
    };
    if (src.kind === "screen" && src.width && src.height) {
      mandatory.minWidth = mandatory.maxWidth = Math.min(3840, src.width);
      mandatory.minHeight = mandatory.maxHeight = Math.min(2400, src.height);
    }
    const videoConstraint = { mandatory };

    // Pinning the exact display size is what makes "full screen" mean full screen, but a capturer
    // that cannot deliver that size throws OverconstrainedError rather than giving us something.
    // So: ask for the exact size, and if that is refused, ask again without the floor.
    const loose = { mandatory: { ...mandatory } };
    delete loose.mandatory.minWidth;
    delete loose.mandatory.minHeight;
    delete loose.mandatory.minFrameRate;
    loose.mandatory.maxWidth = 3840;
    loose.mandatory.maxHeight = 2400;

    const grab = async (video, audio) => navigator.mediaDevices.getUserMedia({ audio, video });
    const desktopAudioReq = { mandatory: { chromeMediaSource: "desktop" } };

    let display = null;
    let systemAudioFailed = false;
    for (const constraint of [videoConstraint, loose]) {
      try {
        display = await grab(constraint, wantSystem ? desktopAudioReq : false);
        break;
      } catch (err) {
        if (wantSystem) {
          // No loopback device on this OS (macOS, most Linux). Keep the video rather than failing.
          try {
            display = await grab(constraint, false);
            systemAudioFailed = true;
            break;
          } catch { /* fall through to the looser constraint */ }
        }
        if (constraint === loose) return failCapture(err);
      }
    }
    if (!display) return failCapture(new Error("the capture returned no stream"));

    let micStream = null;
    if (wantMic) {
      try {
        const id = el("stMicDevice").value;
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true } : true,
        });
      } catch (err) {
        console.warn("[studio] microphone unavailable:", err.message);
      }
    }

    let camStream = null;
    if (wantCam) {
      try {
        const id = el("stCamDevice").value;
        camStream = await navigator.mediaDevices.getUserMedia({
          video: id ? { deviceId: { exact: id }, width: 1280, height: 720 } : { width: 1280, height: 720 },
        });
      } catch (err) {
        console.warn("[studio] camera unavailable:", err.message);
      }
    }

    // Mix whatever audio we ended up with into a single track, so the file has one clean stream.
    const desktopAudio = display.getAudioTracks();
    const micAudio = micStream ? micStream.getAudioTracks() : [];
    let mixCtx = null;
    let audioTracks = [];
    if (desktopAudio.length && micAudio.length) {
      mixCtx = new AudioContext();
      const dest = mixCtx.createMediaStreamDestination();
      mixCtx.createMediaStreamSource(new MediaStream(desktopAudio)).connect(dest);
      mixCtx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
      audioTracks = dest.stream.getAudioTracks();
    } else {
      audioTracks = desktopAudio.length ? desktopAudio : micAudio;
    }

    await countdown(Number(el("stOptCountdown").value) || 0);

    const videoTrack = display.getVideoTracks()[0];
    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    const width = settings.width || src.width || 1920;
    const height = settings.height || src.height || 1080;

    const stream = new MediaStream([videoTrack, ...audioTracks]);
    const mime = pickMime([
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm",
    ]);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime || undefined,
        videoBitsPerSecond: Math.min(24_000_000, Math.round(width * height * fps * 0.14)),
      });
    } catch (err) {
      return failCapture(err);
    }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    let camRecorder = null;
    const camChunks = [];
    if (camStream) {
      try {
        camRecorder = new MediaRecorder(camStream, {
          mimeType: pickMime(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) || undefined,
          videoBitsPerSecond: 2_500_000,
        });
        camRecorder.ondataavailable = (e) => { if (e.data && e.data.size) camChunks.push(e.data); };
      } catch { camRecorder = null; }
    }

    S.rec = {
      src, fps, width, height, autoZoom,
      display, micStream, camStream, mixCtx,
      recorder, chunks, camRecorder, camChunks,
      hasAudio: audioTracks.length > 0,
      systemAudioFailed,
      startedAt: 0, paused: false, pauses: [], markers: [],
      timer: 0, stopping: false,
    };

    // The user stops from the tray of hotkeys, or by clicking Stop — but the source can also vanish
    // (window closed, screen unplugged), and then the track ends on its own.
    videoTrack.addEventListener("ended", () => { if (S.rec && !S.rec.stopping) stopRecording(); });

    // Get out of the way BEFORE the first frame — otherwise the countdown and this window's own
    // chrome are the opening shot of the demo.
    const minimized = el("stOptMinimize").checked && !src.isSelf;
    if (minimized) {
      try { await api().window("minimize"); } catch {}
      try { await api().recBar(true); } catch {}
      await new Promise((r) => setTimeout(r, 450));
    }

    recorder.start(1000);
    if (camRecorder) camRecorder.start(1000);
    S.rec.startedAt = Date.now();
    S.rec.minimized = minimized;
    S.rec.limitSec = Number(el("stOptLimit").value) || 0;

    if (autoZoom && src.displayId) {
      try {
        const r = await api().cursorStart({ displayId: src.displayId });
        S.rec.cursorSession = r && r.session;
      } catch {}
    }
    try {
      const r = await api().hotkeys(true);
      S.hotkeysLive = (r && r.registered) || [];
    } catch { S.hotkeysLive = []; }
    markHotkeyRows();

    showRecBar(true);
    S.rec.timer = setInterval(tickRecBar, 200);
    updateRecordBtn();
  }

  function failCapture(err) {
    S.rec = null;
    el("stCountdown").hidden = true;
    const grid = el("stSourceGrid");
    const msg = /Permission|NotAllowed/i.test(err.name || err.message || "")
      ? "The OS refused screen capture. On macOS, allow Nutaan Code under Privacy & Security → Screen Recording, then reopen the app."
      : `Could not start the capture: ${err.message}`;
    if (grid) {
      const note = document.createElement("div");
      note.className = "st-note";
      note.style.color = "var(--red)";
      note.textContent = msg;
      grid.parentElement.insertBefore(note, grid);
      setTimeout(() => note.remove(), 9000);
    }
    updateRecordBtn();
  }

  function markHotkeyRows() {
    const rows = el("stKeys") ? el("stKeys").querySelectorAll(".st-key") : [];
    const order = ["stop", "pause", "zoom"];
    rows.forEach((row, i) => {
      const live = !S.rec || S.hotkeysLive.includes(order[i]);
      row.classList.toggle("off", !live);
      row.title = live ? "" : "Another app already owns this shortcut";
    });
  }

  function recElapsedMs() {
    if (!S.rec) return 0;
    const now = Date.now();
    let paused = 0;
    for (const p of S.rec.pauses) paused += (p.end || now) - p.start;
    return now - S.rec.startedAt - paused;
  }

  function tickRecBar() {
    if (!S.rec) return;
    const ms = recElapsedMs();
    const limit = S.rec.limitSec;
    // With a length chosen, the bar counts down to it rather than up from nothing.
    const left = limit ? Math.max(0, limit - ms / 1000) : 0;
    el("stRecTime").textContent = limit ? "−" + fmtTime(left) : fmtTime(ms / 1000);
    if (S.rec.minimized) {
      try { api().recBarState({ elapsedMs: ms, paused: S.rec.paused, remainingSec: limit ? left : null }); } catch {}
    }
    if (limit && ms / 1000 >= limit && !S.rec.stopping) stopRecording();
  }

  function showRecBar(on) {
    const bar = el("stRecBar");
    bar.hidden = !on;
    if (on) {
      el("stRecWhat").textContent = S.rec ? S.rec.src.name : "";
      bar.classList.remove("paused");
      el("stRecPause").textContent = "Pause";
    }
  }

  function togglePause() {
    const r = S.rec;
    if (!r || r.stopping) return;
    if (r.paused) {
      const last = r.pauses[r.pauses.length - 1];
      if (last && !last.end) last.end = Date.now();
      r.recorder.resume();
      if (r.camRecorder) r.camRecorder.resume();
      r.paused = false;
    } else {
      r.pauses.push({ start: Date.now(), end: 0 });
      r.recorder.pause();
      if (r.camRecorder) r.camRecorder.pause();
      r.paused = true;
    }
    el("stRecBar").classList.toggle("paused", r.paused);
    el("stRecPause").textContent = r.paused ? "Resume" : "Pause";
  }

  function markZoom() {
    if (!S.rec || S.rec.paused) return;
    S.rec.markers.push(recElapsedMs() / 1000);
    const btn = el("stRecMark");
    btn.textContent = `Marked ${S.rec.markers.length}`;
    setTimeout(() => { btn.textContent = "Mark zoom"; }, 1200);
  }

  // Absolute wall-clock → position in the recorded file, with paused stretches removed.
  function mediaTimeOf(ts, rec) {
    let paused = 0;
    for (const p of rec.pauses) {
      const end = p.end || ts;
      if (p.start >= ts) break;
      paused += Math.min(end, ts) - p.start;
    }
    return (ts - rec.startedAt - paused) / 1000;
  }

  async function stopRecording() {
    const r = S.rec;
    if (!r || r.stopping) return;
    r.stopping = true;
    clearInterval(r.timer);
    if (r.paused) {
      const last = r.pauses[r.pauses.length - 1];
      if (last && !last.end) last.end = Date.now();
    }
    const measured = recElapsedMs() / 1000;

    const done = new Promise((res) => { r.recorder.onstop = res; });
    const camDone = r.camRecorder ? new Promise((res) => { r.camRecorder.onstop = res; }) : Promise.resolve();
    try { r.recorder.stop(); } catch {}
    try { if (r.camRecorder) r.camRecorder.stop(); } catch {}
    await Promise.all([done, camDone]);

    let cursor = { samples: [], truncated: false };
    if (r.autoZoom) {
      try { cursor = await api().cursorStop(r.cursorSession); } catch {}
    }
    try { await api().hotkeys(false); } catch {}
    S.hotkeysLive = [];

    for (const s of [r.display, r.micStream, r.camStream]) {
      if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    }
    if (r.mixCtx) { try { r.mixCtx.close(); } catch {} }

    showRecBar(false);
    try { await api().recBar(false); } catch {}
    if (r.minimized) { try { await api().window("restore"); } catch {} }

    const blob = new Blob(r.chunks, { type: r.recorder.mimeType || "video/webm" });
    const camBlob = r.camChunks.length ? new Blob(r.camChunks, { type: "video/webm" }) : null;
    S.rec = null;
    updateRecordBtn();
    markHotkeyRows();

    if (!blob.size) {
      alert("The recording came back empty — nothing was captured.");
      return;
    }

    // Cursor samples are wall-clock; turn them into positions along the recorded file.
    const path = [];
    for (const [ts, x, y] of cursor.samples || []) {
      const t = mediaTimeOf(ts, r);
      if (t < -0.2) continue;
      path.push([Math.round(Math.max(0, t) * 1000) / 1000, x, y]);
    }

    await openTake({
      blob, camBlob, measured,
      width: r.width, height: r.height,
      hasAudio: r.hasAudio,
      sourceName: r.src.name,
      sourceKind: r.src.kind,
      cursorPath: path,
      markers: r.markers,
      systemAudioFailed: r.systemAudioFailed,
      autoZoomWanted: r.autoZoom,
      cursorTruncated: !!cursor.truncated,
    });
  }

  // =====================================================================================
  // Project document
  // =====================================================================================

  function newDoc(take, duration) {
    return {
      id: "demo-" + Date.now().toString(36) + "-" + uid().slice(0, 5),
      name: `Demo · ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      createdAt: Date.now(),
      duration,
      width: take.width,
      height: take.height,
      hasAudio: !!take.hasAudio,
      source: { name: take.sourceName, kind: take.sourceKind },
      trim: { a: 0, b: duration },
      zooms: [],
      speeds: [],
      style: { bg: "nutaan", pad: 8, radius: 14, shadow: 45, aspect: "auto",
               bgFrom: "#a855f7", bgTo: "#ec4899", bgAngle: 135 },
      cursorStyle: { show: true, style: "arrow", halo: true, ring: true, size: 130, smooth: 60,
                     blur: 35, bounce: 40, hideIdle: false },
      frame: { style: "mac", title: true },
      camera: { show: true, size: 22, shape: "circle", pos: "br", mirror: true },
      path: take.cursorPath || [],
      markers: take.markers || [],
      zoomSens: 55,
      zoomScale: 180,
    };
  }

  // MediaRecorder's WebM has no duration in its header, so the element reports Infinity until it has
  // been forced to seek to the end. The measured elapsed time is the fallback.
  function probeDuration(v, fallback) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (d) => {
        if (settled) return;
        settled = true;
        resolve(isFinite(d) && d > 0 ? d : fallback);
      };
      const onMeta = () => {
        if (isFinite(v.duration) && v.duration > 0) return finish(v.duration);
        const onSeek = () => {
          v.removeEventListener("seeked", onSeek);
          const d = v.duration;
          try { v.currentTime = 0; } catch {}
          finish(d);
        };
        v.addEventListener("seeked", onSeek);
        try { v.currentTime = 1e6; } catch { finish(NaN); }
      };
      if (v.readyState >= 1) onMeta();
      else v.addEventListener("loadedmetadata", onMeta, { once: true });
      setTimeout(() => finish(NaN), 4000);
    });
  }

  async function openTake(take) {
    if (video.src) URL.revokeObjectURL(video.src);
    if (camVideo.src) URL.revokeObjectURL(camVideo.src);
    video.src = URL.createObjectURL(take.blob);
    probe.src = video.src;
    camVideo.src = take.camBlob ? URL.createObjectURL(take.camBlob) : "";
    video.load();

    const duration = await probeDuration(video, take.measured || 0);
    const doc = newDoc(take, Math.max(0.2, duration));
    doc.hasCamera = !!take.camBlob;

    if (take.cursorPath && take.cursorPath.length) {
      doc.zooms = detectZooms(doc, doc.zoomSens, doc.zoomScale / 100);
    }
    for (const m of doc.markers) addZoomAt(doc, m, true);

    S.doc = doc;
    S.smoothedFor = -1;
    S.sel = null;
    S.film = [];
    S.dirty = true;

    // Write the take out before anything else — it is the only irreplaceable part of a demo.
    const buf = await take.blob.arrayBuffer();
    const saved = await api().saveTake({ id: doc.id, data: buf, kind: "screen" });
    if (saved && saved.ok) doc.mediaPath = saved.path;
    if (take.camBlob) {
      const cbuf = await take.camBlob.arrayBuffer();
      const cs = await api().saveTake({ id: doc.id, data: cbuf, kind: "camera" });
      if (cs && cs.ok) doc.cameraPath = cs.path;
    }

    enterEditor();
    if (take.systemAudioFailed) {
      flashBadge("System audio isn't available on this OS — the take has microphone audio only.", 6000);
    } else if (take.autoZoomWanted && !doc.path.length) {
      // Better to say the pointer path is missing than to leave someone wondering where the zooms went.
      flashBadge("No pointer path came back, so there are no automatic zooms. Add them with + Zoom.", 7000);
    } else if (take.cursorTruncated) {
      flashBadge("The take ran past an hour — pointer tracking stopped at that point.", 6000);
    }
    await saveProject(true);
  }

  async function openSavedProject(id) {
    const res = await api().loadProject(id);
    if (!res || !res.ok) { alert("Could not open that demo: " + (res && res.error)); return; }
    if (!res.media) { alert("The video file for this demo is missing — it may have been deleted."); return; }
    if (video.src) URL.revokeObjectURL(video.src);
    if (camVideo.src) URL.revokeObjectURL(camVideo.src);
    video.src = URL.createObjectURL(new Blob([res.media], { type: "video/webm" }));
    probe.src = video.src;
    camVideo.src = res.camera ? URL.createObjectURL(new Blob([res.camera], { type: "video/webm" })) : "";
    video.load();
    await probeDuration(video, res.project.duration);
    S.doc = res.project;
    S.doc.hasCamera = !!res.camera;
    S.smoothedFor = -1;
    S.sel = null;
    S.film = [];
    S.dirty = false;
    enterEditor();
  }

  async function saveProject(silent) {
    if (!S.doc) return;
    const saveEl = el("stSaved");
    if (!S.doc.poster) S.doc.poster = await makePoster();
    const res = await api().saveProject(S.doc);
    if (res && res.ok) {
      S.dirty = false;
      if (saveEl) {
        saveEl.textContent = "Saved";
        setTimeout(() => { if (saveEl.textContent === "Saved") saveEl.textContent = ""; }, 2200);
      }
      if (!silent) loadLibrary();
    } else if (saveEl) {
      saveEl.textContent = "Save failed";
    }
  }

  async function makePoster() {
    try {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.round(320 / (S.doc.width / S.doc.height));
      const at = Math.min(S.doc.duration - 0.05, S.doc.trim.a + (S.doc.trim.b - S.doc.trim.a) * 0.25);
      await seekTo(probe, at);
      drawFrame(c.getContext("2d"), c.width, c.height, at, { src: probe, camera: false });
      return c.toDataURL("image/jpeg", 0.68);
    } catch { return ""; }
  }

  function seekTo(v, t) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.removeEventListener("seeked", fin); resolve(); };
      v.addEventListener("seeked", fin);
      try { v.currentTime = Math.max(0, t); } catch { fin(); }
      setTimeout(fin, 2500);
    });
  }

  // =====================================================================================
  // Cursor path + automatic zooms
  // =====================================================================================

  // A centred, triangle-weighted average: the pointer keeps its timing (a lagging filter would make
  // the cursor arrive after the thing it clicked) and loses the tremor and the sampling jitter.
  // Triangular rather than a flat box — measured against a synthetic path, a box window wide enough
  // to kill the jitter also cuts corners by ~7% of the screen, where this one stays inside 3%.
  function smoothPath(path, amount) {
    if (!path.length) return [];
    const win = Math.round((amount / 100) * 9);
    if (win <= 0) return path;
    const out = new Array(path.length);
    const last = path.length - 1;
    for (let i = 0; i < path.length; i++) {
      let sx = 0, sy = 0, wsum = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(last, i + win); j++) {
        const w = win + 1 - Math.abs(j - i);
        sx += path[j][1] * w;
        sy += path[j][2] * w;
        wsum += w;
      }
      out[i] = [path[i][0], sx / wsum, sy / wsum];
    }
    return out;
  }

  function pathFor(doc) {
    const amount = doc.cursorStyle.smooth;
    // Keyed on the path itself as well as the amount — otherwise opening a second demo at the same
    // smoothing setting would draw the first one's pointer.
    if (S.smoothedFor !== amount || S.smoothedPath !== doc.path || !S.smoothed) {
      S.smoothed = smoothPath(doc.path || [], amount);
      S.smoothedFor = amount;
      S.smoothedPath = doc.path;
    }
    return S.smoothed;
  }

  function cursorAt(doc, t) {
    const p = pathFor(doc);
    if (!p.length) return null;
    // Binary search, because this runs for every drawn frame.
    let lo = 0, hi = p.length - 1;
    if (t <= p[0][0]) return { x: p[0][1], y: p[0][2], idle: 0 };
    if (t >= p[hi][0]) return { x: p[hi][1], y: p[hi][2], idle: t - p[hi][0] };
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= t) lo = mid; else hi = mid;
    }
    const a = p[lo], b = p[hi];
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    const dist = Math.hypot(b[1] - a[1], b[2] - a[2]);
    return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, idle: dist < 0.0004 ? 0.2 : 0 };
  }

  // Where did the pointer stop? Without a global mouse hook that is the honest proxy for "the user
  // did something here", and in practice it lands on clicks, menu picks and typing.
  function findDwells(p, sens) {
    if (p.length < 20) return [];
    const holdMs = 700 - (sens / 100) * 440;      // 700ms at 0 → 260ms at 100
    const minTravel = 0.20 - (sens / 100) * 0.15; // how far it must have moved to count as a new spot
    const stillSpeed = 0.035;                     // normalised units per second

    const dwells = [];
    let stillFrom = -1, travel = 0, lastDwell = null;
    for (let i = 1; i < p.length; i++) {
      const dt = p[i][0] - p[i - 1][0];
      if (dt <= 0) continue;
      const d = Math.hypot(p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
      const speed = d / dt;
      if (speed > stillSpeed) {
        if (stillFrom >= 0) stillFrom = -1;
        travel += d;
        continue;
      }
      if (stillFrom < 0) stillFrom = i;
      const heldMs = (p[i][0] - p[stillFrom][0]) * 1000;
      if (heldMs >= holdMs && travel >= minTravel) {
        const at = p[stillFrom][0];
        if (!lastDwell || at - lastDwell.end > 0.35 ||
            Math.hypot(p[stillFrom][1] - lastDwell.x, p[stillFrom][2] - lastDwell.y) > 0.1) {
          lastDwell = { start: at, end: p[i][0], x: p[stillFrom][1], y: p[stillFrom][2] };
          dwells.push(lastDwell);
        } else {
          lastDwell.end = p[i][0];
        }
        travel = 0;
      }
    }
    return dwells;
  }

  // The moments the pointer came to rest, cached per path — the ring effect fires on these whether
  // or not the user kept the matching zoom.
  function settlesFor(doc) {
    if (S.settlesPath !== doc.path) {
      S.settles = findDwells(doc.path || [], 60).map((d) => d.start);
      S.settlesPath = doc.path;
    }
    return S.settles;
  }

  function detectZooms(doc, sens, scale) {
    const dwells = findDwells(doc.path || [], sens);
    const zooms = [];
    for (const d of dwells) {
      const a = Math.max(0, d.start - 0.45);
      const b = Math.min(doc.duration, Math.max(d.end + 0.7, a + 1.4));
      zooms.push({ id: uid(), a, b, scale, x: d.x, y: d.y, auto: true, follow: true });
    }
    // One zoom every couple of seconds is a demo; one every half second is a seizure.
    const cap = Math.max(1, Math.floor(doc.duration / 2.2));
    return normalizeZooms(zooms, doc.duration).slice(0, cap);
  }

  // Dwells never overlap, but the lead-in and the tail we wrap around them can. Two ramps fighting
  // over the same second reads as a stutter, so they are either merged (same spot) or made to
  // hand over cleanly (different spots).
  function normalizeZooms(list, duration) {
    const out = [];
    for (const z of list.slice().sort((m, n) => m.a - n.a)) {
      const prev = out[out.length - 1];
      if (prev && z.a <= prev.b + 0.35 && Math.hypot(prev.x - z.x, prev.y - z.y) < 0.14) {
        prev.b = Math.max(prev.b, z.b);
        continue;
      }
      if (prev && z.a < prev.b) {
        prev.b = Math.max(prev.a + 0.8, z.a - 0.05);
        if (z.a < prev.b) z.a = prev.b + 0.05;
      }
      z.b = Math.min(z.b, duration);
      if (z.b - z.a < 0.8) continue;
      out.push(z);
    }
    return out;
  }

  function addZoomAt(doc, t, fromMarker) {
    const c = cursorAt(doc, t);
    const a = clamp(t - (fromMarker ? 0.6 : 0.4), 0, doc.duration - 0.6);
    const b = clamp(a + (fromMarker ? 2.4 : 2.0), a + 0.6, doc.duration);
    const z = {
      id: uid(), a, b,
      scale: doc.zoomScale / 100,
      x: c ? c.x : 0.5, y: c ? c.y : 0.5,
      auto: false, follow: !!c,
    };
    doc.zooms.push(z);
    doc.zooms.sort((m, n) => m.a - n.a);
    return z;
  }

  // The zoom actually applied at a moment, with the ramps in and out already eased.
  function zoomAt(doc, t) {
    let best = null;
    for (const z of doc.zooms) {
      if (t < z.a || t > z.b) continue;
      if (!best || (z.auto ? 0 : 1) >= (best.auto ? 0 : 1)) best = z;
    }
    if (!best) return { z: 1, x: 0.5, y: 0.5 };
    const len = best.b - best.a;
    const ramp = Math.min(0.5, len / 3);
    let p = 1;
    if (t - best.a < ramp) p = (t - best.a) / ramp;
    else if (best.b - t < ramp) p = (best.b - t) / ramp;
    p = easeInOut(clamp(p, 0, 1));
    let fx = best.x, fy = best.y;
    if (best.follow) {
      const c = cursorAt(doc, t);
      if (c) { fx = c.x; fy = c.y; }
    }
    return { z: 1 + (best.scale - 1) * p, x: fx, y: fy, block: best };
  }

  function speedAt(doc, t) {
    for (const s of doc.speeds) if (t >= s.a && t < s.b) return s.rate;
    return 1;
  }

  // =====================================================================================
  // Compositor — one function, used by the preview and by the export
  // =====================================================================================

  // Soft round blob, the building block of every painted scene.
  function blob(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace("ALPHA", String(alpha)));
    g.addColorStop(1, color.replace("ALPHA", "0"));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function paintScene(ctx, W, H, id) {
    const band = (stops) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      for (const [at, c] of stops) g.addColorStop(at, c);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    if (id === "sky") {
      band([[0, "#0ea5e9"], [0.45, "#7dd3fc"], [0.78, "#dbeafe"], [1, "#fef3c7"]]);
      blob(ctx, W * 0.78, H * 0.18, Math.max(W, H) * 0.3, "rgba(255,255,255,ALPHA)", 0.55);
      blob(ctx, W * 0.22, H * 0.3, Math.max(W, H) * 0.26, "rgba(255,255,255,ALPHA)", 0.3);
      blob(ctx, W * 0.55, H * 0.62, Math.max(W, H) * 0.34, "rgba(255,255,255,ALPHA)", 0.22);
      return;
    }
    if (id === "sunset") {
      band([[0, "#312e81"], [0.38, "#a21caf"], [0.72, "#f43f5e"], [1, "#fb923c"]]);
      blob(ctx, W * 0.5, H * 0.74, Math.max(W, H) * 0.3, "rgba(255,214,150,ALPHA)", 0.75);
      blob(ctx, W * 0.16, H * 0.2, Math.max(W, H) * 0.28, "rgba(56,189,248,ALPHA)", 0.28);
      return;
    }
    if (id === "aurora") {
      band([[0, "#020617"], [0.55, "#0b1220"], [1, "#020617"]]);
      blob(ctx, W * 0.3, H * 0.32, Math.max(W, H) * 0.42, "rgba(45,212,191,ALPHA)", 0.45);
      blob(ctx, W * 0.68, H * 0.24, Math.max(W, H) * 0.38, "rgba(129,140,248,ALPHA)", 0.42);
      blob(ctx, W * 0.5, H * 0.8, Math.max(W, H) * 0.44, "rgba(168,85,247,ALPHA)", 0.3);
      return;
    }
    // mesh
    band([[0, "#0b0c10"], [1, "#12131b"]]);
    blob(ctx, W * 0.2, H * 0.22, Math.max(W, H) * 0.45, "rgba(168,85,247,ALPHA)", 0.75);
    blob(ctx, W * 0.82, H * 0.26, Math.max(W, H) * 0.4, "rgba(14,165,233,ALPHA)", 0.6);
    blob(ctx, W * 0.66, H * 0.84, Math.max(W, H) * 0.44, "rgba(236,72,153,ALPHA)", 0.65);
    blob(ctx, W * 0.14, H * 0.86, Math.max(W, H) * 0.36, "rgba(34,197,94,ALPHA)", 0.28);
  }

  function paintBackdrop(ctx, W, H, b) {
    if (b.kind === "none") { ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); return; }
    if (b.kind === "solid") { ctx.fillStyle = b.color; ctx.fillRect(0, 0, W, H); return; }
    if (b.kind === "scene") { paintScene(ctx, W, H, b.id); return; }
    const rad = (b.angle * Math.PI) / 180;
    const cx = W / 2, cy = H / 2;
    const len = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad));
    const g = ctx.createLinearGradient(
      cx - (Math.sin(rad) * len) / 2, cy + (Math.cos(rad) * len) / 2,
      cx + (Math.sin(rad) * len) / 2, cy - (Math.cos(rad) * len) / 2
    );
    g.addColorStop(0, b.stops[0]);
    g.addColorStop(1, b.stops[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // The capture comes back with no system pointer in it — Chromium leaves the cursor out of a
  // desktop stream — so every pointer you see in a demo is drawn here, from the recorded path.
  // That is also why it can be restyled, resized and smoothed long after the take was made.
  //
  // Each cursor is drawn inside a 24×24 box with the hotspot at (0,0), so switching style never
  // moves the pointer. `click` is 0→1 over the moment the pointer settles, which is what makes the
  // burst rays fire and the glyph dip.
  const CURSOR_STYLES = [
    { id: "arrow", label: "Arrow" },
    { id: "arrowDark", label: "Arrow, dark" },
    { id: "arrowOutline", label: "Arrow, outline" },
    { id: "triangle", label: "Triangle" },
    { id: "triangleOutline", label: "Triangle, outline" },
    { id: "hand", label: "Pointing hand" },
    { id: "ibeam", label: "Text I-beam" },
    { id: "dot", label: "Dot" },
    { id: "move", label: "Move" },
    { id: "resizeH", label: "Resize ↔" },
    { id: "resizeV", label: "Resize ↕" },
    { id: "resizeDiag", label: "Resize ⤡" },
    { id: "hourglass", label: "Busy" },
    { id: "spinner", label: "Loading" },
  ];
  const CURSOR_IDS = CURSOR_STYLES.map((c) => c.id);

  function arrowPath(ctx, rounded) {
    ctx.beginPath();
    if (rounded) {
      // The friendlier, thick-stroked arrow — the one most demo tools ship with.
      ctx.moveTo(0.8, 0.8);
      ctx.lineTo(1.2, 17.6);
      ctx.quadraticCurveTo(1.3, 18.8, 2.4, 18.1);
      ctx.lineTo(5.6, 14.3);
      ctx.lineTo(8.3, 20.2);
      ctx.quadraticCurveTo(8.8, 21.1, 9.8, 20.6);
      ctx.lineTo(11.6, 19.7);
      ctx.quadraticCurveTo(12.5, 19.2, 12.1, 18.2);
      ctx.lineTo(9.3, 12.5);
      ctx.lineTo(14.2, 12.2);
      ctx.quadraticCurveTo(15.5, 12.1, 14.7, 11.1);
      ctx.closePath();
      return;
    }
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17.2);
    ctx.lineTo(4.3, 13.4);
    ctx.lineTo(7.1, 19.6);
    ctx.lineTo(10.2, 18.1);
    ctx.lineTo(7.4, 12.1);
    ctx.lineTo(12.6, 11.7);
    ctx.closePath();
  }

  function trianglePath(ctx) {
    // A clean triangular pointer: hotspot at the tip, swept back to a single tail.
    ctx.beginPath();
    ctx.moveTo(0.6, 0.6);
    ctx.lineTo(16.4, 13.6);
    ctx.quadraticCurveTo(17.3, 14.4, 16.1, 14.8);
    ctx.lineTo(9.6, 16.3);
    ctx.lineTo(6.2, 21.6);
    ctx.quadraticCurveTo(5.5, 22.6, 4.8, 21.5);
    ctx.closePath();
  }

  function handPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(8.4, 2.2);
    ctx.bezierCurveTo(9.6, 2.2, 10.4, 3.1, 10.4, 4.3);
    ctx.lineTo(10.4, 10.6);
    ctx.lineTo(11.6, 10.6);
    ctx.bezierCurveTo(12.6, 10.6, 13.4, 11.3, 13.4, 12.3);
    ctx.lineTo(13.4, 12.6);
    ctx.lineTo(15.2, 12.9);
    ctx.bezierCurveTo(17.1, 13.2, 18.4, 14.8, 18.4, 16.7);
    ctx.lineTo(18.4, 19.4);
    ctx.bezierCurveTo(18.4, 21.8, 16.5, 23.6, 14.2, 23.6);
    ctx.lineTo(10.6, 23.6);
    ctx.bezierCurveTo(8.2, 23.6, 6.4, 21.8, 6.4, 19.4);
    ctx.lineTo(6.4, 4.3);
    ctx.bezierCurveTo(6.4, 3.1, 7.2, 2.2, 8.4, 2.2);
    ctx.closePath();
  }

  // A double-headed arrow along an axis, centred on the hotspot — the resize family.
  function axisArrow(ctx, dx, dy, len, head) {
    const ex = dx * len, ey = dy * len;
    ctx.beginPath();
    ctx.moveTo(-ex, -ey);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    for (const s of [1, -1]) {
      const tipX = ex * s, tipY = ey * s;
      const px = -dy * head * 0.62, py = dx * head * 0.62;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - dx * head * s + px, tipY - dy * head * s + py);
      ctx.lineTo(tipX - dx * head * s - px, tipY - dy * head * s - py);
      ctx.closePath();
      ctx.fill();
    }
  }

  // The little burst of rays that fires on a click — the detail that makes a demo read as a demo.
  function drawBurst(ctx, click) {
    if (click <= 0.01) return;
    const grow = 3.5 + click * 5.5;
    const fade = 1 - click;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, fade);
    ctx.lineCap = "round";
    ctx.lineWidth = 1.9;
    ctx.strokeStyle = "#fff";
    for (const a of [-1.9, -1.25, -0.6]) {
      const x0 = Math.cos(a) * (3.2 + click * 2);
      const y0 = Math.sin(a) * (3.2 + click * 2);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(Math.cos(a) * grow, Math.sin(a) * grow);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCursorGlyph(ctx, x, y, size, alpha, style, squash, click) {
    const st = CURSOR_IDS.includes(style) ? style : "arrow";
    const dark = st === "arrowDark";
    const outline = st === "arrowOutline" || st === "triangleOutline";
    const fill = dark ? "#16181f" : "#fff";
    const stroke = dark ? "rgba(255,255,255,0.92)" : "rgba(15,17,23,0.88)";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    const k = size / 24;
    ctx.scale(k * (squash ? squash.x : 1), k * (squash ? squash.y : 1));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 4.5;
    ctx.shadowOffsetY = 1.4;

    const strokeAndFill = (lw) => {
      ctx.lineWidth = lw == null ? 1.5 : lw;
      if (outline) {
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2.1;
        ctx.stroke();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = "rgba(15,17,23,0.55)";
        ctx.stroke();
      } else {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };

    if (st === "arrow" || st === "arrowDark" || st === "arrowOutline") {
      arrowPath(ctx, st !== "arrowOutline");
      strokeAndFill(1.5);
    } else if (st === "triangle" || st === "triangleOutline") {
      trianglePath(ctx);
      strokeAndFill(1.5);
    } else if (st === "hand") {
      handPath(ctx);
      strokeAndFill(1.4);
    } else if (st === "ibeam") {
      ctx.translate(7, 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 18);
      ctx.moveTo(-3.4, 0); ctx.lineTo(3.4, 0);
      ctx.moveTo(-3.4, 18); ctx.lineTo(3.4, 18);
      ctx.stroke();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(15,17,23,0.7)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    } else if (st === "dot") {
      ctx.translate(8, 8);
      ctx.beginPath();
      ctx.arc(0, 0, 7.2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(15,17,23,0.75)";
      ctx.stroke();
    } else if (st === "move" || st === "resizeH" || st === "resizeV" || st === "resizeDiag") {
      ctx.translate(9, 9);
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 2.2;
      const axes = st === "move"
        ? [[1, 0], [0, 1]]
        : st === "resizeH" ? [[1, 0]]
        : st === "resizeV" ? [[0, 1]]
        : [[0.7071, 0.7071]];
      for (const [dx, dy] of axes) axisArrow(ctx, dx, dy, 8.4, 3.6);
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "rgba(15,17,23,0.55)";
      ctx.lineWidth = 0.8;
      for (const [dx, dy] of axes) axisArrow(ctx, dx, dy, 8.4, 3.6);
    } else if (st === "hourglass") {
      ctx.translate(6, 2);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(12, 0);
      ctx.lineTo(7.4, 9); ctx.lineTo(12, 18); ctx.lineTo(0, 18);
      ctx.lineTo(4.6, 9); ctx.closePath();
      strokeAndFill(1.6);
    } else if (st === "spinner") {
      ctx.translate(9, 9);
      const spokes = 8;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        ctx.globalAlpha = alpha * (0.25 + 0.75 * (i / spokes));
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 3.4, Math.sin(a) * 3.4);
        ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
    }

    if (click > 0.01) drawBurst(ctx, click);
    ctx.restore();
  }

  // How fast the pointer is moving at t, in normalised units per second — drives the motion blur.
  function pointerSpeed(doc, t) {
    const a = cursorAt(doc, t - 0.05);
    const b = cursorAt(doc, t);
    if (!a || !b) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.05;
  }

  const BAR_FRAC = 0.052; // title-bar height as a fraction of the video's own height

  // The fitted block is the video plus, when a window frame is on, the title bar above it — so the
  // frame never pushes the picture out of the padding.
  function contentRect(doc, W, H, vw, vh) {
    const pad = (doc.style.pad / 100) * Math.min(W, H);
    const aw = Math.max(10, W - pad * 2);
    const ah = Math.max(10, H - pad * 2);
    const framed = (doc.frame && doc.frame.style) && doc.frame.style !== "none";
    const grow = framed ? 1 + BAR_FRAC : 1;
    const ar = vw / (vh * grow);
    let w = aw, h = aw / ar;
    if (h > ah) { h = ah; w = ah * ar; }
    const bar = framed ? h * (BAR_FRAC / grow) : 0;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, bar };
  }

  // macOS-style chrome: a title bar with the three lights, and the picture below it.
  function drawWindowChrome(ctx, rect, radius, style, title) {
    const bar = rect.bar;
    const light = style === "macLight";
    ctx.save();
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.clip();
    const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + bar);
    g.addColorStop(0, light ? "#fbfbfd" : "#2b2d36");
    g.addColorStop(1, light ? "#eceef2" : "#23252d");
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, bar);
    ctx.fillStyle = light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.09)";
    ctx.fillRect(rect.x, rect.y + bar - Math.max(1, bar * 0.03), rect.w, Math.max(1, bar * 0.03));
    const r = bar * 0.2;
    const cy = rect.y + bar / 2;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(rect.x + bar * 0.62 + i * bar * 0.56, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
    if (title) {
      ctx.font = `600 ${Math.round(bar * 0.38)}px "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.fillStyle = light ? "rgba(30,33,41,0.72)" : "rgba(232,233,237,0.72)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title, rect.x + rect.w / 2, cy + bar * 0.02);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
  }

  function drawFrame(ctx, W, H, t, opts) {
    const doc = S.doc;
    if (!doc) return;
    const src = (opts && opts.src) || video;
    const vw = src.videoWidth || doc.width;
    const vh = src.videoHeight || doc.height;
    const style = doc.style;
    const b = backdropOf(doc);

    paintBackdrop(ctx, W, H, b);

    const rect = contentRect(doc, W, H, vw, vh);
    const radius = (style.radius / 100) * Math.min(rect.w, rect.h) * 0.5;

    if (style.shadow > 0 && b.kind !== "none") {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.16 + (style.shadow / 100) * 0.5})`;
      ctx.shadowBlur = (style.shadow / 100) * Math.min(W, H) * 0.14;
      ctx.shadowOffsetY = (style.shadow / 100) * Math.min(W, H) * 0.035;
      ctx.fillStyle = "#000";
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
      ctx.fill();
      ctx.restore();
    }

    const framed = !!rect.bar;
    if (framed) drawWindowChrome(ctx, rect, radius, doc.frame.style, doc.frame.title ? (doc.name || "") : "");

    // The picture sits under the title bar when a frame is on, and fills the whole block otherwise.
    const vidY = rect.y + rect.bar;
    const vidH = rect.h - rect.bar;
    const zi = zoomAt(doc, t);
    const dw = rect.w * zi.z;
    const dh = vidH * zi.z;
    let dx = rect.x + rect.w / 2 - zi.x * dw;
    let dy = vidY + vidH / 2 - zi.y * dh;
    dx = clamp(dx, rect.x + rect.w - dw, rect.x);
    dy = clamp(dy, vidY + vidH - dh, vidY);

    ctx.save();
    if (framed) {
      // Square at the top (it meets the title bar), rounded at the bottom like a real window.
      const r = Math.min(radius, vidH / 2, rect.w / 2);
      ctx.beginPath();
      ctx.moveTo(rect.x, vidY);
      ctx.lineTo(rect.x + rect.w, vidY);
      ctx.lineTo(rect.x + rect.w, vidY + vidH - r);
      ctx.arcTo(rect.x + rect.w, vidY + vidH, rect.x + rect.w - r, vidY + vidH, r);
      ctx.lineTo(rect.x + r, vidY + vidH);
      ctx.arcTo(rect.x, vidY + vidH, rect.x, vidY + vidH - r, r);
      ctx.closePath();
    } else {
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    }
    ctx.clip();
    try {
      if (src.readyState >= 2) ctx.drawImage(src, dx, dy, dw, dh);
      else { ctx.fillStyle = "#0b0c10"; ctx.fillRect(rect.x, vidY, rect.w, vidH); }
    } catch {}

    // Pointer effects. Chromium leaves the system cursor out of a desktop capture, so this is the
    // only pointer in the picture: drawn from the recorded path, smoothed, and free to be restyled
    // long after the take was made.
    const cs = doc.cursorStyle;
    const wantHalo = cs.halo !== false;
    if ((cs.show !== false || wantHalo || cs.ring) && doc.path && doc.path.length) {
      const c = cursorAt(doc, t);
      if (c) {
        const cx = dx + c.x * dw;
        const cy = dy + c.y * dh;
        // Constant presence on screen: the effect must not shrink just because the frame zoomed in.
        const size = 30 * (H / 1080) * (cs.size / 100) * (1 + (zi.z - 1) * 0.22);
        let alpha = 1;
        if (cs.hideIdle && c.idle > 1.4) alpha = clamp(1 - (c.idle - 1.4) / 1.2, 0, 1);
        if (alpha > 0.01) {
          if (wantHalo) {
            const r = size * 1.75;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, `rgba(233,213,255,${0.4 * alpha})`);
            g.addColorStop(0.45, `rgba(192,132,252,${0.24 * alpha})`);
            g.addColorStop(1, "rgba(168,85,247,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
          if (cs.ring) {
            // Every place the pointer came to rest gets one expanding ring — the exact moment a
            // viewer's eye should move, whether or not a zoom was placed there.
            for (const st of settlesFor(doc)) {
              if (t < st || t - st > 0.75) continue;
              const age = clamp((t - st) / 0.75, 0, 1);
              const r = size * (0.7 + age * 2.1);
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(168,85,247,${0.2 * (1 - age) * alpha})`;
              ctx.fill();
              ctx.lineWidth = Math.max(1, size * 0.1 * (1 - age * 0.6));
              ctx.strokeStyle = `rgba(233,213,255,${0.62 * (1 - age) * alpha})`;
              ctx.stroke();
              break;
            }
          }
          if (cs.show !== false) {
            // Motion blur: a short trail of fading copies along the path the pointer just took.
            const blur = (cs.blur || 0) / 100;
            if (blur > 0.02) {
              const sp = pointerSpeed(doc, t);
              const strength = clamp((sp - 0.25) / 1.6, 0, 1) * blur;
              if (strength > 0.02) {
                for (let k = 3; k >= 1; k--) {
                  const g = cursorAt(doc, t - k * 0.022 * (0.6 + blur));
                  if (!g) continue;
                  drawCursorGlyph(ctx, dx + g.x * dw, dy + g.y * dh, size,
                    alpha * strength * (0.26 - k * 0.055), cs.style, null, 0);
                }
              }
            }
            // Where the pointer came to rest, the glyph dips and a burst of rays fires — the same
            // phase value drives both, so they land together.
            let squash = null;
            let click = 0;
            for (const st of settlesFor(doc)) {
              const age = t - st;
              if (age < 0 || age > 0.42) continue;
              click = age / 0.42;
              const bounce = (cs.bounce || 0) / 100;
              if (bounce > 0.02) {
                const k = Math.sin(click * Math.PI) * (1 - click) * bounce * 0.55;
                squash = { x: 1 - k, y: 1 - k };
              }
              break;
            }
            drawCursorGlyph(ctx, cx, cy, size, alpha, cs.style, squash, cs.burst === false ? 0 : click);
          }
        }
      }
    }
    ctx.restore();

    if (doc.hasCamera && doc.camera.show && (!opts || opts.camera !== false) && camVideo.readyState >= 2) {
      const cam = doc.camera;
      const d = (cam.size / 100) * Math.min(rect.w, rect.h);
      const m = Math.min(W, H) * 0.035;
      const cx = cam.pos.includes("l") ? rect.x + m : rect.x + rect.w - d - m;
      const cy = cam.pos.startsWith("t") ? rect.y + rect.bar + m : rect.y + rect.h - d - m;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = d * 0.18;
      ctx.shadowOffsetY = d * 0.05;
      if (cam.shape === "circle") { ctx.beginPath(); ctx.arc(cx + d / 2, cy + d / 2, d / 2, 0, Math.PI * 2); }
      else roundRect(ctx, cx, cy, d, d, d * 0.18);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      const cvw = camVideo.videoWidth || 1280;
      const cvh = camVideo.videoHeight || 720;
      const s = Math.max(d / cvw, d / cvh);
      const w = cvw * s, h = cvh * s;
      if (cam.mirror) { ctx.translate(cx + d / 2, 0); ctx.scale(-1, 1); ctx.translate(-(cx + d / 2), 0); }
      try { ctx.drawImage(camVideo, cx + (d - w) / 2, cy + (d - h) / 2, w, h); } catch {}
      ctx.restore();
      ctx.save();
      if (cam.shape === "circle") { ctx.beginPath(); ctx.arc(cx + d / 2, cy + d / 2, d / 2, 0, Math.PI * 2); }
      else roundRect(ctx, cx, cy, d, d, d * 0.18);
      ctx.lineWidth = Math.max(1.5, d * 0.012);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();
      ctx.restore();
    }
  }

  function outputSize(doc, maxW) {
    const ar = ASPECTS[doc.style.aspect] || doc.width / doc.height;
    let W = Math.min(maxW, doc.width);
    let H = Math.round(W / ar);
    if (H % 2) H += 1;
    if (W % 2) W += 1;
    return { W, H };
  }

  // =====================================================================================
  // Editor shell
  // =====================================================================================

  function enterEditor() {
    S.view = "editor";
    el("studioCapture").hidden = true;
    el("studioEditor").hidden = false;
    el("stName").value = S.doc.name;
    syncControls();
    layoutCanvas();
    buildFilmstrip();
    seekPreview(S.doc.trim.a);
    renderTimeline();
    S.needsDraw = true;
    startLoop();
  }

  function leaveEditor() {
    pausePreview();
    S.view = "capture";
    el("studioEditor").hidden = true;
    el("studioCapture").hidden = false;
    loadLibrary();
    loadSources();
  }

  function layoutCanvas() {
    const canvas = el("stCanvas");
    const stage = el("stStage");
    if (!canvas || !S.doc) return;
    const { W, H } = outputSize(S.doc, 1280);
    canvas.width = W;
    canvas.height = H;
    const avail = { w: stage.clientWidth - 20, h: stage.clientHeight - 20 };
    // No 1× cap: the preview canvas is 1280 wide, and on a big stage the picture should fill it
    // rather than sit in the middle of an empty room.
    const s = Math.max(0.05, Math.min(avail.w / W, avail.h / H));
    canvas.style.width = Math.round(W * s) + "px";
    canvas.style.height = Math.round(H * s) + "px";
    S.needsDraw = true;
  }

  function flashBadge(text, ms) {
    const b = el("stStageBadge");
    if (!b) return;
    b.textContent = text;
    b.hidden = false;
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.hidden = true; }, ms || 3000);
  }

  function syncControls() {
    const d = S.doc;
    if (!d) return;
    const swatches = el("stBgPresets");
    swatches.innerHTML = "";
    const custom = { id: "custom", kind: "gradient", angle: d.style.bgAngle == null ? 135 : d.style.bgAngle,
      stops: [d.style.bgFrom || "#a855f7", d.style.bgTo || "#ec4899"] };
    for (const b of BACKDROPS.concat([custom])) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "st-swatch" + (b.id === d.style.bg ? " active" : "");
      sw.style.background = backdropCss(b);
      sw.title = b.id === "custom" ? "Your own gradient" : b.id;
      if (b.kind === "none") sw.innerHTML = `<span class="x">∅</span>`;
      sw.addEventListener("click", () => { d.style.bg = b.id; touch(); syncControls(); });
      swatches.appendChild(sw);
    }
    el("stBgFrom").value = d.style.bgFrom || "#a855f7";
    el("stBgTo").value = d.style.bgTo || "#ec4899";
    el("stBgAngle").value = String(d.style.bgAngle == null ? 135 : d.style.bgAngle);
    setRange("stPad", d.style.pad, "stPadVal", (v) => v + "%");
    setRange("stRadius", d.style.radius, "stRadiusVal", (v) => v);
    setRange("stShadow", d.style.shadow, "stShadowVal", (v) => v);
    segActive("stAspect", "ar", d.style.aspect);

    const cs = d.cursorStyle;
    el("stCurShow").checked = cs.show !== false;
    el("stCurHalo").checked = cs.halo !== false;
    setRange("stCurSize", cs.size, "stCurSizeVal", (v) => (v / 100).toFixed(1) + "×");
    setRange("stCurSmooth", cs.smooth, "stCurSmoothVal", (v) => v);
    setRange("stCurBlur", cs.blur == null ? 35 : cs.blur, "stCurBlurVal", (v) => v);
    setRange("stCurBounce", cs.bounce == null ? 40 : cs.bounce, "stCurBounceVal", (v) => v);
    el("stCurRing").checked = cs.ring !== false;
    el("stCurBurst").checked = cs.burst !== false;
    el("stCurHideIdle").checked = !!cs.hideIdle;
    renderCursorStyles();

    const fr = d.frame || (d.frame = { style: "none", title: true });
    segActive("stFrameStyle", "frame", fr.style || "none");
    el("stFrameTitle").checked = fr.title !== false;
    el("stCursorNote").textContent = d.path && d.path.length
      ? `${d.path.length.toLocaleString()} pointer samples recorded with this take.`
      : "No pointer path was recorded — auto-zoom was off, or a single window was captured.";

    setRange("stZoomSens", d.zoomSens, "stZoomSensVal", (v) => v);
    setRange("stZoomScale", d.zoomScale, "stZoomScaleVal", (v) => (v / 100).toFixed(1) + "×");

    const hasCam = !!d.hasCamera;
    el("stCamNote").hidden = hasCam;
    el("stCamControls").hidden = !hasCam;
    if (hasCam) {
      el("stCamShow").checked = d.camera.show;
      setRange("stCamSize", d.camera.size, "stCamSizeVal", (v) => v + "%");
      segActive("stCamShape", "shape", d.camera.shape);
      segActive("stCamPos", "pos", d.camera.pos);
      el("stCamMirror").checked = d.camera.mirror;
    }

    const { W, H } = outputSize(d, 1920);
    el("stMeta").textContent = `${W}×${H} · ${fmtTime(d.duration, true)}`;
    el("stTimeTotal").textContent = fmtTime(d.trim.b - d.trim.a, true);
    renderSelected();
  }

  // Little canvas previews of each pointer, drawn with the very same code that draws them into the
  // demo — so what you pick is what you get.
  function renderCursorStyles() {
    const box = el("stCurStyles");
    if (!box) return;
    const cur = S.doc.cursorStyle.style || "arrow";
    box.innerHTML = "";
    for (const def of CURSOR_STYLES) {
      const st = def.id;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "st-cursor-opt" + (st === cur ? " active" : "");
      b.title = def.label;
      const c = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      c.width = 40 * dpr;
      c.height = 40 * dpr;
      c.style.width = "40px";
      c.style.height = "40px";
      const ctx = c.getContext("2d");
      ctx.scale(dpr, dpr);
      drawCursorGlyph(ctx, 11, 8, 25, 1, st, null, 0);
      b.appendChild(c);
      b.addEventListener("click", () => {
        S.doc.cursorStyle.style = st;
        S.doc.cursorStyle.show = true;
        el("stCurShow").checked = true;
        touch();
        renderCursorStyles();
      });
      box.appendChild(b);
    }
  }

  function setRange(id, value, valId, fmt) {
    const r = el(id);
    if (!r) return;
    r.value = String(value);
    if (valId) el(valId).textContent = fmt ? fmt(value) : value;
  }
  function segActive(id, attr, value) {
    const box = el(id);
    if (!box) return;
    for (const b of box.querySelectorAll("button")) b.classList.toggle("active", b.dataset[attr] === String(value));
  }

  function touch() {
    S.dirty = true;
    S.needsDraw = true;
    const s = el("stSaved");
    if (s) s.textContent = "Unsaved";
  }

  // ---------- Preview playback ----------
  function startLoop() {
    if (S.rafId) return;
    const loop = () => {
      S.rafId = requestAnimationFrame(loop);
      if (S.view !== "editor" || !S.doc) return;
      const d = S.doc;
      if (S.playing) {
        const t = video.currentTime;
        if (t >= d.trim.b - 0.02) {
          pausePreview();
          seekPreview(d.trim.a);
        } else {
          const rate = speedAt(d, t);
          if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
          if (d.hasCamera && camVideo.readyState >= 2 && Math.abs(camVideo.currentTime - t) > 0.15) {
            try { camVideo.currentTime = t; } catch {}
          }
        }
        S.needsDraw = true;
      }
      if (S.needsDraw) {
        S.needsDraw = S.playing;
        const c = el("stCanvas");
        if (c) drawFrame(c.getContext("2d"), c.width, c.height, video.currentTime);
        updatePlayhead();
      }
    };
    S.rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (S.rafId) cancelAnimationFrame(S.rafId);
    S.rafId = 0;
  }

  function playPreview() {
    if (!S.doc) return;
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    if (video.currentTime < S.doc.trim.a || video.currentTime >= S.doc.trim.b - 0.02) {
      video.currentTime = S.doc.trim.a;
    }
    video.play().catch(() => {});
    if (S.doc.hasCamera) camVideo.play().catch(() => {});
    S.playing = true;
    playIcon(true);
  }
  function pausePreview() {
    try { video.pause(); } catch {}
    try { camVideo.pause(); } catch {}
    S.playing = false;
    playIcon(false);
    S.needsDraw = true;
  }
  function playIcon(playing) {
    const i = el("stPlayIcon");
    if (!i) return;
    i.innerHTML = playing
      ? '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/>'
      : '<path d="M8 5.5v13l11-6.5z"/>';
  }
  function seekPreview(t) {
    if (!S.doc) return;
    const v = clamp(t, 0, S.doc.duration);
    try { video.currentTime = v; } catch {}
    if (S.doc.hasCamera) { try { camVideo.currentTime = v; } catch {} }
    S.needsDraw = true;
    el("stTimeNow").textContent = fmtTime(v, true);
  }

  // =====================================================================================
  // Timeline
  // =====================================================================================

  function tlWidth() {
    const tl = el("stTimeline");
    return Math.max(50, tl.clientWidth - 28);
  }
  const tToX = (t) => (t / S.doc.duration) * tlWidth();
  const xToT = (x) => clamp((x / tlWidth()) * S.doc.duration, 0, S.doc.duration);

  function renderTimeline() {
    if (!S.doc) return;
    renderRuler();
    renderBlocks();
    renderTrims();
    updatePlayhead();
  }

  function renderRuler() {
    const r = el("stRuler");
    const d = S.doc;
    r.innerHTML = "";
    const w = tlWidth();
    const targets = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = targets.find((s) => (s / d.duration) * w > 62) || 600;
    for (let t = 0; t <= d.duration + 0.001; t += step) {
      const tick = document.createElement("div");
      tick.className = "st-tick";
      tick.style.left = tToX(t) + "px";
      tick.innerHTML = `<span>${fmtTime(t)}</span>`;
      r.appendChild(tick);
    }
  }

  function renderTrims() {
    const d = S.doc;
    const a = el("stTrimA");
    const b = el("stTrimB");
    a.style.left = "0px";
    a.style.width = Math.max(0, tToX(d.trim.a)) + "px";
    b.style.left = tToX(d.trim.b) + "px";
    b.style.width = Math.max(0, tlWidth() - tToX(d.trim.b)) + "px";
    el("stTimeTotal").textContent = fmtTime(d.trim.b - d.trim.a, true);
    const flag = el("stEndFlag");
    if (flag) {
      const x = tToX(d.trim.b);
      flag.style.left = 14 + x + "px";
      flag.classList.toggle("near-right", x > tlWidth() - 54);
      flag.querySelector("span").textContent = "END " + fmtTime(d.trim.b);
    }
  }

  function renderBlocks() {
    const d = S.doc;
    for (const [track, list, kind] of [[el("stZoomTrack"), d.zooms, "zoom"], [el("stSpeedTrack"), d.speeds, "speed"]]) {
      for (const old of Array.from(track.querySelectorAll(".st-block"))) old.remove();
      for (const b of list) {
        const node = document.createElement("div");
        node.className = `st-block ${kind}` + (b.auto ? " auto" : "") +
          (S.sel && S.sel.kind === kind && S.sel.id === b.id ? " sel" : "");
        node.style.left = tToX(b.a) + "px";
        node.style.width = Math.max(6, tToX(b.b) - tToX(b.a)) + "px";
        node.textContent = kind === "zoom" ? `${b.scale.toFixed(1)}×` : `${b.rate}×`;
        node.dataset.id = b.id;
        node.dataset.kind = kind;
        node.innerHTML += `<span class="st-grip a"></span><span class="st-grip b"></span>`;
        track.appendChild(node);
      }
    }
  }

  function updatePlayhead() {
    if (!S.doc) return;
    const ph = el("stPlayhead");
    if (!ph) return;
    ph.style.left = 14 + tToX(clamp(video.currentTime, 0, S.doc.duration)) + "px";
    el("stTimeNow").textContent = fmtTime(video.currentTime, true);
  }

  function renderSelected() {
    const box = el("stZoomSelected");
    if (!box) return;
    const d = S.doc;
    const sel = S.sel;
    const z = sel && sel.kind === "zoom" ? d.zooms.find((x) => x.id === sel.id) : null;
    const sp = sel && sel.kind === "speed" ? d.speeds.find((x) => x.id === sel.id) : null;

    if (z) {
      box.innerHTML =
        `<div class="st-sel-row">Starts <b>${fmtTime(z.a, true)}</b></div>` +
        `<div class="st-sel-row">Ends <b>${fmtTime(z.b, true)}</b></div>` +
        `<label class="st-slider"><span>Zoom<b id="stSelScaleVal">${z.scale.toFixed(2)}×</b></span>
           <input type="range" id="stSelScale" min="110" max="400" value="${Math.round(z.scale * 100)}" /></label>` +
        `<label class="st-switch"><input type="checkbox" id="stSelFollow" ${z.follow ? "checked" : ""} />
           <span class="st-track"><span class="st-knob"></span></span><span class="st-switch-label">Follow the pointer</span></label>` +
        (z.follow ? "" :
          `<label class="st-slider"><span>Focus X<b>${Math.round(z.x * 100)}%</b></span>
             <input type="range" id="stSelX" min="0" max="100" value="${Math.round(z.x * 100)}" /></label>
           <label class="st-slider"><span>Focus Y<b>${Math.round(z.y * 100)}%</b></span>
             <input type="range" id="stSelY" min="0" max="100" value="${Math.round(z.y * 100)}" /></label>`) +
        `<button class="st-danger" id="stSelDelete" type="button">Delete this zoom</button>`;
      el("stSelScale").addEventListener("input", (e) => {
        z.scale = Number(e.target.value) / 100;
        z.auto = false;
        el("stSelScaleVal").textContent = z.scale.toFixed(2) + "×";
        touch();
        renderBlocks();
      });
      el("stSelFollow").addEventListener("change", (e) => { z.follow = e.target.checked; touch(); renderSelected(); });
      const sx = el("stSelX"), sy = el("stSelY");
      if (sx) sx.addEventListener("input", (e) => { z.x = Number(e.target.value) / 100; touch(); renderSelected(); });
      if (sy) sy.addEventListener("input", (e) => { z.y = Number(e.target.value) / 100; touch(); renderSelected(); });
      el("stSelDelete").addEventListener("click", () => {
        d.zooms = d.zooms.filter((x) => x.id !== z.id);
        S.sel = null;
        touch();
        renderBlocks();
        renderSelected();
      });
      return;
    }

    if (sp) {
      box.innerHTML =
        `<div class="st-sel-row">Speed segment <b>${fmtTime(sp.a)} – ${fmtTime(sp.b)}</b></div>` +
        `<div class="st-label">Rate</div><div class="st-seg" id="stSelRate">` +
        [0.5, 1, 1.5, 2, 4].map((r) => `<button type="button" data-rate="${r}" class="${r === sp.rate ? "active" : ""}">${r}×</button>`).join("") +
        `</div><button class="st-danger" id="stSelDelete" type="button">Delete this segment</button>`;
      for (const b of el("stSelRate").querySelectorAll("button")) {
        b.addEventListener("click", () => {
          sp.rate = Number(b.dataset.rate);
          touch();
          renderBlocks();
          renderSelected();
        });
      }
      el("stSelDelete").addEventListener("click", () => {
        d.speeds = d.speeds.filter((x) => x.id !== sp.id);
        S.sel = null;
        touch();
        renderBlocks();
        renderSelected();
      });
      return;
    }

    box.innerHTML = `<div class="st-note">Nothing selected. Click a block on the timeline, or press <b>+ Zoom</b> to add one at the playhead.</div>`;
  }

  // One canvas for the whole strip, drawn into as each seek lands. The earlier version appended an
  // <img> per frame and a single slow seek could leave the rest of the track empty.
  let filmToken = 0;
  async function buildFilmstrip() {
    const film = el("stFilm");
    for (const old of Array.from(film.querySelectorAll(".st-film-strip"))) old.remove();
    const d = S.doc;
    if (!d) return;
    const mine = ++filmToken;
    const W = Math.max(60, Math.round(tlWidth()));
    const H = 52;
    const count = clamp(Math.round(W / 78), 4, 26);
    const cw = W / count;
    const strip = document.createElement("canvas");
    strip.className = "st-film-strip";
    strip.width = Math.round(W * (window.devicePixelRatio || 1));
    strip.height = Math.round(H * (window.devicePixelRatio || 1));
    film.appendChild(strip);
    const ctx = strip.getContext("2d");
    ctx.scale(strip.width / W, strip.height / H);
    ctx.fillStyle = "#0e1016";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < count; i++) {
      if (filmToken !== mine || S.doc !== d) return;
      await seekTo(probe, (i + 0.5) * (d.duration / count));
      if (filmToken !== mine || probe.readyState < 2) continue;
      try {
        const vw = probe.videoWidth || d.width;
        const vh = probe.videoHeight || d.height;
        const sc = Math.max(cw / vw, H / vh);
        ctx.save();
        ctx.beginPath();
        ctx.rect(i * cw, 0, cw, H);
        ctx.clip();
        ctx.drawImage(probe, i * cw + (cw - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
        ctx.restore();
      } catch {}
    }
  }

  // ---------- Timeline interaction ----------
  function wireTimeline() {
    const ruler = el("stRuler");
    ruler.addEventListener("pointerdown", (e) => {
      const rect = ruler.getBoundingClientRect();
      const seek = (ev) => seekPreview(xToT(ev.clientX - rect.left));
      seek(e);
      ruler.setPointerCapture(e.pointerId);
      const move = (ev) => seek(ev);
      const up = () => {
        ruler.removeEventListener("pointermove", move);
        ruler.removeEventListener("pointerup", up);
      };
      ruler.addEventListener("pointermove", move);
      ruler.addEventListener("pointerup", up);
    });

    for (const [id, which] of [["stTrimA", "a"], ["stTrimB", "b"]]) {
      const node = el(id);
      node.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const rect = el("stFilm").getBoundingClientRect();
        node.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const t = xToT(ev.clientX - rect.left);
          const d = S.doc;
          if (which === "a") d.trim.a = clamp(t, 0, d.trim.b - 0.3);
          else d.trim.b = clamp(t, d.trim.a + 0.3, d.duration);
          renderTrims();
          seekPreview(which === "a" ? d.trim.a : d.trim.b);
          touch();
        };
        const up = () => {
          node.removeEventListener("pointermove", move);
          node.removeEventListener("pointerup", up);
        };
        node.addEventListener("pointermove", move);
        node.addEventListener("pointerup", up);
      });
    }

    const onBlockDown = (e) => {
      const block = e.target.closest(".st-block");
      if (!block) return;
      e.preventDefault();
      const kind = block.dataset.kind;
      const list = kind === "zoom" ? S.doc.zooms : S.doc.speeds;
      const item = list.find((x) => x.id === block.dataset.id);
      if (!item) return;
      S.sel = { kind, id: item.id };
      renderBlocks();
      renderSelected();
      const grip = e.target.classList.contains("st-grip") ? (e.target.classList.contains("a") ? "a" : "b") : null;
      const rect = block.parentElement.getBoundingClientRect();
      const t0 = xToT(e.clientX - rect.left);
      const a0 = item.a, b0 = item.b;
      block.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const t = xToT(ev.clientX - rect.left);
        const dt = t - t0;
        const d = S.doc;
        if (grip === "a") item.a = clamp(a0 + dt, 0, item.b - 0.35);
        else if (grip === "b") item.b = clamp(b0 + dt, item.a + 0.35, d.duration);
        else {
          const len = b0 - a0;
          item.a = clamp(a0 + dt, 0, d.duration - len);
          item.b = item.a + len;
        }
        if (kind === "zoom") item.auto = false;
        renderBlocks();
        renderSelected();
        touch();
      };
      const up = () => {
        block.removeEventListener("pointermove", move);
        block.removeEventListener("pointerup", up);
      };
      block.addEventListener("pointermove", move);
      block.addEventListener("pointerup", up);
    };
    el("stZoomTrack").addEventListener("pointerdown", onBlockDown);
    el("stSpeedTrack").addEventListener("pointerdown", onBlockDown);

    // Clicking bare track deselects; double-click adds a block there.
    for (const [trackId, kind] of [["stZoomTrack", "zoom"], ["stSpeedTrack", "speed"]]) {
      const track = el(trackId);
      track.addEventListener("click", (e) => {
        if (e.target.closest(".st-block")) return;
        S.sel = null;
        renderBlocks();
        renderSelected();
      });
      track.addEventListener("dblclick", (e) => {
        if (e.target.closest(".st-block")) return;
        const rect = track.getBoundingClientRect();
        const t = xToT(e.clientX - rect.left);
        if (kind === "zoom") S.sel = { kind, id: addZoomAt(S.doc, t).id };
        else S.sel = { kind, id: addSpeedAt(t).id };
        touch();
        renderBlocks();
        renderSelected();
      });
    }
  }

  function addSpeedAt(t) {
    const d = S.doc;
    const a = clamp(t, 0, Math.max(0, d.duration - 1));
    const b = clamp(a + Math.min(3, d.duration - a), a + 0.5, d.duration);
    const s = { id: uid(), a, b, rate: 2 };
    d.speeds.push(s);
    d.speeds.sort((m, n) => m.a - n.a);
    return s;
  }

  // =====================================================================================
  // Library
  // =====================================================================================

  async function loadLibrary() {
    const box = el("stLibrary");
    if (!box || !api()) return;
    const res = await api().listProjects();
    const list = (res && res.projects) || [];
    el("stLibCount").textContent = list.length ? String(list.length) : "";
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = `<div class="page-empty">Nothing recorded yet. Pick a screen above and hit record — the take and the edit both stay on this machine.</div>`;
      return;
    }
    for (const p of list) {
      const card = document.createElement("div");
      card.className = "st-demo" + (p.missing ? " missing" : "");
      card.innerHTML =
        (p.poster ? `<img class="st-demo-poster" src="${esc(p.poster)}" alt="" />`
          : `<div class="st-demo-poster empty">no preview</div>`) +
        `<div class="st-demo-body">
           <div class="st-demo-name">${esc(p.name || "Untitled demo")}</div>
           <div class="st-demo-sub">
             <span>${fmtTime(p.duration || 0)}</span><span>·</span>
             <span>${p.missing ? "video missing" : fmtBytes(p.bytes)}</span><span>·</span>
             <span>${esc(ago(p.savedAt || p.createdAt))}</span>
             <button class="st-del" title="Delete this demo" type="button">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
             </button>
           </div>
         </div>`;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".st-del")) return;
        if (p.missing) { alert("The video file for this demo is missing — it may have been deleted."); return; }
        openSavedProject(p.id);
      });
      card.querySelector(".st-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${p.name || "this demo"}" and its recording? This cannot be undone.`)) return;
        await api().deleteProject(p.id);
        loadLibrary();
      });
      box.appendChild(card);
    }
  }

  // =====================================================================================
  // Export
  // =====================================================================================

  const GIF_FPS = [10, 12, 15];
  const VIDEO_FPS = [24, 30, 60];

  // A muxer that is happy to write an audio codec it never gets a track for is not guaranteed, so
  // the codec string follows what the stream actually carries.
  function exportFormats(withAudio) {
    return {
      mp4: withAudio
        ? pickMime(["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"])
        : pickMime(["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"]),
      webm: withAudio
        ? pickMime(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"])
        : pickMime(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]),
    };
  }

  function openExport() {
    if (!S.doc) return;
    pausePreview();
    const mp4ok = !!(exportFormats(true).mp4 || exportFormats(false).mp4);
    const seg = el("stExFormat");
    for (const b of seg.querySelectorAll("button")) {
      const f = b.dataset.fmt;
      b.disabled = f === "mp4" && !mp4ok;
      b.title = b.disabled ? "This build of Chromium cannot mux MP4 — use WebM" : "";
      if (b.disabled) b.classList.remove("active");
    }
    if (!seg.querySelector("button.active")) seg.querySelector('[data-fmt="webm"]').classList.add("active");
    el("stExDone").hidden = true;
    el("stExProgress").hidden = true;
    el("stExStart").disabled = false;
    el("stExStart").textContent = "Export";
    syncExportFormat();
    el("stExportOverlay").hidden = false;
  }

  function currentFormat() {
    const b = el("stExFormat").querySelector("button.active");
    return b ? b.dataset.fmt : "webm";
  }

  function syncExportFormat() {
    const fmt = currentFormat();
    const fpsSel = el("stExFps");
    const list = fmt === "gif" ? GIF_FPS : VIDEO_FPS;
    const prev = Number(fpsSel.value);
    fpsSel.innerHTML = list.map((f) => `<option value="${f}"${f === (list.includes(prev) ? prev : list[1]) ? " selected" : ""}>${f} fps</option>`).join("");
    el("stExAudioRow").hidden = fmt === "gif";
    const d = S.doc;
    const out = d ? exportDuration(d) : 0;
    el("stExFormatNote").innerHTML = fmt === "gif"
      ? `GIF is encoded frame by frame here — expect roughly ${Math.max(5, Math.round(out * 1.6))}s of work, and a large file past ~15 seconds of demo.`
      : fmt === "mp4"
        ? "H.264 in MP4 — plays anywhere, including in a Slack or Notion preview."
        : "VP9 in WebM — smaller than MP4 at the same quality, but some tools still won't take it.";
  }

  // Speed segments change how long the finished demo runs; everything downstream needs that number.
  function exportDuration(d) {
    const step = 0.05;
    let out = 0;
    for (let t = d.trim.a; t < d.trim.b; t += step) out += step / speedAt(d, t);
    return out;
  }
  // Export-time → source-time, walking the same speed map.
  function sourceTimeAt(d, outT) {
    const step = 0.02;
    let acc = 0;
    let t = d.trim.a;
    while (t < d.trim.b) {
      const next = step * speedAt(d, t);
      if (acc + step > outT) return t + (outT - acc) * speedAt(d, t);
      acc += step;
      t += next;
    }
    return d.trim.b;
  }

  function exportProgress(p, text) {
    el("stExProgress").hidden = false;
    el("stExBar").style.width = clamp(p * 100, 0, 100).toFixed(1) + "%";
    el("stExStatus").textContent = text;
  }

  function exportDone(ok, text, path) {
    const box = el("stExDone");
    box.hidden = false;
    box.className = "st-export-done" + (ok ? "" : " err");
    box.innerHTML = `<span>${esc(text)}</span>`;
    if (ok && path) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Show in folder";
      b.addEventListener("click", () => api().reveal(path));
      box.appendChild(b);
    }
  }

  async function runExport() {
    if (S.exporting || !S.doc) return;
    const fmt = currentFormat();
    const d = S.doc;
    const resSel = el("stExRes").value;
    const fps = Number(el("stExFps").value) || 30;
    const withAudio = el("stExAudio").checked && d.hasAudio && fmt !== "gif";

    const maxW = resSel === "source" ? d.width : Math.round((Number(resSel) * (ASPECTS[d.style.aspect] || d.width / d.height)));
    const { W, H } = outputSize(d, fmt === "gif" ? Math.min(maxW, 900) : maxW);

    S.exporting = true;
    S.cancelExport = false;
    el("stExStart").disabled = true;
    el("stExStart").textContent = "Exporting…";
    el("stExDone").hidden = true;

    try {
      const blob = fmt === "gif"
        ? await encodeGif(d, W, H, fps)
        : await recordCanvas(d, W, H, fps, fmt, withAudio);
      if (S.cancelExport) { exportDone(false, "Export cancelled."); return; }
      exportProgress(1, "Saving…");
      const name = (d.name || "demo").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
      const res = await api().export({ data: await blob.arrayBuffer(), suggestedName: `${name}.${fmt}`, ext: fmt });
      if (res && res.ok) exportDone(true, `Exported ${fmtBytes(res.bytes)} to ${res.path}`, res.path);
      else if (res && res.canceled) exportDone(false, "Save cancelled — nothing was written.");
      else exportDone(false, "Could not save the file: " + (res && res.error));
    } catch (err) {
      console.error("[studio] export failed", err);
      exportDone(false, "Export failed: " + err.message);
    } finally {
      S.exporting = false;
      el("stExStart").disabled = false;
      el("stExStart").textContent = "Export";
    }
  }

  // MP4/WebM: play the take through at its real speed while a canvas capture stream records the
  // composited frames. Slower than a frame-by-frame render, but every frame is a real decoded frame.
  async function recordCanvas(d, W, H, fps, fmt, withAudio) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false });
    const stream = canvas.captureStream(fps);

    if (withAudio) {
      ensureAudioGraph();
      if (audioCtx) {
        if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
        for (const t of exportDest.stream.getAudioTracks()) stream.addTrack(t);
      }
    }
    const mime = exportFormats(withAudio)[fmt];
    const recorder = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: Math.min(24_000_000, Math.round(W * H * fps * 0.15)),
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { recorder.onstop = r; });

    const wasMuted = monitorGain ? monitorGain.gain.value : 1;
    if (monitorGain) monitorGain.gain.value = 0; // don't blast the room during an export

    const total = exportDuration(d);
    await seekTo(video, d.trim.a);
    if (d.hasCamera) await seekTo(camVideo, d.trim.a);

    recorder.start(250);
    video.playbackRate = speedAt(d, d.trim.a);
    await video.play().catch(() => {});
    if (d.hasCamera) camVideo.play().catch(() => {});

    await new Promise((resolve) => {
      const started = performance.now();
      const step = () => {
        if (S.cancelExport) return finish();
        const t = video.currentTime;
        if (t >= d.trim.b - 0.02 || video.ended) return finish();
        const rate = speedAt(d, t);
        if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
        if (d.hasCamera && Math.abs(camVideo.currentTime - t) > 0.15) { try { camVideo.currentTime = t; } catch {} }
        drawFrame(ctx, W, H, t);
        exportProgress(
          clamp((performance.now() - started) / 1000 / Math.max(0.1, total), 0, 0.99),
          `Rendering ${fmt.toUpperCase()} · ${fmtTime(t - d.trim.a)} of ${fmtTime(total)}`
        );
        requestAnimationFrame(step);
      };
      const finish = () => { resolve(); };
      requestAnimationFrame(step);
    });

    try { video.pause(); } catch {}
    try { camVideo.pause(); } catch {}
    video.playbackRate = 1;
    try { recorder.stop(); } catch {}
    await stopped;
    if (monitorGain) monitorGain.gain.value = wasMuted;
    return new Blob(chunks, { type: mime || "video/webm" });
  }

  // =====================================================================================
  // GIF encoder (GIF89a, median-cut palette, LZW) — no library, nothing leaves the machine
  // =====================================================================================

  function ByteSink() {
    let buf = new Uint8Array(1 << 16);
    let len = 0;
    const need = (n) => {
      if (len + n <= buf.length) return;
      let cap = buf.length;
      while (cap < len + n) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(buf.subarray(0, len));
      buf = nb;
    };
    return {
      byte(b) { need(1); buf[len++] = b & 255; },
      bytes(arr) { need(arr.length); buf.set(arr, len); len += arr.length; },
      short(v) { this.byte(v & 255); this.byte((v >> 8) & 255); },
      str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); },
      take() { return buf.subarray(0, len); },
    };
  }

  function BitWriter(sink) {
    let acc = 0, bits = 0;
    const block = [];
    const flushBlock = () => {
      if (!block.length) return;
      sink.byte(block.length);
      for (const b of block) sink.byte(b);
      block.length = 0;
    };
    return {
      write(code, size) {
        acc |= code << bits;
        bits += size;
        while (bits >= 8) {
          block.push(acc & 255);
          acc >>= 8;
          bits -= 8;
          if (block.length === 255) flushBlock();
        }
      },
      end() {
        if (bits > 0) { block.push(acc & 255); acc = 0; bits = 0; }
        flushBlock();
        sink.byte(0);
      },
    };
  }

  function lzwEncode(indices, minCodeSize, sink) {
    const CLEAR = 1 << minCodeSize;
    const EOI = CLEAR + 1;
    const bw = BitWriter(sink);
    let codeSize = minCodeSize + 1;
    let next = EOI + 1;
    let dict = new Map();
    bw.write(CLEAR, codeSize);
    let cur = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (cur << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) { cur = found; continue; }
      bw.write(cur, codeSize);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        bw.write(CLEAR, codeSize);
        dict = new Map();
        next = EOI + 1;
        codeSize = minCodeSize + 1;
      }
      cur = k;
    }
    bw.write(cur, codeSize);
    bw.write(EOI, codeSize);
    bw.end();
  }

  // Median cut: split the colour cloud along its widest axis until there are 256 boxes, then take
  // each box's mean. Cheap, and far better than a fixed web palette on gradients and UI chrome.
  function medianCut(samples, maxColors) {
    const boxes = [{ s: 0, e: samples.length }];
    const range = (box) => {
      let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (let i = box.s; i < box.e; i++) {
        const v = samples[i];
        const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
        if (g < gmin) gmin = g; if (g > gmax) gmax = g;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      }
      return { r: rmax - rmin, g: gmax - gmin, b: bmax - bmin };
    };
    while (boxes.length < maxColors) {
      let target = -1, best = -1, chan = "r";
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.e - box.s < 2) continue;
        const rg = range(box);
        const m = Math.max(rg.r, rg.g, rg.b);
        if (m > best) { best = m; target = i; chan = rg.r === m ? "r" : rg.g === m ? "g" : "b"; }
      }
      if (target < 0 || best <= 0) break;
      const box = boxes[target];
      const shift = chan === "r" ? 16 : chan === "g" ? 8 : 0;
      const view = samples.subarray(box.s, box.e);
      view.sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
      const mid = box.s + ((box.e - box.s) >> 1);
      boxes.splice(target, 1, { s: box.s, e: mid }, { s: mid, e: box.e });
    }
    const palette = new Uint8Array(256 * 3);
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      let r = 0, g = 0, b = 0;
      const n = Math.max(1, box.e - box.s);
      for (let j = box.s; j < box.e; j++) {
        const v = samples[j];
        r += (v >> 16) & 255; g += (v >> 8) & 255; b += v & 255;
      }
      palette[i * 3] = Math.round(r / n);
      palette[i * 3 + 1] = Math.round(g / n);
      palette[i * 3 + 2] = Math.round(b / n);
    }
    return { palette, used: Math.max(2, boxes.length) };
  }

  function nearestIndex(palette, used, cache, r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < used; i++) {
      const dr = r - palette[i * 3], dg = g - palette[i * 3 + 1], db = b - palette[i * 3 + 2];
      const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    cache[key] = best;
    return best;
  }

  async function encodeGif(d, W, H, fps) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const total = exportDuration(d);
    const frames = Math.max(2, Math.round(total * fps));
    const delay = Math.max(2, Math.round(100 / fps)); // GIF delays are in hundredths of a second

    // Pass one: sample a spread of frames to build one palette for the whole animation, so colours
    // don't crawl between frames.
    const probeCount = Math.min(frames, 14);
    const sampleStride = Math.max(1, Math.floor((W * H) / 9000));
    const collected = [];
    for (let i = 0; i < probeCount; i++) {
      if (S.cancelExport) throw new Error("cancelled");
      const outT = (i / Math.max(1, probeCount - 1)) * total;
      await seekTo(probe, sourceTimeAt(d, outT));
      if (d.hasCamera) await seekTo(camVideo, sourceTimeAt(d, outT));
      drawFrame(ctx, W, H, sourceTimeAt(d, outT), { src: probe });
      const px = ctx.getImageData(0, 0, W, H).data;
      for (let p = 0; p < W * H; p += sampleStride) {
        collected.push((px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2]);
      }
      exportProgress((i / probeCount) * 0.2, `Building the palette · ${i + 1}/${probeCount}`);
    }
    const { palette, used } = medianCut(Uint32Array.from(collected), 256);
    const cache = new Int16Array(32768).fill(-1);

    const sink = ByteSink();
    sink.str("GIF89a");
    sink.short(W);
    sink.short(H);
    sink.byte(0x80 | 0x70 | 7); // global colour table, 8 bits per channel, 256 entries
    sink.byte(0);
    sink.byte(0);
    sink.bytes(palette);
    // NETSCAPE2.0: loop forever.
    sink.byte(0x21); sink.byte(0xff); sink.byte(0x0b);
    sink.str("NETSCAPE2.0");
    sink.byte(3); sink.byte(1); sink.short(0); sink.byte(0);

    const indices = new Uint8Array(W * H);
    for (let f = 0; f < frames; f++) {
      if (S.cancelExport) throw new Error("cancelled");
      const outT = (f / frames) * total;
      const srcT = sourceTimeAt(d, outT);
      await seekTo(probe, srcT);
      if (d.hasCamera) await seekTo(camVideo, srcT);
      drawFrame(ctx, W, H, srcT, { src: probe });
      const px = ctx.getImageData(0, 0, W, H).data;
      for (let p = 0, n = W * H; p < n; p++) {
        indices[p] = nearestIndex(palette, used, cache, px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
      }
      sink.byte(0x21); sink.byte(0xf9); sink.byte(4);
      sink.byte(0);            // no disposal, no transparency — every frame is a full frame
      sink.short(delay);
      sink.byte(0);
      sink.byte(0);
      sink.byte(0x2c);
      sink.short(0); sink.short(0); sink.short(W); sink.short(H);
      sink.byte(0);
      sink.byte(8);
      lzwEncode(indices, 8, sink);
      exportProgress(0.2 + (f / frames) * 0.8, `Encoding GIF · frame ${f + 1} of ${frames}`);
      if (f % 6 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the UI alive
    }
    sink.byte(0x3b);
    return new Blob([sink.take()], { type: "image/gif" });
  }

  // =====================================================================================
  // Wiring
  // =====================================================================================

  function wire() {
    el("stRefreshSources").addEventListener("click", () => { loadSources(); loadDevices(); });
    el("stRecordBtn").addEventListener("click", () => startRecording().catch(failCapture));
    el("stRecStop").addEventListener("click", () => stopRecording());
    el("stRecPause").addEventListener("click", togglePause);
    el("stRecMark").addEventListener("click", markZoom);

    for (const [box, sel] of [["stOptMic", "stMicDevice"], ["stOptCamera", "stCamDevice"]]) {
      el(box).addEventListener("change", (e) => {
        const list = sel === "stMicDevice" ? S.devices.mics : S.devices.cams;
        el(sel).disabled = !e.target.checked || !list.length;
        if (e.target.checked && list.length && !list[0].label) loadDevices();
      });
    }
    el("stOptSystem").addEventListener("change", () => {});

    // Editor chrome
    el("stBackBtn").addEventListener("click", async () => {
      if (S.dirty) await saveProject(true);
      leaveEditor();
    });
    el("stName").addEventListener("input", (e) => { S.doc.name = e.target.value; touch(); });
    el("stSaveBtn").addEventListener("click", () => saveProject(false));
    el("stExportBtn").addEventListener("click", openExport);

    for (const b of el("stTabs").querySelectorAll("button")) {
      b.addEventListener("click", () => {
        for (const o of el("stTabs").querySelectorAll("button")) o.classList.toggle("active", o === b);
        for (const p of document.querySelectorAll(".st-tabpane")) p.hidden = p.dataset.pane !== b.dataset.tab;
      });
    }

    const bindRange = (id, valId, apply, fmt) => {
      el(id).addEventListener("input", (e) => {
        const v = Number(e.target.value);
        apply(v);
        if (valId) el(valId).textContent = fmt ? fmt(v) : v;
        touch();
      });
    };
    bindRange("stPad", "stPadVal", (v) => { S.doc.style.pad = v; }, (v) => v + "%");
    bindRange("stRadius", "stRadiusVal", (v) => { S.doc.style.radius = v; });
    bindRange("stShadow", "stShadowVal", (v) => { S.doc.style.shadow = v; });
    bindRange("stCurSize", "stCurSizeVal", (v) => { S.doc.cursorStyle.size = v; }, (v) => (v / 100).toFixed(1) + "×");
    bindRange("stCurSmooth", "stCurSmoothVal", (v) => { S.doc.cursorStyle.smooth = v; S.smoothedFor = -1; });
    bindRange("stCurBlur", "stCurBlurVal", (v) => { S.doc.cursorStyle.blur = v; });
    bindRange("stCurBounce", "stCurBounceVal", (v) => { S.doc.cursorStyle.bounce = v; });
    bindRange("stCamSize", "stCamSizeVal", (v) => { S.doc.camera.size = v; }, (v) => v + "%");
    bindRange("stZoomSens", "stZoomSensVal", (v) => { S.doc.zoomSens = v; });
    bindRange("stZoomScale", "stZoomScaleVal", (v) => { S.doc.zoomScale = v; }, (v) => (v / 100).toFixed(1) + "×");

    for (const [id, val] of [["stBgFrom", "bgFrom"], ["stBgTo", "bgTo"]]) {
      el(id).addEventListener("input", (e) => {
        S.doc.style[val] = e.target.value;
        S.doc.style.bg = "custom";
        touch();
        syncControls();
      });
    }
    el("stBgAngle").addEventListener("input", (e) => {
      S.doc.style.bgAngle = Number(e.target.value);
      S.doc.style.bg = "custom";
      touch();
      syncControls();
    });
    el("stStylePolish").addEventListener("click", () => {
      Object.assign(S.doc.style, { bg: "nutaan", pad: 8, radius: 14, shadow: 45 });
      touch(); syncControls();
    });
    el("stStyleBleed").addEventListener("click", () => {
      // The raw capture, edge to edge — what you want when the demo IS the screen.
      Object.assign(S.doc.style, { bg: "none", pad: 0, radius: 0, shadow: 0, aspect: "auto" });
      layoutCanvas(); touch(); syncControls();
    });

    for (const [id, apply] of [
      ["stCurShow", (c) => { S.doc.cursorStyle.show = c; }],
      ["stCurHalo", (c) => { S.doc.cursorStyle.halo = c; }],
      ["stCurBurst", (c) => { S.doc.cursorStyle.burst = c; }],
      ["stCurRing", (c) => { S.doc.cursorStyle.ring = c; }],
      ["stCurHideIdle", (c) => { S.doc.cursorStyle.hideIdle = c; }],
      ["stCamShow", (c) => { S.doc.camera.show = c; }],
      ["stCamMirror", (c) => { S.doc.camera.mirror = c; }],
    ]) {
      el(id).addEventListener("change", (e) => { apply(e.target.checked); touch(); });
    }

    el("stAspect").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      S.doc.style.aspect = b.dataset.ar;
      segActive("stAspect", "ar", b.dataset.ar);
      layoutCanvas();
      syncControls();
      touch();
    });
    el("stFrameStyle").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      (S.doc.frame || (S.doc.frame = {})).style = b.dataset.frame;
      segActive("stFrameStyle", "frame", b.dataset.frame);
      touch();
    });
    el("stFrameTitle").addEventListener("change", (e) => {
      (S.doc.frame || (S.doc.frame = {})).title = e.target.checked;
      touch();
    });

    el("stCamShape").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      S.doc.camera.shape = b.dataset.shape;
      segActive("stCamShape", "shape", b.dataset.shape);
      touch();
    });
    el("stCamPos").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      S.doc.camera.pos = b.dataset.pos;
      segActive("stCamPos", "pos", b.dataset.pos);
      touch();
    });

    el("stZoomRedetect").addEventListener("click", () => {
      const d = S.doc;
      if (!d.path || !d.path.length) { flashBadge("No pointer path was recorded with this take.", 4000); return; }
      const manual = d.zooms.filter((z) => !z.auto);
      d.zooms = detectZooms(d, d.zoomSens, d.zoomScale / 100).concat(manual).sort((a, b) => a.a - b.a);
      S.sel = null;
      touch();
      renderBlocks();
      renderSelected();
      flashBadge(`${d.zooms.length} zooms from ${d.path.length.toLocaleString()} pointer samples.`, 3500);
    });
    el("stZoomClear").addEventListener("click", () => {
      S.doc.zooms = [];
      S.sel = null;
      touch();
      renderBlocks();
      renderSelected();
    });

    el("stPlayBtn").addEventListener("click", () => (S.playing ? pausePreview() : playPreview()));
    el("stMute").addEventListener("change", (e) => {
      ensureAudioGraph();
      if (monitorGain) monitorGain.gain.value = e.target.checked ? 0 : 1;
    });
    el("stAddZoom").addEventListener("click", () => {
      S.sel = { kind: "zoom", id: addZoomAt(S.doc, video.currentTime).id };
      touch();
      renderBlocks();
      renderSelected();
    });
    el("stAddSpeed").addEventListener("click", () => {
      S.sel = { kind: "speed", id: addSpeedAt(video.currentTime).id };
      touch();
      renderBlocks();
      renderSelected();
    });
    el("stSplitTrimIn").addEventListener("click", () => {
      S.doc.trim.a = clamp(video.currentTime, 0, S.doc.trim.b - 0.3);
      renderTrims();
      touch();
    });
    el("stSplitTrimOut").addEventListener("click", () => {
      S.doc.trim.b = clamp(video.currentTime, S.doc.trim.a + 0.3, S.doc.duration);
      renderTrims();
      touch();
    });
    el("stResetTrim").addEventListener("click", () => {
      S.doc.trim = { a: 0, b: S.doc.duration };
      renderTrims();
      touch();
    });

    wireTimeline();

    // Export sheet
    el("stExFormat").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      for (const o of el("stExFormat").querySelectorAll("button")) o.classList.toggle("active", o === b);
      syncExportFormat();
    });
    el("stExRes").addEventListener("change", syncExportFormat);
    el("stExStart").addEventListener("click", runExport);
    const closeExport = () => {
      if (S.exporting) { S.cancelExport = true; return; }
      el("stExportOverlay").hidden = true;
    };
    el("stExportClose").addEventListener("click", closeExport);
    el("stExCancel").addEventListener("click", closeExport);

    // Hotkeys fired from the main process while another app has focus.
    if (api().onHotkey) {
      api().onHotkey((data) => {
        if (!S.rec) return;
        if (data.action === "stop") stopRecording();
        else if (data.action === "pause") togglePause();
        else if (data.action === "zoom") markZoom();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (S.view !== "editor" || el("studioPage").hidden) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === " ") { e.preventDefault(); S.playing ? pausePreview() : playPreview(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seekPreview(video.currentTime - (e.shiftKey ? 1 : 1 / 30)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seekPreview(video.currentTime + (e.shiftKey ? 1 : 1 / 30)); }
      else if ((e.key === "Delete" || e.key === "Backspace") && S.sel) {
        const d = S.doc;
        if (S.sel.kind === "zoom") d.zooms = d.zooms.filter((z) => z.id !== S.sel.id);
        else d.speeds = d.speeds.filter((s) => s.id !== S.sel.id);
        S.sel = null;
        touch();
        renderBlocks();
        renderSelected();
      }
    });

    window.addEventListener("resize", () => {
      if (S.view !== "editor" || !S.doc) return;
      layoutCanvas();
      renderTimeline();
    });

    video.addEventListener("seeked", () => { S.needsDraw = true; });
    video.addEventListener("loadeddata", () => { S.needsDraw = true; });
    window.addEventListener("beforeunload", () => { if (S.rec) stopRecording(); });
  }

  // ---------- Public hooks, called by app.js when the sidebar switches ----------
  window.NutaanStudio = {
    onShow() {
      if (!api()) return;
      if (!S.booted) {
        S.booted = true;
        wire();
      }
      if (S.view === "editor" && S.doc) {
        startLoop();
        layoutCanvas();
        renderTimeline();
      } else {
        loadSources();
        loadDevices();
        loadLibrary();
      }
    },
    onHide() {
      pausePreview();
      stopLoop();
    },
    isRecording() { return !!S.rec; },
  };
})();
