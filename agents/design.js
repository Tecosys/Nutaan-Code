// Design — a canvas that lives inside Nutaan Code. No clone, no package manager, no daemon, no
// second app to install: a design is a JSON file holding artboards, each artboard is an HTML
// document, and the agent writes them with the model the user already chose.
//
// That choice is what makes it work everywhere. There is nothing to go wrong on a machine without
// Node 24 or pnpm, nothing to keep up to date, and nothing to start before the Design tab is
// useful — the same way the rest of this app behaves.
//
// Exporting is the one place we borrow from Electron rather than shipping a library: an offscreen
// window renders the artboard and gives back a PNG or a PDF. Both are built in.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const MAX_HTML_BYTES = 1_500_000;

// The sizes people actually design at, so "make me a landing page" lands on a sensible canvas
// instead of asking the user for dimensions.
const PRESETS = {
  desktop: { w: 1440, h: 900, label: "Desktop" },
  laptop: { w: 1280, h: 800, label: "Laptop" },
  tablet: { w: 834, h: 1112, label: "Tablet" },
  mobile: { w: 390, h: 844, label: "Mobile" },
  slide: { w: 1920, h: 1080, label: "Slide" },
  square: { w: 1080, h: 1080, label: "Social square" },
  story: { w: 1080, h: 1920, label: "Story" },
  a4: { w: 1240, h: 1754, label: "A4 page" },
  email: { w: 640, h: 1200, label: "Email" },
};

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function safeId(id) {
  return typeof id === "string" && /^[a-z0-9-]{4,64}$/i.test(id) ? id : null;
}

class Design {
  constructor({ userDataDir, emit, log } = {}) {
    this.dir = path.join(userDataDir || ".", "designs");
    this.emit = emit || (() => {});
    this.log = log || (() => {});
    this.openId = null;
    // artboardId -> how many verify rounds it has had. A fix loop that cannot converge has to
    // stop somewhere, and the tool tells the agent where it is.
    this.rounds = new Map();
  }

  ensureDir() {
    fsSync.mkdirSync(this.dir, { recursive: true });
    return this.dir;
  }
  file(id) {
    return path.join(this.ensureDir(), `${id}.json`);
  }

  presets() {
    return Object.entries(PRESETS).map(([id, p]) => ({ id, ...p }));
  }

