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
    { id: "website", label: "Website", preset: "desktop", icon: "▦", playbook: "website",
      ask: "a complete multi-page website, as a clickable prototype. Decide the pages it needs from the subject " +
           "(a cafe: Home, Menu, About, Visit; a SaaS: Home, Product, Pricing, Docs, Contact — never fewer than " +
           "three) and draw one artboard PER PAGE, each a full page top to bottom with the same header and footer. " +
           "Wire the navigation: every link to another page is <a href=\"#page:Page Name\"> using that artboard's " +
           "exact name, so clicking it in the canvas opens that page. Draw the home page first and verify it before " +
           "the others so the world is settled" },
    { id: "ui", label: "UI mockup", preset: "desktop", icon: "▢", playbook: "interface",
      ask: "a screen design, as one self-contained HTML artboard — real content and a real hierarchy, not " +
           "lorem ipsum in generic cards" },
    { id: "mobile", label: "Mobile app", preset: "mobile", icon: "▯", playbook: "interface",
      ask: "a mobile app screen at 390×844, as one self-contained HTML artboard — thumb-reachable actions, " +
           "44px minimum touch targets, a real status bar and a real hierarchy" },
    { id: "dashboard", label: "Dashboard", preset: "desktop", icon: "▥", playbook: "dashboard",
      ask: "an analytics dashboard. Decide the one decision it supports and the metric that drives it, then lay " +
           "it out in zones: quiet nav and a last-updated stamp; the driving metric given the most room as a real " +
           "chart with its current value read off it (not the big-number-small-label tile); 3–5 supporting KPIs " +
           "(every number with a comparison — vs last period, vs target, or a trend), a wide primary chart " +
           "beside a narrower secondary one, and a breakdown table under them. Charts are inline SVG with real " +
           "computed paths, gridlines and axis labels — never an image placeholder or a grey box. 5–9 metrics " +
           "total, one accent colour with greys everywhere else, and tiles that are deliberately not all the " +
           "same size, because that uniform grid is what makes a dashboard look generated" },
    { id: "wireframe", label: "Wireframe", preset: "desktop", icon: "▤",
      ask: "a low-fidelity wireframe — greyscale, boxes and placeholder type, no colour or imagery" },
    { id: "deck", label: "Slide deck", preset: "slide", icon: "▭", playbook: "presentation",
      ask: "a slide deck that carries an argument. Write the storyline first as action titles — each title is " +
           "the finding the slide proves ('Revenue grew 24% — entirely from enterprise renewals', not 'Q3 " +
           "Revenue'), under 15 words. Read them in order and make sure they argue. Then one artboard PER SLIDE " +
           "at 1920×1080: title, the answer up front, 3–5 supporting slides, a close. One idea per slide, under " +
           "40 words of body, titles at 40–54px on the same baseline every slide, a 96px outer margin everywhere, " +
           "one typeface, one accent marking exactly one thing per slide. Vary the slide type — statement, big " +
           "number, chart, two-column, comparison, quote — never eleven copies of title-plus-bullets" },
    { id: "doc", label: "Document", preset: "a4", icon: "▣", playbook: "document",
      ask: "a typeset document on A4 pages. One artboard PER PAGE at 1240×1754, with real editorial typography: " +
           "a measure of 60–75 characters, a heading scale that actually steps, generous leading at 1.55–1.65, " +
           "footnotes and page furniture" },
    { id: "paper", label: "Research paper", preset: "a4", icon: "☰", playbook: "document",
      ask: "an academic paper on A4 pages, one artboard PER PAGE: title block with authors and abstract, two-column body, numbered sections, figures with captions, and a references list" },
    { id: "motion", label: "Motion video", preset: "video", icon: "▶", playbook: "motion-video",
      ask: "a motion-graphics video: one artboard at 1920×1080 that is a timed scene, not a page. Every movement is a " +
           "CSS animation with an absolute delay on a shared timeline, body carries data-duration in ms, and the still " +
           "at any instant is a finished frame. Use design_takes to see Demo Studio screen recordings and place one " +
           "with {{take:Name}} where the product should appear. When it verifies clean, call design_export_video so I " +
           "get the file" },
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
        `(or design_artboard for a genuinely new screen). Read the brand back too and keep using it. Refinement ` +
        `preserves: change what I asked for and nothing else. If I named one of impeccable's commands — polish, ` +
        `critique, audit, bolder, quieter, distill, harden, animate, colorize, typeset, layout, delight, clarify, ` +
        `adapt — load its playbook with use_skill({ id: "impeccable", file: "reference/<command>.md" }) and follow it.

` +
        `Then design_verify every artboard you touched and fix what it finds, repeating until it comes back clean.`;
    }
    const playbook = k.playbook || "interface";
    return `Design ${k.ask}.\n\n${text}\n\n` +
      `Two skills govern this and neither is optional. First use_skill "impeccable" — the taste: pick the mode, commit ` +
      `to a visual world, and read its reference/craft-floor.md before the first artboard. Then use_skill "nutaan-design" ` +
      `— the method: read my words, any image I attached and the open project before deciding what this is; ask me ONE ` +
      `question only if the subject itself is unclear (then stop and wait for my answer); write the brief; and follow ` +
      `its reference/${playbook}.md for this kind of work` +
      (k.id === "website" ? `, plus reference/motion.md once the pages are designed` : ``) + `.\n\n` +
      `Then design_new with a name and the brief (audience, mode, world, tokens — a spacing scale, a type scale of at ` +
      `most six sizes, one radius, one shadow depth, one typeface — the copy that matters, what any attached image is ` +
      `for, which project files it draws from). Then design_brand: use the brand if set; otherwise pick a palette that ` +
      `fits (mine if I named colours), save it with "set", and carry on — never stop to ask about colours.\n\n` +
      `Then build each screen or page so I can watch it appear: design_artboard with preset "${k.preset}" holding ` +
      `only the document shell — <head> with the <style> (tokens as CSS variables, the type scale, every class the ` +
      `sections will use) and the header/nav — then ONE design_append per section in reading order (hero, then the ` +
      `next section, … footer), each a complete block. Never write a whole page in one call. Real copy about the ` +
      `actual subject, no external files (the motion module named in reference/motion.md is the one exception). ` +
      `When every section is in, call design_verify and look at what it returns; fix what it finds with design_update ` +
      `in one batch and verify again, at most twice. Do not tell me it is done before verify is clean. Then one line ` +
      `on what you made, naming any decision you took on my behalf.`;
  }

  function sendToAgent(prompt, title) {
    if (window.NutaanChat && window.NutaanChat.send) window.NutaanChat.send(prompt, { title });
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
      `<div class="st-note dz-hint">Click anything in the preview to select it — text, colour, type, spacing and size are all editable, and every change is written into the design the agent reads next. A link to another page opens that page.</div>`;
    wireBrand();
  }

  function deviceWidth() {
    return { desktop: 1440, laptop: 1280, tablet: 834, mobile: 390 }[S.device] || 0;
  }

  function renderBoard() {
    // An artboard streaming in from the agent takes the canvas: you watch it being drawn, the way
    // code appears while it is typed. The saved board comes back the moment the stream lands.
    const live = LIVE.on && liveBoard();
    const b = live || board();
    const holder = el("dzFrameHolder");
    const code = el("dzCode");
    if (!b) {
      holder.innerHTML = LIVE.on
        ? `<div class="page-empty dz-live-wait"><span class="dz-live-dot"></span>The first artboard appears here as it is drawn</div>`
        : `<div class="page-empty">No artboard yet.</div>`;
      return;
    }

    if (S.mode === "code" && !live) {
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

    // While streaming, keep the frame and only swap its document: rebuilding the board every few
    // hundred milliseconds makes the whole canvas flash.
    // Play runs scripts in an origin-less frame; Preview keeps same-origin so the inspector can edit.
    const play = S.mode === "play" && !live;
    let frame = holder.querySelector(`.dz-board[data-live="${live ? "1" : "0"}"][data-play="${play ? "1" : "0"}"] .dz-frame`);
    if (!frame) {
      holder.innerHTML = `<div class="dz-board" data-live="${live ? "1" : "0"}" data-play="${play ? "1" : "0"}" style="width:${w}px;height:${b.h}px;transform:scale(${scale})">
          <div class="dz-board-label"></div>
          <div class="dz-board-frame"></div>
          <span class="dz-h tl"></span><span class="dz-h tr"></span><span class="dz-h bl"></span><span class="dz-h br"></span>
          <iframe class="dz-frame" sandbox="${play ? "allow-scripts" : "allow-same-origin"}" scrolling="no"></iframe>
        </div>`;
      frame = holder.querySelector(".dz-frame");
    } else {
      const boardEl = frame.closest(".dz-board");
      boardEl.style.width = w + "px";
      boardEl.style.height = b.h + "px";
      boardEl.style.transform = `scale(${scale})`;
    }
    const label = holder.querySelector(".dz-board-label");
    label.innerHTML = live
      ? `<span class="dz-live-dot"></span>${esc(b.name)}${live.part ? ` <span class="dz-board-part">· drawing ${esc(live.part)}</span>` : ""}`
      : esc(b.name);
    frame.srcdoc = wrapHtml(b, w);
    if (!live && !play) frame.addEventListener("load", () => bindFrame(frame, b.id), { once: true });
  }

  // The artboard as it stands mid-stream, shaped like a saved one so the same painter draws it.
  // A revision streams over the board it replaces; a new artboard borrows its preset's size.
  function liveBoard() {
    const s = LIVE.stream;
    if (!s || !s.html) return null;
    const existing = s.artboardId && S.doc && S.doc.artboards.find((x) => x.id === s.artboardId);
    const preset = (S.presets || []).find((p) => p.id === s.preset) || (S.presets || []).find((p) => p.id === "desktop");
    return {
      id: "live",
      name: s.name || (existing && existing.name) || "Artboard",
      html: s.html,
      w: (existing && existing.w) || (preset && preset.w) || 1440,
      h: (existing && existing.h) || (preset && preset.h) || 900,
      part: s.part,
    };
  }

  // {{take:Name}} in a scene is a Demo Studio recording; the canvas resolves it the way the
  // exporter does, through the app's own media scheme, so Play shows the real footage.
  S.takes = S.takes || null;
  function resolveTakes(html) {
    if (!S.takes || !/{{take:/.test(html)) return html;
    return html.replace(/{{take:([^}]+)}}/g, (m, key) => {
      const k = key.trim().toLowerCase();
      const t = S.takes.find((x) => x.id === key.trim() || String(x.name).toLowerCase() === k);
      return t ? `nutaan-media://take/${encodeURIComponent(t.id)}` : m;
    });
  }
  function wrapHtml(b, width) {
    const html = resolveTakes(b.html || "");
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
    if (S.mode === "play") {
      // Scripts run in Play, in a frame with no origin: it cannot reach this window or the IPC
      // bridge. Page links are relayed out with postMessage, which is all the parent listens for.
      return body.replace(/<\/body>/i, `<script>
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (/^https?:/i.test(href)) { e.preventDefault(); return; }
    if (/^#page:/i.test(href) || /^[a-z0-9./-]+$/i.test(href)) {
      e.preventDefault();
      parent.postMessage({ nutaanPage: href }, "*");
    }
  }, true);
<\/script></body>`);
    }
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
    d.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      // A link to another artboard is the prototype: clicking "Menu" in the nav opens the Menu
      // page, the way it would on the real site. Anything else is a selection for editing.
      const a = e.target.closest && e.target.closest("a[href]");
      const target = a && pageLinkTarget(a.getAttribute("href"));
      if (target) { showTab(target.id); return; }
      select(boardId, e.target);
    }, true);
  }

  // "#page:Menu" names an artboard exactly; "menu.html" / "/menu" / "#menu" match one by name, so
  // links written the ordinary way still navigate when a page of that name exists.
  function pageLinkTarget(href) {
    if (!S.doc || !href) return null;
    const boards = S.doc.artboards;
    const norm = (s) => String(s || "").toLowerCase().replace(/\.html?$/, "").replace(/[^a-z0-9]+/g, "");
    const m = href.match(/^#page:(.+)$/i);
    if (m) {
      const want = norm(decodeURIComponent(m[1]));
      return boards.find((b) => norm(b.name) === want) || null;
    }
    const slug = norm(href.replace(/^[./#]+/, "").split(/[?#]/)[0]);
    if (!slug || slug === "index" || slug === "home") return boards.find((b) => /home|index/i.test(b.name)) || null;
    return boards.find((b) => norm(b.name) === slug) || null;
  }

  function showTab(id) {
    if (!S.doc || !S.doc.artboards.some((b) => b.id === id)) return;
    S.tab = id;
    S.sel = null;
    renderBar(); renderSide(); renderBoard(); renderInspect();
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
    design_artboard: "Drawing",
    design_update: "Revising",
    design_append: "Adding a section",
    design_verify: "Checking how it renders",
    design_read: "Reading the design so far",
    design_list: "Looking at your designs",
    design_brand: "Setting the brand",
    design_export: "Exporting",
    use_skill: "Loading design rules",
    list_skills: "Looking up design rules",
    web_search: "Searching the web",
    web_fetch: "Reading a page",
    read_file: "Reading a file",
    write_file: "Writing a file",
  };

  // What the step line says. A raw tool name and an opaque id tell you nothing; the point of a
  // live view is that you can see which artboard is being drawn and what is going onto it.
  function stepDetail(name, args) {
    let a = {};
    try { a = typeof args === "string" ? JSON.parse(args) : args || {}; } catch {}
    const named = (id) => {
      if (!id || !S.doc) return "";
      const b = S.doc.artboards.find((x) => x.id === id);
      return b ? b.name : "";
    };
    if (name === "design_verify") return named(a.artboard_id) || a.name || "";
    if (name === "design_update") return named(a.artboard_id) || a.name || "";
    if (name === "design_append") { const m = String(a.html || "").match(/<(section|header|nav|footer|main|aside)\b[^>]*?(?:id|class|aria-label)="([^"]+)"/i); return (m ? m[2].split(/\s+/)[0] : "") || named(a.artboard_id); }
    if (name === "design_artboard") return a.name || a.preset || "";
    if (name === "design_new") return a.name || "";
    if (name === "use_skill" || name === "list_skills") return a.id || a.skill || "";
    return a.name || a.query || a.path || "";
  }

  function stepsHtml(steps) {
    return steps.map((st, i) => `
      <div class="dz-live-step ${i === steps.length - 1 && !st.done ? "current" : "done"}">
        <span class="dz-live-tick">${st.done ? "✓" : "●"}</span><span>${esc(st.label)}</span>
        ${st.detail ? `<span class="dz-live-detail">${esc(st.detail)}</span>` : ""}
        ${st.n > 1 ? `<span class="dz-live-n">×${st.n}</span>` : ""}
      </div>`).join("");
  }

  // The one place progress is written up: the steps so far, and — while an artboard streams —
  // the parts of it drawn so far with the current one lit. The canvas shows the artboard itself;
  // it does not repeat this list.
  function liveRenderSide() {
    const box = el("dzSideBody");
    if (!box || !LIVE.on) return;
    const s = LIVE.stream;
    const parts = s && s.parts && s.parts.length
      ? `<div class="dz-live-parts"><div class="dz-live-parts-h">Drawing ${esc(s.name || "the artboard")}</div>` +
        s.parts.map((p, i) => `<span class="dz-live-part${i === s.parts.length - 1 ? " current" : ""}">${esc(p)}</span>`).join("") +
        `</div>`
      : "";
    box.innerHTML =
      `<div class="dz-live-head"><span class="dz-live-dot"></span>Working…</div>` +
      `<div class="dz-live-steps">${stepsHtml(LIVE.steps.slice(-12))}</div>` +
      parts +
      (LIVE.text ? `<div class="dz-live-text">${esc(LIVE.text.slice(-700))}</div>` : "");
    box.scrollTop = box.scrollHeight;
  }

  function liveRender() {
    liveRenderSide();
    if (LIVE.on) renderBoard();
  }

  function liveStart() {
    LIVE.on = true;
    LIVE.steps = [];
    LIVE.text = "";
    LIVE.stream = null;
    liveRender();
  }

  // Which part of the screen is being drawn right now, read off the HTML as it streams: the
  // landmarks and sections in the order they were opened, named by what the markup calls them.
  // "Drawing pricing" tells you where the agent is; a byte count does not.
  const PART_TAG = /<(section|header|nav|footer|aside|main|form|table|article|dialog)\b([^>]*)>|<!--\s*([^\n]{2,40}?)\s*-->/gi;
  function partsOf(html) {
    const out = [];
    let m;
    PART_TAG.lastIndex = 0;
    while ((m = PART_TAG.exec(html))) {
      let name;
      if (m[3]) {
        name = m[3].replace(/^\/?\s*(end|start)\b:?\s*/i, "");
      } else {
        const attrs = m[2] || "";
        const pick = (re) => { const a = attrs.match(re); return a ? a[1] : ""; };
        name = pick(/aria-label="([^"]+)"/i) || pick(/\bid="([^"]+)"/i) || (pick(/\bclass="([^"]+)"/i).split(/\s+/)[0] || "") || m[1];
        name = name.replace(/[-_]+/g, " ").replace(/\b(section|wrap|wrapper|container|inner)\b/gi, "").trim() || m[1];
      }
      name = name.toLowerCase();
      if (name && out[out.length - 1] !== name) out.push(name);
    }
    return out.slice(-8);
  }

  // Paint at most a few times a second: every chunk is a few characters, and a canvas reflow
  // per chunk would fight the stream it is meant to show.
  let streamTimer = null;
  function liveStream({ name, path, text, done, preset, artboardId }) {
    if (!LIVE.on) liveStart();
    const parts = partsOf(text);
    LIVE.stream = { tool: name, name: path || (LIVE.stream && LIVE.stream.name) || "", html: text, preset, artboardId, parts, part: parts[parts.length - 1] || "" };
    if (done) {
      clearTimeout(streamTimer); streamTimer = null;
      liveRender();
      return;
    }
    if (streamTimer) return;
    streamTimer = setTimeout(() => { streamTimer = null; liveRender(); }, 350);
  }

  function liveStep(label, detail) {
    for (const s of LIVE.steps) s.done = true;
    const last = LIVE.steps[LIVE.steps.length - 1];
    // "Reading the design so far" three times in a row is noise, not progress.
    if (last && last.label === label && last.detail === detail) {
      last.n = (last.n || 1) + 1;
      last.done = false;
    } else {
      LIVE.steps.push({ label, detail, done: false, n: 1 });
    }
    liveRender();
  }

  function liveEnd() {
    LIVE.on = false;
    LIVE.chatId = null;
    LIVE.text = "";
    LIVE.stream = null;
    clearTimeout(streamTimer); streamTimer = null;
    renderSide();
    renderBoard();
  }

  function wireLive() {
    if (!window.nutaan.onAgentEvent) return;
    // Several chats can run at once; the live view follows the one that started drawing, and
    // another chat finishing must not end it.
    const on = (channel, fn) => window.nutaan.onAgentEvent(channel, (ev) => {
      if (LIVE.on && LIVE.chatId && ev && ev.chatId && ev.chatId !== LIVE.chatId) return;
      fn(ev || {});
    });
    on("agent:tool-start", ({ name, args, chatId }) => {
      if (el("designPage").hidden) return;
      if (!LIVE.on && String(name || "").startsWith("design_")) { liveStart(); LIVE.chatId = chatId || null; }
      if (!LIVE.on) return;
      liveStep(TOOL_LABEL[name] || name, stepDetail(name, args));
    });
    on("agent:tool-arg-stream", (ev) => {
      if (el("designPage").hidden) return;
      if (ev.name === "design_artboard" || ev.name === "design_update") { liveStream(ev); if (!LIVE.chatId) LIVE.chatId = ev.chatId || null; }
    });
    on("agent:tool-result", ({ name }) => {
      if (!LIVE.on) return;
      for (const s of LIVE.steps) s.done = true;
      // The streamed draft is superseded by the saved artboard, which lands right after.
      if (name === "design_artboard" || name === "design_append" || name === "design_update" || name === "design_verify") {
        LIVE.stream = null;
        clearTimeout(streamTimer); streamTimer = null;
        refreshOpen(); // verify can grow the artboard to fit the page
      }
      liveRender();
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
      sendToAgent(designPrompt(text), text);
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
      sendToAgent(designPrompt(text, { follow: true }), text);
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
      showTab(row.dataset.id);
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
      flash(fmt === "zip" ? "Rendering every artboard…" : /^video/.test(fmt) ? "Filming the scene — this takes about as long as the video…" : "Rendering…");
      const res = await api().export({ id: S.doc.id, boardId: b.id, format: fmt, scale: 2 });
      if (res && res.ok) flash(fmt === "zip" ? "Zip saved — open index.html for the prototype" : /^video/.test(fmt) ? `Video saved — ${Math.round(res.seconds || 0)}s, in your Videos folder` : "Exported");
      else if (res && !res.canceled) alert(res.error || "export failed");
    });

    window.addEventListener("resize", () => { if (S.doc && !el("dzWork").hidden) renderBoard(); });
    window.addEventListener("message", (e) => {
      const href = e.data && typeof e.data.nutaanPage === "string" ? e.data.nutaanPage : null;
      if (!href || S.mode !== "play") return;
      const t = pageLinkTarget(href);
      if (t) showTab(t.id);
    });

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
        try { S.takes = (await api().takes()) || []; } catch { S.takes = []; }
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
