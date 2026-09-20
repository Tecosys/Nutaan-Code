/* ---------- Design ----------
   Start from what you want to make, describe it, and the model you already picked draws it as real
   HTML. The workspace then reads the way the work actually goes: what has been made on the left,
   the rendered thing on the right, and a box to say what to change next.

   Nothing is installed to make this work — an artboard is HTML in a JSON file, rendered in a
   sandboxed frame. That is also why "use this design to build" is more than a button: the thing on
   screen is the artifact, so handing it to the coding side is just handing over the file. */
(function () {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = () => (window.nutaan && window.nutaan.design) || null;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // What you can make, and the prompt each one needs so the model produces the right artefact.
  const KINDS = [
    { id: "ui", label: "UI mockup", preset: "desktop", icon: "▦",
      ask: "a screen design, as one self-contained HTML artboard" },
    { id: "mobile", label: "Mobile app", preset: "mobile", icon: "▯",
      ask: "a mobile app screen at 390×844, as one self-contained HTML artboard" },
    { id: "dashboard", label: "Dashboard", preset: "desktop", icon: "▥",
      ask: "an analytics dashboard: a left nav or top bar, a row of KPI tiles with real numbers and deltas, " +
           "at least two charts drawn as inline SVG (bars, a line with a filled area, or a donut — real paths " +
           "with axis labels and gridlines, never an image placeholder), and a data table with sensible column " +
           "alignment. Dense and scannable, the way a real product dashboard is" },
    { id: "wireframe", label: "Wireframe", preset: "desktop", icon: "▤",
      ask: "a low-fidelity wireframe — greyscale, boxes and placeholder type, no colour or imagery" },
    { id: "deck", label: "Slide deck", preset: "slide", icon: "▭",
      ask: "a slide deck. One artboard PER SLIDE at 1920×1080, each a complete slide with a clear hierarchy — title slide first, then the argument, then a closing slide" },
    { id: "doc", label: "Document", preset: "a4", icon: "▣",
      ask: "a typeset document on A4 pages. One artboard PER PAGE at 1240×1754, with real editorial typography: a measured column, proper heading scale, footnotes and page furniture" },
    { id: "paper", label: "Research paper", preset: "a4", icon: "☰",
      ask: "an academic paper on A4 pages, one artboard PER PAGE: title block with authors and abstract, two-column body, numbered sections, figures with captions, and a references list" },
    { id: "social", label: "Social post", preset: "square", icon: "◼",
      ask: "a social post at 1080×1080, as one self-contained HTML artboard" },
    { id: "email", label: "Email", preset: "email", icon: "✉",
      ask: "an HTML email at 640px wide, table-free modern CSS, as one artboard" },
  ];

  const S = {
    booted: false, doc: null, list: [], presets: [],
    kind: KINDS[0], tab: null, mode: "preview", zoom: 1, device: "fit",
    sel: null, saveTimer: 0,
  };

  const timeAgo = (ts) => {
    if (!ts) return "";
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
  };

  // ---------- home ----------
  function renderKinds() {
    el("dzKinds").innerHTML = KINDS.map((k) =>
      `<button type="button" class="dz-kind${k.id === S.kind.id ? " active" : ""}" data-kind="${k.id}">
         <span class="dz-kind-icon">${k.icon}</span>${esc(k.label)}</button>`).join("");
    el("dzKindChip").textContent = S.kind.label;
  }

  async function loadList() {
    S.list = (await api().list()) || [];
    const box = el("dzLibrary");
    if (!box) return;
    box.innerHTML = S.list.length
      ? S.list.map((d) => `
          <div class="dz-card" data-id="${esc(d.id)}">
            <div class="dz-card-thumb">${d.thumb ? `<img src="${esc(d.thumb)}" alt="" />` : ""}</div>
            <div class="dz-card-name">${esc(d.name)}</div>
            <div class="dz-card-sub">${d.artboards} artboard${d.artboards === 1 ? "" : "s"} · ${timeAgo(d.updatedAt)}</div>
            ${d.brief ? `<div class="dz-card-brief">${esc(d.brief)}</div>` : ""}
            <button class="dz-card-del" data-del="${esc(d.id)}" title="Delete">✕</button>
          </div>`).join("")
      : `<div class="page-empty">Nothing yet. Say what you want above and it gets designed here.</div>`;
  }

  // The prompt the agent receives. It carries the kind, the size and the rule that the artefact is
  // an artboard — which is what keeps any model producing the right thing.
  function designPrompt(text, { follow } = {}) {
    const k = S.kind;
    if (follow && S.doc) {
      return `In the Design canvas, revise the design "${S.doc.name}" (design_id ${S.doc.id}).\n\n` +
        `${text}\n\n` +
        `Call design_read first to see the artboards as they are now, then design_update the ones that need to change ` +
        `(or design_artboard for a genuinely new screen). Read the brand back too and keep using it.

` +
        `Then design_verify every artboard you touched and fix what it finds, repeating until it comes back clean.`;
    }
    return `Design ${k.ask}.\n\n${text}\n\n` +
      `First call design_brand. If no brand is set, ask me for my colours and logo before you draw anything — propose ` +
      `a palette you think fits and let me confirm it. Then use exactly those colours in every artboard, and place the ` +
      `logo with <img src="{{logo}}"> wherever it belongs.

` +
      `Use the Design canvas: call design_new with a name and a brief (audience, tone, palette, the copy that matters), ` +
      `then design_artboard with preset "${k.preset}" for each screen or page. Write complete, self-contained HTML with inline ` +
      `<style> — real layout, a proper type scale, and no external files.

` +
      `After EVERY artboard, call design_verify on it and look at the screenshot it returns. If it reports findings, or ` +
      `the picture looks cramped, misaligned or unfinished, fix it with design_update and verify again. Keep going until ` +
      `verify comes back clean — do not tell me it is done before that. Then say in one line what you made.`;
  }

  function sendToAgent(prompt) {
    if (window.NutaanChat && window.NutaanChat.send) window.NutaanChat.send(prompt);
  }

  // ---------- workspace ----------
  function showWork(on) {
    el("dzHome").hidden = on;
    el("dzWork").hidden = !on;
  }

  async function open(id, focusBoard) {
    const doc = await api().read(id);
    // The design may have been deleted since it was listed; fall back to the list rather than
    // leaving a broken workspace on screen.
    if (!doc || doc.error) {
      S.doc = null;
      S.tab = null;
      showWork(false);
      await loadList();
      return;
    }
    S.doc = doc;
    S.tab = focusBoard || (doc.artboards[0] && doc.artboards[0].id) || null;
    el("dzName").value = doc.name;
    showWork(true);
    renderBar();
    renderSide();
    renderBoard();
  }

  function board() {
    return S.doc && S.doc.artboards.find((b) => b.id === S.tab);
  }

  // No tab strip any more: the artboard list on the left is the switcher, and the board carries
  // its own label — which is how the design this follows lays it out.
  function renderBar() {
    if (!S.doc) return;
    const b = board();
    const name = el("dzBarName");
    const sub = el("dzBarSub");
    if (name) name.textContent = S.doc.name;
    if (sub) {
      sub.textContent = b
        ? `${b.name} · ${b.w}×${b.h}` + (S.doc.artboards.length > 1 ? ` · ${S.doc.artboards.length} artboards` : "")
        : `${S.doc.artboards.length} artboards`;
    }
  }

  // ---------- brand ----------
  // Colours and a logo belong to the design, so every artboard and every later turn uses the same
  // ones. The agent reads this back; the user can set it here without saying a word to the model.
  const BRAND_FIELDS = [
    ["primary", "Primary"], ["secondary", "Secondary"], ["accent", "Accent"],
    ["bg", "Background"], ["text", "Text"],
  ];

  function brandHtml() {
    const b = (S.doc && S.doc.brand) || {};
    return `<div class="dz-side-title">Brand</div>
      <div class="dz-brand">
        <div class="dz-brand-swatches">
          ${BRAND_FIELDS.map(([k, label]) => `
            <label class="dz-sw" title="${esc(label)}">
              <input type="color" data-brand="${k}" value="${esc(b[k] || (k === "bg" ? "#ffffff" : k === "text" ? "#111111" : "#6366f1"))}" />
              <span class="${b[k] ? "set" : ""}">${esc(label)}</span>
            </label>`).join("")}
        </div>
        <input class="dz-brand-font" id="dzBrandFont" placeholder="Font stack — e.g. Inter, system-ui" value="${esc(b.font || "")}" />
        <div class="dz-brand-logo">
          ${b.logo
            ? `<img src="${esc(b.logo)}" alt="" /><button class="dz-mini" id="dzLogoReplace" type="button">Replace</button><button class="dz-mini danger" id="dzLogoClear" type="button">Remove</button>`
            : `<button class="dz-mini" id="dzLogoAdd" type="button">+ Add logo</button><span class="dz-brand-hint">PNG, SVG or JPG — it is embedded in the design</span>`}
        </div>
      </div>`;
  }

  function wireBrand() {
    const box = el("dzSideBody");
    if (!box || !S.doc) return;
    for (const input of box.querySelectorAll("[data-brand]")) {
      input.addEventListener("change", async (e) => {
        S.doc.brand = await api().setBrand(S.doc.id, { [e.target.dataset.brand]: e.target.value });
        renderSide();
        flash("Brand saved");
      });
    }
    const font = el("dzBrandFont");
    if (font) font.addEventListener("change", async (e) => {
      S.doc.brand = await api().setBrand(S.doc.id, { font: e.target.value });
      flash("Brand saved");
    });
    const add = el("dzLogoAdd") || el("dzLogoReplace");
    if (add) add.addEventListener("click", async () => {
      const res = await api().pickLogo(S.doc.id);
      if (res && res.ok) { S.doc.brand = res.brand; renderSide(); flash("Logo added"); }
      else if (res && res.error) alert(res.error);
    });
    const clear = el("dzLogoClear");
    if (clear) clear.addEventListener("click", async () => {
      S.doc.brand = await api().setBrand(S.doc.id, { logo: "", logoAlt: "" });
      renderSide();
    });
  }

  function renderSide() {
    const box = el("dzSideBody");
    if (!S.doc) return;
    const boards = S.doc.artboards;
    box.innerHTML =
      (S.doc.brief ? `<div class="dz-brief"><div class="dz-brief-h">Brief</div>${esc(S.doc.brief)}</div>` : "") +
      brandHtml() +
      `<div class="dz-side-title">Artboards <span class="count">${boards.length}</span>
         <span class="spacer"></span>
         <button class="dz-mini" id="dzAddBoard" type="button" title="Add an empty artboard">+</button></div>` +
      (boards.length
        ? boards.map((b) => `
            <div class="dz-side-row${b.id === S.tab ? " active" : ""}" data-id="${esc(b.id)}">
              <span class="dz-side-name">${esc(b.name)}</span>
              <span class="dz-side-size">${b.w}×${b.h}</span>
            </div>`).join("")
        : `<div class="st-note">Nothing drawn yet. Ask below and it appears here.</div>`) +
      `<div class="st-note dz-hint">Click anything in the preview to select it — text, colour, type, spacing and size are all editable, and every change is written into the design the agent reads next.</div>`;
    wireBrand();
  }

  function deviceWidth() {
    return { desktop: 1440, laptop: 1280, tablet: 834, mobile: 390 }[S.device] || 0;
  }

  function renderBoard() {
    if (LIVE.on) return liveRender();
    const b = board();
    const holder = el("dzFrameHolder");
    const code = el("dzCode");
    if (!b) { holder.innerHTML = `<div class="page-empty">No artboard yet.</div>`; return; }

    if (S.mode === "code") {
      holder.hidden = true;
      code.hidden = false;
      code.textContent = b.html || "";
      return;
    }
    holder.hidden = false;
    code.hidden = true;

    const w = deviceWidth() || b.w;
    const wrap = el("dzStageWrap").getBoundingClientRect();
    const fit = S.device === "fit"
      ? clamp(Math.min((wrap.width - 60) / b.w, (wrap.height - 60) / b.h), 0.08, 1)
      : clamp((wrap.width - 60) / w, 0.08, 1);
    const scale = fit * S.zoom;
    el("dzZoomLabel").textContent = Math.round(scale * 100) + "%";

    holder.innerHTML = `<div class="dz-board" style="width:${w}px;height:${b.h}px;transform:scale(${scale})">
        <div class="dz-board-label">${esc(b.name)}</div>
        <div class="dz-board-frame"></div>
        <span class="dz-h tl"></span><span class="dz-h tr"></span><span class="dz-h bl"></span><span class="dz-h br"></span>
        <iframe class="dz-frame" sandbox="allow-same-origin" scrolling="no"></iframe>
      </div>`;
    const frame = holder.querySelector(".dz-frame");
    frame.srcdoc = wrapHtml(b, w);
    frame.addEventListener("load", () => bindFrame(frame, b.id), { once: true });
  }

  function wrapHtml(b, width) {
    const html = b.html || "";
    const body = /<html[\s>]/i.test(html)
      ? html
      : `<!doctype html><html><head><meta charset="utf-8" />
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${width || b.w}px;min-height:${b.h}px;background:#fff;
    font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
    color:#0f1117;-webkit-font-smoothing:antialiased}
  img{max-width:100%}
</style></head><body>${html}</body></html>`;
    return body.replace(/<\/head>/i, `<style>
  [data-nd-sel]{outline:2px solid #a855f7 !important;outline-offset:1px}
  [data-nd-hover]{outline:1px dashed rgba(168,85,247,.6) !important;outline-offset:1px}
</style></head>`);
  }

  function bindFrame(frame, boardId) {
    let d;
    try { d = frame.contentDocument; } catch { return; }
    if (!d) return;
    d.addEventListener("mouseover", (e) => {
      for (const n of d.querySelectorAll("[data-nd-hover]")) n.removeAttribute("data-nd-hover");
      if (e.target && e.target !== d.body) e.target.setAttribute("data-nd-hover", "1");
    });
    d.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); select(boardId, e.target); }, true);
  }

  const pathOf = (node, root) => {
    const parts = [];
    let n = node;
    while (n && n !== root && n.parentElement) { parts.unshift([...n.parentElement.children].indexOf(n)); n = n.parentElement; }
    return parts;
  };
  const nodeAt = (d, path) => {
    let n = d.body;
    for (const i of path || []) { if (!n || !n.children[i]) return null; n = n.children[i]; }
    return n;
  };

  function frameDoc() {
    const f = el("dzFrameHolder").querySelector(".dz-frame");
    return f && f.contentDocument;
  }

  function select(boardId, node) {
    const d = frameDoc();
    if (!d || !node || node === d.body) { S.sel = null; renderInspect(); return; }
    for (const n of d.querySelectorAll("[data-nd-sel]")) n.removeAttribute("data-nd-sel");
    node.setAttribute("data-nd-sel", "1");
    S.sel = { boardId, path: pathOf(node, d.body), tag: node.tagName.toLowerCase() };
    renderInspect();
  }

  function selectedNode() {
    const d = frameDoc();
    return S.sel && d ? nodeAt(d, S.sel.path) : null;
  }

  // Edits go straight back into the stored HTML — the same HTML the agent reads next turn.
  function commit() {
    const d = frameDoc();
    if (!S.sel || !S.doc || !d) return;
    const clone = d.body.cloneNode(true);
    for (const n of clone.querySelectorAll("[data-nd-sel],[data-nd-hover]")) {
      n.removeAttribute("data-nd-sel");
      n.removeAttribute("data-nd-hover");
    }
    const head = d.head ? d.head.innerHTML.replace(/<style>\s*\[data-nd-sel\][\s\S]*?<\/style>/i, "") : "";
    const html = `<!doctype html><html><head>${head}</head><body>${clone.innerHTML}</body></html>`;
    const b = S.doc.artboards.find((x) => x.id === S.sel.boardId);
    if (b) b.html = html;
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(async () => {
      await api().setArtboard(S.doc.id, S.sel.boardId, { html });
      flash("Saved");
    }, 400);
  }

  // Everything inside an artboard is editable, not just its text and two colours: type, weight,
  // alignment, spacing, size and borders — and for an image, swapping the file and resizing it.
  // Each change is written straight back into the artboard's HTML, which is the same HTML the
  // agent reads on its next turn, so hand edits and model edits never diverge.
  function renderInspect() {
    const box = el("dzInspect");
    const node = selectedNode();
    if (!node) {
      box.innerHTML = `<span class="dz-i-hint">Click anything in the design to edit it — text, colour, type, spacing, size. Double-click text to edit it in place.</span>`;
      return;
    }
    const win = node.ownerDocument.defaultView;
    const cs = win.getComputedStyle(node);
    const px = (v) => Math.round(parseFloat(v) || 0);
    const hex = (v) => {
      const m = (v || "").match(/[\d.]+/g);
      if (!m || m.length < 3) return "#000000";
      if (m[3] !== undefined && Number(m[3]) === 0) return "#ffffff";
      return "#" + m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, "0")).join("");
    };
    const isImg = S.sel.tag === "img";
    const isText = [...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

    const num = (id, label, value, min, max) =>
      `<label class="dz-i-f">${label}<input type="number" id="${id}" min="${min}" max="${max}" value="${value}" /></label>`;

    box.innerHTML =
      `<span class="dz-i-tag">&lt;${esc(S.sel.tag)}&gt;</span>` +
      (isText ? `<input class="dz-i-text" id="dzIText" value="${esc(node.textContent.trim())}" />` : "") +
      (isImg
        ? `<button class="dz-mini" id="dzIImg" type="button">Replace image</button>` +
          num("dzIW", "W", px(cs.width), 8, 4000) + num("dzIH", "H", px(cs.height), 8, 4000) +
          `<label class="dz-i-f">Fit<select id="dzIFit">
             ${["contain", "cover", "fill", "none"].map((v) => `<option ${cs.objectFit === v ? "selected" : ""}>${v}</option>`).join("")}
           </select></label>`
        : "") +
      `<label class="dz-i-f">Text<input type="color" id="dzIColor" value="${hex(cs.color)}" /></label>` +
      `<label class="dz-i-f">Fill<input type="color" id="dzIBg" value="${hex(cs.backgroundColor)}" /></label>` +
      num("dzIFs", "Size", px(cs.fontSize), 6, 200) +
      `<label class="dz-i-f">Weight<select id="dzIFw">
         ${[300, 400, 500, 600, 700, 800, 900].map((w) => `<option ${String(px(cs.fontWeight)) === String(w) ? "selected" : ""}>${w}</option>`).join("")}
       </select></label>` +
      `<label class="dz-i-f">Align<select id="dzIAlign">
         ${["left", "center", "right", "justify"].map((a) => `<option ${cs.textAlign === a ? "selected" : ""}>${a}</option>`).join("")}
       </select></label>` +
      num("dzILh", "Line", Math.round((parseFloat(cs.lineHeight) / (parseFloat(cs.fontSize) || 16)) * 100) || 140, 80, 300) +
      num("dzILs", "Track", Math.round((parseFloat(cs.letterSpacing) || 0) * 10) / 10, -5, 30) +
      num("dzIPad", "Pad", px(cs.paddingTop), 0, 200) +
      num("dzIGap", "Gap", px(cs.gap), 0, 200) +
      num("dzIRad", "Radius", px(cs.borderRadius), 0, 200) +
      `<button class="dz-mini" id="dzIUp" type="button" title="Select the element around this one">↑ Parent</button>` +
      `<button class="dz-mini" id="dzIDup" type="button" title="Duplicate it">Duplicate</button>` +
      `<button class="dz-mini danger" id="dzIDel" type="button">Remove</button>`;

    const set = (prop, v) => { node.style[prop] = v; commit(); };
    const onNum = (id, fn) => { const e2 = el(id); if (e2) e2.addEventListener("input", (e) => fn(e.target.value)); };

    const t = el("dzIText");
    if (t) t.addEventListener("input", (e) => { node.textContent = e.target.value; commit(); });
    el("dzIColor").addEventListener("input", (e) => set("color", e.target.value));
    el("dzIBg").addEventListener("input", (e) => set("backgroundColor", e.target.value));
    onNum("dzIFs", (v) => set("fontSize", v + "px"));
    onNum("dzIPad", (v) => set("padding", v + "px"));
    onNum("dzIGap", (v) => set("gap", v + "px"));
    onNum("dzIRad", (v) => set("borderRadius", v + "px"));
    onNum("dzILh", (v) => set("lineHeight", (Number(v) / 100).toFixed(2)));
    onNum("dzILs", (v) => set("letterSpacing", v + "px"));
    onNum("dzIW", (v) => set("width", v + "px"));
    onNum("dzIH", (v) => set("height", v + "px"));
    el("dzIFw").addEventListener("change", (e) => set("fontWeight", e.target.value));
    el("dzIAlign").addEventListener("change", (e) => set("textAlign", e.target.value));
    const fit = el("dzIFit");
    if (fit) fit.addEventListener("change", (e) => set("objectFit", e.target.value));

    const img = el("dzIImg");
    if (img) img.addEventListener("click", async () => {
      // Reuses the logo picker: it returns a data URI, which is what an artboard needs to stay
      // self-contained.
      const res = await api().pickLogo(S.doc.id);
      if (res && res.ok && res.brand && res.brand.logo) { node.setAttribute("src", res.brand.logo); commit(); }
    });

    el("dzIUp").addEventListener("click", () => { if (node.parentElement) select(S.sel.boardId, node.parentElement); });
    el("dzIDup").addEventListener("click", () => {
      const copy = node.cloneNode(true);
      copy.removeAttribute("data-nd-sel");
      node.parentElement && node.parentElement.insertBefore(copy, node.nextSibling);
      commit();
    });
    el("dzIDel").addEventListener("click", () => { node.remove(); commit(); S.sel = null; renderInspect(); });
  }

  function flash(text) {
    const n = el("dzSaved");
    if (!n) return;
    n.textContent = text;
    clearTimeout(n._t);
    n._t = setTimeout(() => { n.textContent = ""; }, 1600);
  }

  // ---------- design → build ----------
  // The artboard is the artefact, so handing it to the coding side is handing over the file. It is
  // written into the project and the agent is asked to build the real thing from it.
  async function useToBuild() {
    const b = board();
    if (!b || !S.doc) return;
    const safe = (S.doc.name + "-" + b.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const rel = `design/${safe}.html`;
    const ok = window.NutaanChat && window.NutaanChat.writeFile
      ? await window.NutaanChat.writeFile(rel, b.html || "")
      : null;
    if (!ok || ok.error) {
      alert("Could not write the design into your project: " + ((ok && ok.error) || "no project open"));
      return;
    }
    sendToAgent(
      `Build this design for real.\n\n` +
      `The approved design is in \`${rel}\` — it is the artboard "${b.name}" from the Design canvas ` +
      `(${b.w}×${b.h}). Read it, then implement it in this project's actual stack and conventions: ` +
      `real components, real routing, responsive, accessible. Match the layout, spacing, type scale and ` +
      `colours; do not redesign it. Tell me which files you changed and how to see it.`
    );
    flash("Handed to the agent");
  }


  // ---------- live agent work ----------
  // "What is it doing?" was the honest complaint: a design takes a while, and an empty canvas with
  // no explanation looks broken. The same agent events the chat renders are shown here, on the
  // right, while a run is in flight — each tool call as it starts, and the artboards appearing the
  // moment they land.
  const LIVE = { on: false, steps: [], text: "" };

  const TOOL_LABEL = {
    design_new: "Starting the design",
    design_artboard: "Drawing an artboard",
    design_update: "Revising an artboard",
    design_verify: "Checking how it renders",
    design_read: "Reading the design so far",
    design_list: "Looking at your designs",
    web_search: "Searching the web",
    web_fetch: "Reading a page",
    read_file: "Reading a file",
    write_file: "Writing a file",
  };

  function liveRenderSide() {
    const box = el("dzSideBody");
    if (!box || !LIVE.on) return;
    const steps = LIVE.steps.slice(-10);
    box.innerHTML =
      `<div class="dz-live-head"><span class="dz-live-dot"></span>Working…</div>` +
      `<div class="dz-live-steps">${steps.map((st, i) => `
          <div class="dz-live-step ${i === steps.length - 1 && !st.done ? "current" : "done"}">
            <span class="dz-live-tick">${st.done ? "✓" : "●"}</span><span>${esc(st.label)}</span>
            ${st.detail ? `<span class="dz-live-detail">${esc(st.detail)}</span>` : ""}
          </div>`).join("")}</div>` +
      (LIVE.text ? `<div class="dz-live-text">${esc(LIVE.text.slice(-700))}</div>` : "");
    box.scrollTop = box.scrollHeight;
  }

  function liveRender() {
    liveRenderSide();
    const holder = el("dzFrameHolder");
    if (!holder || !LIVE.on) return;
    el("dzCode").hidden = true;
    holder.hidden = false;
    const steps = LIVE.steps.slice(-7);
    holder.innerHTML = `
      <div class="dz-live">
        <div class="dz-live-head"><span class="dz-live-dot"></span>Designing…</div>
        <div class="dz-live-steps">
          ${steps.map((s, i) => `
            <div class="dz-live-step ${i === steps.length - 1 && !s.done ? "current" : "done"}">
              <span class="dz-live-tick">${s.done ? "✓" : "●"}</span>
              <span>${esc(s.label)}</span>
              ${s.detail ? `<span class="dz-live-detail">${esc(s.detail)}</span>` : ""}
            </div>`).join("")}
        </div>
        ${LIVE.text ? `<div class="dz-live-text">${esc(LIVE.text.slice(-400))}</div>` : ""}
      </div>`;
  }

  function liveStart() {
    LIVE.on = true;
    LIVE.steps = [];
    LIVE.text = "";
    liveRender();
  }

  function liveStep(label, detail) {
    for (const s of LIVE.steps) s.done = true;
    LIVE.steps.push({ label, detail, done: false });
    liveRender();
  }

  function liveEnd() {
    LIVE.on = false;
    LIVE.text = "";
    renderSide();
    renderBoard();
  }

  function wireLive() {
    const on = window.nutaan.onAgentEvent;
    if (!on) return;
    on("agent:tool-start", ({ name, args }) => {
      if (el("designPage").hidden) return;
      if (!LIVE.on && String(name || "").startsWith("design_")) liveStart();
      if (!LIVE.on) return;
      let detail = "";
      try {
        const a = typeof args === "string" ? JSON.parse(args) : args || {};
        detail = a.name || a.artboard_id || a.query || "";
      } catch {}
      liveStep(TOOL_LABEL[name] || name, detail);
    });
    on("agent:tool-result", ({ name }) => {
      if (!LIVE.on) return;
      for (const s of LIVE.steps) s.done = true;
      liveRender();
      // An artboard just landed — show it immediately rather than at the end of the turn.
      if (name === "design_artboard" || name === "design_update") refreshOpen();
    });
    on("agent:assistant-delta", ({ content }) => {
      if (!LIVE.on) return;
      LIVE.text += content || "";
      liveRender();
    });
    on("agent:done", () => { if (LIVE.on) liveEnd(); });
    on("agent:error", () => { if (LIVE.on) liveEnd(); });
  }

  // Re-read the open design and repaint, keeping the tab the user is looking at if it still exists.
  async function refreshOpen() {
    if (!S.doc) return;
    let doc;
    try { doc = await api().read(S.doc.id); } catch { return; }
    if (!doc || doc.error) return;
    const had = S.doc.artboards.length;
    S.doc = doc;
    if (!S.tab || !doc.artboards.some((b) => b.id === S.tab)) {
      S.tab = (doc.artboards[doc.artboards.length - 1] || {}).id || null;
    } else if (doc.artboards.length > had) {
      // Something new arrived: show it.
      S.tab = doc.artboards[doc.artboards.length - 1].id;
    }
    renderBar();
    if (LIVE.on) liveRenderSide();
    else { renderSide(); renderBoard(); }
  }

  // ---------- wiring ----------
  function wire() {
    el("dzKinds").addEventListener("click", (e) => {
      const b = e.target.closest(".dz-kind");
      if (!b) return;
      S.kind = KINDS.find((k) => k.id === b.dataset.kind) || KINDS[0];
      renderKinds();
      el("dzPromptText").focus();
    });

    const send = () => {
      const text = el("dzPromptText").value.trim();
      if (!text) return;
      el("dzPromptText").value = "";
      sendToAgent(designPrompt(text));
      liveStart();
      flash("Designing…");
    };
    el("dzSend").addEventListener("click", send);
    el("dzPromptText").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    const follow = () => {
      const text = el("dzFollowUp").value.trim();
      if (!text) return;
      el("dzFollowUp").value = "";
      sendToAgent(designPrompt(text, { follow: true }));
      liveStart();
      flash("Working…");
    };
    el("dzFollowSend").addEventListener("click", follow);
    el("dzFollowUp").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); follow(); }
    });

    el("dzNew").addEventListener("click", async () => {
      const doc = await api().create({ name: "Untitled design" });
      await loadList();
      open(doc.id);
    });
    el("dzBackToLibrary").addEventListener("click", async () => { showWork(false); await loadList(); });

    el("dzLibrary").addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del]");
      if (del) {
        e.stopPropagation();
        if (confirm("Delete this design and its artboards?")) { await api().remove(del.dataset.del); loadList(); }
        return;
      }
      const card = e.target.closest(".dz-card");
      if (card) open(card.dataset.id);
    });

    // Adding an artboard now lives with the artboard list on the left.
    el("dzSideBody").addEventListener("click", async (e) => {
      if (!e.target.closest("#dzAddBoard")) return;
      const preset = el("dzPreset").value || S.kind.preset;
      const nb = await api().addArtboard(S.doc.id, {
        name: (S.presets.find((p) => p.id === preset) || {}).label || "Artboard",
        preset,
        html: `<div style="display:grid;place-items:center;height:100%;color:#9aa0ac;font:500 15px system-ui">Empty artboard — ask below</div>`,
      });
      S.doc = await api().read(S.doc.id);
      S.tab = nb.id;
      renderBar(); renderSide(); renderBoard();
    });

    el("dzSideBody").addEventListener("click", (e) => {
      const row = e.target.closest(".dz-side-row");
      if (!row) return;
      S.tab = row.dataset.id;
      S.sel = null;
      renderBar(); renderSide(); renderBoard(); renderInspect();
    });

    el("dzViewMode").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      S.mode = b.dataset.mode;
      for (const x of el("dzViewMode").querySelectorAll("button")) x.classList.toggle("active", x === b);
      renderBoard();
    });
    el("dzDevice").addEventListener("change", (e) => { S.device = e.target.value; S.zoom = 1; renderBoard(); });
    el("dzZoomIn").addEventListener("click", () => { S.zoom = clamp(S.zoom * 1.2, 0.2, 4); renderBoard(); });
    el("dzZoomOut").addEventListener("click", () => { S.zoom = clamp(S.zoom / 1.2, 0.2, 4); renderBoard(); });

    el("dzName").addEventListener("change", async (e) => {
      if (!S.doc) return;
      await api().rename(S.doc.id, e.target.value);
      flash("Renamed");
      loadList();
    });

    el("dzUseToBuild").addEventListener("click", useToBuild);

    el("dzExport").addEventListener("click", async () => {
      const b = board();
      if (!b) return;
      const fmt = el("dzFormat").value;
      if (fmt === "html") {
        const ok = window.NutaanChat && window.NutaanChat.writeFile
          ? await window.NutaanChat.writeFile(`design/${b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`, b.html || "")
          : null;
        flash(ok && !ok.error ? "Saved into your project" : "Could not save");
        return;
      }
      const res = await api().export({ id: S.doc.id, boardId: b.id, format: fmt, scale: 2 });
      if (res && res.ok) flash("Exported");
      else if (res && !res.canceled) alert(res.error || "export failed");
    });

    window.addEventListener("resize", () => { if (S.doc && !el("dzWork").hidden) renderBoard(); });

  }

  // Registered at load, not when the page is first opened: the agent can start designing from a
  // plain chat message, and the tab has to come forward on its own when it does. Wiring this
  // inside the page's own setup meant it only worked if you had already been to the Design tab.
  function watchAgent() {
    if (!window.nutaan || !window.nutaan.onAutonomousEvent) return;
    window.nutaan.onAutonomousEvent("design:opened", async ({ id, focus }) => {
      const row = [...document.querySelectorAll(".nav-row")].find((r) => r.textContent.trim() === "Design");
      if (row && el("designPage") && el("designPage").hidden) row.click();
      // Boot the page before opening into it — onShow decides which view to show, so it has to
      // run first or it would put us back on the home screen.
      await window.NutaanDesign.onShow();
      await open(id, focus);
      await loadList();
    });
    wireLive();
  }

  window.NutaanDesign = {
    async onShow() {
      if (!api()) return;
      if (!S.booted) {
        S.booted = true;
        S.presets = (await api().presets()) || [];
        el("dzPreset").innerHTML = S.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} · ${p.w}×${p.h}</option>`).join("");
        renderKinds();
        wire();
      }
      const s = window.NutaanSettings ? window.NutaanSettings() : null;
      el("dzModel").textContent = (s && s.model) || "";
      await loadList();
      // Deterministic: the workspace is only up when a design is actually open. Anything else —
      // a fresh launch, coming back after closing one — lands on the home screen.
      const inWork = !!(S.doc && S.tab);
      showWork(inWork);
      if (inWork) { renderBar(); renderSide(); renderBoard(); }
    },
    onHide() {},
    // Someone asked for a design while a project is open: this is how the chat side hands it over.
    startFrom(text, kindId) {
      S.kind = KINDS.find((k) => k.id === kindId) || S.kind;
      renderKinds();
      sendToAgent(designPrompt(text));
    },
  };

  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(watchAgent, 0);
  else document.addEventListener("DOMContentLoaded", watchAgent);
})();