  async list() {
    this.ensureDir();
    let names = [];
    try { names = await fs.readdir(this.dir); } catch { return []; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const d = JSON.parse(await fs.readFile(path.join(this.dir, n), "utf8"));
        out.push({
          id: d.id, name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt,
          artboards: (d.artboards || []).length,
          brief: (d.brief || "").slice(0, 140),
          thumb: d.thumb || "",
        });
      } catch {}
    }
    out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return out;
  }

  async read(id) {
    const safe = safeId(id);
    if (!safe) throw new Error("bad design id");
    try {
      return JSON.parse(await fs.readFile(this.file(safe), "utf8"));
    } catch (err) {
      // A design that was deleted (or never existed) is a normal thing to ask for — the canvas
      // recovers by going back to the list. Only the id is reported, never a raw ENOENT path.
      if (this.openId === safe) this.openId = null;
      throw new Error("that design no longer exists");
    }
  }

  async write(doc) {
    doc.updatedAt = Date.now();
    await fs.writeFile(this.file(doc.id), JSON.stringify(doc, null, 2), "utf8");
    this.emit("design:changed", { id: doc.id });
    return doc;
  }

  async create({ name, brief } = {}) {
    const doc = {
      id: uid("dsn-"),
      name: (name || "Untitled design").slice(0, 80),
      brief: (brief || "").slice(0, 4000),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      canvas: { zoom: 0.6, panX: 0, panY: 0 },
      // The brand is part of the design, not a prompt someone has to remember to repeat. Empty
      // until it is set or asked for — the agent is told to ask rather than invent one.
      brand: { primary: "", secondary: "", accent: "", bg: "", text: "", font: "", logo: "", logoAlt: "" },
      artboards: [],
    };
    await this.write(doc);
    this.openId = doc.id;
    return doc;
  }

  async remove(id) {
    const safe = safeId(id);
    if (!safe) return { ok: false };
    try { await fs.unlink(this.file(safe)); } catch {}
    if (this.openId === safe) this.openId = null;
    this.emit("design:changed", { id: safe, removed: true });
    return { ok: true };
  }

  // Lay a new artboard down to the right of the last one, so a design grows into a strip the user
  // can read left to right rather than a pile at the origin.
  placeNext(doc, w, h) {
    if (!doc.artboards.length) return { x: 0, y: 0 };
    let right = -Infinity;
    let top = 0;
    for (const a of doc.artboards) {
      if (a.x + a.w > right) { right = a.x + a.w; top = a.y; }
    }
    return { x: right + 120, y: top };
  }

  // The agent writes {{logo}} where the logo goes; it is substituted here so each artboard stays
  // self-contained without the model having to carry a base64 blob through the conversation.
  withBrand(doc, html) {
    const logo = (doc.brand && doc.brand.logo) || "";
    let out = String(html || "");
    if (logo) out = out.split("{{logo}}").join(logo);
    else out = out.split("{{logo}}").join("data:image/svg+xml;base64," +
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" rx="8" fill="#e5e7eb"/><text x="80" y="25" font-family="sans-serif" font-size="13" fill="#6b7280" text-anchor="middle">logo</text></svg>').toString("base64"));
    return out;
  }

  async addArtboard(id, { name, preset, width, height, html } = {}) {
    const doc = await this.read(id);
    const p = PRESETS[preset] || PRESETS.desktop;
    const w = Math.max(160, Math.min(4000, Number(width) || p.w));
    const h = Math.max(160, Math.min(6000, Number(height) || p.h));
    const at = this.placeNext(doc, w, h);
    const board = {
      id: uid("ab-"),
      name: (name || p.label).slice(0, 60),
      preset: PRESETS[preset] ? preset : "custom",
      x: at.x, y: at.y, w, h,
      html: this.withBrand(doc, html).slice(0, MAX_HTML_BYTES),
      updatedAt: Date.now(),
    };
    doc.artboards.push(board);
    await this.write(doc);
    this.queueThumb(id);
    return board;
  }

  async setArtboard(id, boardId, patch = {}) {
    const doc = await this.read(id);
    const b = doc.artboards.find((x) => x.id === boardId);
    if (!b) throw new Error("no such artboard");
    if (typeof patch.html === "string") b.html = this.withBrand(doc, patch.html).slice(0, MAX_HTML_BYTES);
    if (typeof patch.name === "string") b.name = patch.name.slice(0, 60);
    for (const k of ["x", "y", "w", "h"]) if (typeof patch[k] === "number") b[k] = Math.round(patch[k]);
    b.updatedAt = Date.now();
    await this.write(doc);
    this.queueThumb(id);
    return b;
  }

  async removeArtboard(id, boardId) {
    const doc = await this.read(id);
    doc.artboards = doc.artboards.filter((x) => x.id !== boardId);
    await this.write(doc);
    return { ok: true };
  }

  async setCanvas(id, canvas) {
    const doc = await this.read(id);
    doc.canvas = { ...doc.canvas, ...canvas };
    await this.write(doc);
    return doc.canvas;
  }

  async setBrand(id, patch = {}) {
    const doc = await this.read(id);
    doc.brand = { ...(doc.brand || {}), ...patch };
    // A logo is stored with the design as a data URI: an artboard has to be self-contained, and a
    // path to a file on this machine would not survive an export or reach anyone else.
    if (typeof patch.logo === "string" && patch.logo && !/^data:image\//.test(patch.logo)) {
      delete doc.brand.logo;
    }
    await this.write(doc);
    return doc.brand;
  }

  brandSummary(doc) {
    const b = doc.brand || {};
    const set = Object.entries({ primary: b.primary, secondary: b.secondary, accent: b.accent, bg: b.bg, text: b.text })
      .filter(([, v]) => v);
    return {
      colours: Object.fromEntries(set),
      font: b.font || "",
      hasLogo: !!b.logo,
      logoAlt: b.logoAlt || "",
      complete: set.length >= 2,
    };
  }

  // A card that shows a grey rectangle tells you nothing about which design it is. The first
  // artboard is rendered small and kept with the design, refreshed in the background whenever the
  // design changes so saving never waits on a screenshot.
  async refreshThumb(id) {
    if (this.thumbBusy && this.thumbBusy.has(id)) return;
    (this.thumbBusy || (this.thumbBusy = new Set())).add(id);
    try {
      const doc = await this.read(id);
      const first = doc.artboards[0];
      if (!first || !first.html) return;
      const png = await this.withArtboardPage(first, async (win, zoom) => {
        const img = await win.webContents.capturePage();
        return img.resize({ width: 480, quality: "good" }).toPNG();
      });
      const fresh = await this.read(id);
      fresh.thumb = "data:image/png;base64," + png.toString("base64");
      await this.write(fresh);
    } catch (err) {
      this.log("thumbnail failed: " + err.message);
    } finally {
      this.thumbBusy.delete(id);
    }
  }

  // Coalesced: a run that writes six artboards should not render six thumbnails.
  queueThumb(id) {
    clearTimeout(this._thumbTimer);
    this._thumbTimer = setTimeout(() => this.refreshThumb(id).catch(() => {}), 1500);
  }

  async rename(id, name) {
    const doc = await this.read(id);
    doc.name = String(name || "").slice(0, 80) || doc.name;
    await this.write(doc);
    return { ok: true, name: doc.name };
  }


  // ---------- verify ----------
  // Writing HTML and declaring it good is not designing. This renders the artboard exactly as it
  // will be exported, measures it, and hands back both a screenshot and a list of what is actually
  // wrong — so the agent can look at its own work instead of assuming.
  //
  // The checks run inside the rendered page, which is the only place the truth lives: real layout,
  // real fonts, real wrapping.
  async verify(id, boardId) {
    const doc = await this.read(id);
    const b = doc.artboards.find((x) => x.id === boardId);
    if (!b) throw new Error("no such artboard");

    return this.withArtboardPage(b, async (win, zoom) => {
      const findings = await win.webContents.executeJavaScript(`(() => {
        const W = ${b.w}, H = ${b.h};
        const out = [];
        const body = document.body;
        const text = (body.innerText || "").trim();

        if (!text && body.querySelectorAll("*").length < 3) {
          out.push({ severity: "high", issue: "The artboard is effectively empty." });
        }

        // Content that runs past the canvas is the single most common failure.
        const de = document.documentElement;
        const overflowX = Math.max(de.scrollWidth, body.scrollWidth) - W;
        const overflowY = Math.max(de.scrollHeight, body.scrollHeight) - H;
        // A few pixels is the page being zoomed to fit the screen, not a design defect.
        if (overflowX > 6) out.push({ severity: "high", issue: "Content is " + overflowX + "px wider than the artboard — it will be cut off.", fix: "Constrain the widest element or reduce its padding." });
        if (overflowY > 6) out.push({ severity: overflowY > H * 0.25 ? "high" : "medium", issue: "Content runs " + overflowY + "px past the bottom of the artboard.", fix: "Shorten it, or add an artboard for the rest." });

        const all = [...body.querySelectorAll("*")];
        // Anything sitting outside the frame entirely.
        let offCanvas = 0;
        const tiny = [];
        const lowContrast = [];
        const parseRgb = (v) => { const m = (v||"").match(/[\\d.]+/g); return m ? m.slice(0,3).map(Number) : null; };
        const lum = (c) => { const a = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2]; };

        const bgOf = (node) => {
          let n = node;
          while (n && n !== document.documentElement) {
            const c = parseRgb(getComputedStyle(n).backgroundColor);
            const alpha = (getComputedStyle(n).backgroundColor.match(/[\\d.]+/g) || [])[3];
            if (c && alpha !== "0") return c;
            n = n.parentElement;
          }
          return [255, 255, 255];
        };

        for (const node of all) {
          const r = node.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right < 0 || r.bottom < 0 || r.left > W + 2) offCanvas++;
          const cs = getComputedStyle(node);
          const own = [...node.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          const fs = parseFloat(cs.fontSize) || 16;
          if (fs < 11) tiny.push({ text: node.textContent.trim().slice(0, 40), px: Math.round(fs) });
          const fg = parseRgb(cs.color);
          if (fg) {
            const bg = bgOf(node);
            const l1 = lum(fg), l2 = lum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            const big = fs >= 24 || (fs >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
            if (ratio < (big ? 3 : 4.5)) {
              lowContrast.push({ text: node.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 10) / 10, px: Math.round(fs) });
            }
          }
        }
        if (offCanvas) out.push({ severity: "medium", issue: offCanvas + " element(s) sit outside the artboard." });
        if (tiny.length) out.push({ severity: "medium", issue: tiny.length + " text element(s) under 11px.", examples: tiny.slice(0, 3) });
        if (lowContrast.length) out.push({ severity: "medium", issue: lowContrast.length + " text element(s) below the WCAG AA contrast ratio.", examples: lowContrast.slice(0, 3), fix: "Lighten the text or darken the background." });

        // The other half of "does it fit": content that stops a third of the way down leaves a dead
        // band, which is what a slide or a page must never have. Measured from where the ink
        // actually starts and ends — the wrapper forces the body to full height, so scrollHeight
        // always reads 100% and would never catch it. A centred layout has balanced gaps and is
        // fine; the defect is a large empty band at the bottom with the content pinned to the top.
        let inkTop = H, inkBottom = 0;
        for (const node of body.querySelectorAll("*")) {
          const r = node.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.top > H * 1.5) continue;
          if (r.top < inkTop) inkTop = Math.max(0, r.top);
          if (r.bottom > inkBottom) inkBottom = r.bottom;
        }
        const bottomGap = H - inkBottom;
        const topGap = Math.max(0, inkTop);
        if (text && bottomGap > H * 0.25 && bottomGap > topGap * 2.5) {
          out.push({
            severity: bottomGap > H * 0.45 ? "high" : "medium",
            issue: "The content stops " + Math.round((inkBottom / H) * 100) + "% down — the bottom " +
                   Math.round((bottomGap / H) * 100) + "% of the artboard is empty.",
            fix: "Make the outermost element fill the frame (min-height:100vh with flex/grid), or add content to balance it."
          });
        }

        const imgs = [...document.images];
        const broken = imgs.filter(i => !i.complete || i.naturalWidth === 0);
        if (broken.length) out.push({ severity: "high", issue: broken.length + " image(s) failed to load.", fix: "Artboards are self-contained — use CSS gradients or inline SVG instead of linking files." });

        const headings = [...body.querySelectorAll("h1,h2,h3")].map(h => h.tagName + ": " + h.textContent.trim().slice(0, 50));
        return {
          size: { w: W, h: H, contentW: Math.max(de.scrollWidth, body.scrollWidth), contentH: Math.max(de.scrollHeight, body.scrollHeight) },
          elements: all.length,
          words: text.split(/\\s+/).filter(Boolean).length,
          headings: headings.slice(0, 6),
          findings: out,
        };
      })()`);

      const png = await this.capture(win, zoom, b, 0.6);
      return {
        ...findings,
        artboard: { id: b.id, name: b.name },
        screenshot: "data:image/png;base64," + png.toString("base64"),
      };
    });
  }


  // A hidden window cannot be made taller than the screen, so a 1080-tall artboard would be laid
  // out at roughly 756 on a laptop and every measurement — and every export — would be wrong.
  // Zooming the page out by exactly the shortfall gives it a real artboard-sized viewport in CSS
  // pixels (100vh means what it should) while the window stays within the display. No debugger is
  // attached: doing that to do the same job took the whole process down.
  async withArtboardPage(board, fn) {
    const { BrowserWindow, screen } = require("electron");
    let work = { width: 1600, height: 900 };
    try { work = screen.getPrimaryDisplay().workAreaSize; } catch {}
    const zoom = Math.min(1, (work.width - 60) / board.w, (work.height - 60) / board.h);
    const win = new BrowserWindow({
      width: Math.max(200, Math.round(board.w * zoom)),
      height: Math.max(200, Math.round(board.h * zoom)),
      useContentSize: true,
      show: false,
      webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        javascript: true, webSecurity: true, zoomFactor: zoom,
      },
    });
    try {
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(this.documentFor(board)));
      try { win.webContents.setZoomFactor(zoom); } catch {}
      // Webfonts and gradients need a beat; a capture that beats the paint is a blank page.
      await new Promise((r) => setTimeout(r, 500));
      return await fn(win, zoom);
    } finally {
      try { win.destroy(); } catch {}
    }
  }

  // The capture comes back at the zoomed size; scale it to what was asked for.
  async capture(win, zoom, board, scale) {
    const img = await win.webContents.capturePage();
    const want = Math.round(board.w * Math.min(2, scale || 1));
    if (Math.abs(img.getSize().width - want) < 4) return img.toPNG();
    return img.resize({ width: want, quality: "best" }).toPNG();
  }

  // One wrapper so every artboard renders the same in the canvas and in the export.
  documentFor(board) {
    const html = board.html || "";
    if (/<html[\s>]/i.test(html)) return html;
    return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=${board.w}, initial-scale=1" />
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${board.w}px;min-height:${board.h}px;background:#fff;
    font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
    color:#0f1117;-webkit-font-smoothing:antialiased}
  img{max-width:100%}
</style></head><body>${html}</body></html>`;
  }
}

module.exports = { Design, PRESETS };
