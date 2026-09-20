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

// A zip writer in forty lines rather than a dependency: the format is a list of deflated entries
// followed by a central directory, and zlib already does the deflating. archiver is only here
// through electron-builder, which the packaged app does not ship.
const zlib = require("node:zlib");
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipFiles(files) {
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const stored = deflated.length >= raw.length;
    const data = stored ? raw : deflated;
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); // utf-8 names
    head.writeUInt16LE(stored ? 0 : 8, 8); head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(stored ? 0 : 8, 10); cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += head.length + name.length + data.length;
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

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
// Presets whose height is a viewport, not a format: a page in them scrolls, so the artboard grows
// to fit what was drawn (verify does this). A slide, an A4 page or a social tile stays fixed.
const SCREEN_PRESETS = new Set(["desktop", "laptop", "tablet", "mobile", "email", "custom"]);
const MAX_GROW_H = 6000;

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
    this._locks = new Map();
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

  // Atomic: written beside the file and renamed over it, so a reader never sees half a document.
  // A design was lost to exactly that — the thumbnail refresh and an artboard save wrote the same
  // file at the same time and the result parsed as nothing.
  async write(doc) {
    doc.updatedAt = Date.now();
    const file = this.file(doc.id);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf8");
    await fs.rename(tmp, file);
    this.emit("design:changed", { id: doc.id });
    return doc;
  }

  // Every read-modify-write of one design runs in turn. Two agent tool calls, the thumbnail
  // refresh and an edit from the canvas can all land in the same second; without the queue the
  // last writer silently drops the others' changes.
  async mutate(id, fn) {
    const prev = this._locks.get(id) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    this._locks.set(id, prev.then(() => gate));
    try {
      await prev;
      const doc = await this.read(id);
      const out = await fn(doc);
      await this.write(doc);
      return out;
    } finally {
      release();
      if (this._locks.get(id) === gate) this._locks.delete(id);
    }
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
    const board = await this.mutate(id, (doc) => {
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
    return board;
    });
    this.queueThumb(id);
    return board;
  }

  async setArtboard(id, boardId, patch = {}) {
    const b = await this.mutate(id, (doc) => {
      const b = doc.artboards.find((x) => x.id === boardId);
      if (!b) throw new Error("no such artboard");
      if (typeof patch.html === "string") b.html = this.withBrand(doc, patch.html).slice(0, MAX_HTML_BYTES);
      if (typeof patch.name === "string") b.name = patch.name.slice(0, 60);
      for (const k of ["x", "y", "w", "h"]) if (typeof patch[k] === "number") b[k] = Math.round(patch[k]);
      b.updatedAt = Date.now();
      return b;
    });
    this.queueThumb(id);
    return b;
  }

  async removeArtboard(id, boardId) {
    await this.mutate(id, (doc) => { doc.artboards = doc.artboards.filter((x) => x.id !== boardId); });
    return { ok: true };
  }

  async setCanvas(id, canvas) {
    return this.mutate(id, (doc) => { doc.canvas = { ...doc.canvas, ...canvas }; return doc.canvas; });
  }

  async setBrand(id, patch = {}) {
    return this.mutate(id, (doc) => {
      doc.brand = { ...(doc.brand || {}), ...patch };
      // A logo is stored with the design as a data URI: an artboard has to be self-contained, and a
      // path to a file on this machine would not survive an export or reach anyone else.
      if (typeof patch.logo === "string" && patch.logo && !/^data:image\//.test(patch.logo)) {
        delete doc.brand.logo;
      }
      return doc.brand;
    });
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
      const thumb = "data:image/png;base64," + png.toString("base64");
      await this.mutate(id, (fresh) => { fresh.thumb = thumb; });
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
    return this.mutate(id, (doc) => {
      doc.name = String(name || "").slice(0, 80) || doc.name;
      return { ok: true, name: doc.name };
    });
  }


  // ---------- verify ----------
  // Writing HTML and declaring it good is not designing. This renders the artboard exactly as it
  // will be exported, measures it, and hands back both a screenshot and a list of what is actually
  // wrong — so the agent can look at its own work instead of assuming.
  //
  // The checks run inside the rendered page, which is the only place the truth lives: real layout,
  // real fonts, real wrapping.
  async verify(id, boardId, { grown } = {}) {
    const doc = await this.read(id);
    const b = doc.artboards.find((x) => x.id === boardId);
    if (!b) throw new Error("no such artboard");

    const result = await this.withArtboardPage(b, async (win, zoom) => {
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

    // A web page is as tall as its content; only a slide, a printed page or a social tile has a
    // fixed height. So for screen presets the artboard grows to fit instead of the agent being told
    // to shorten a landing page — then it is verified again at its real size, so the findings and
    // the screenshot cover the whole page.
    const contentH = result.size && result.size.contentH;
    if (!grown && SCREEN_PRESETS.has(b.preset) && contentH > b.h + 6) {
      const h = Math.min(MAX_GROW_H, Math.round(contentH));
      await this.setArtboard(id, boardId, { h });
      const again = await this.verify(id, boardId, { grown: true });
      again.findings = [
        { severity: "info", issue: `The artboard was ${b.h}px tall and the page is ${Math.round(contentH)}px — it now fits the page at ${h}px.` },
        ...(again.findings || []),
      ];
      return again;
    }
    return result;
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

  // One artboard as a file: PNG at up to 2× or a PDF at the artboard's exact size.
  async render(id, boardId, { format = "png", scale = 2 } = {}) {
    const doc = await this.read(id);
    const b = doc.artboards.find((x) => x.id === boardId);
    if (!b) throw new Error("no such artboard");
    return this.withArtboardPage(b, async (win, zoom) => {
      if (format === "pdf") {
        const microns = (px) => Math.round((px / 96) * 25400);
        return win.webContents.printToPDF({
          pageSize: { width: microns(b.w), height: microns(b.h) },
          margins: { marginType: "none" },
          printBackground: true,
          preferCSSPageSize: false,
        });
      }
      return this.capture(win, zoom, b, scale);
    });
  }

  // The whole design as one zip: every artboard as a standalone HTML page with the page links
  // rewritten so the prototype clicks through on disk, a PNG of each, the design's JSON, and an
  // index that opens the first page. Nothing in it needs this app to open.
  async exportZip(id) {
    const doc = await this.read(id);
    const slugOf = (name) => String(name || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
    const slugs = new Map();
    for (const b of doc.artboards) {
      let s = slugOf(b.name), n = 2;
      while ([...slugs.values()].includes(s)) s = `${slugOf(b.name)}-${n++}`;
      slugs.set(b.id, s);
    }
    const byName = new Map(doc.artboards.map((b) => [b.name.toLowerCase(), slugs.get(b.id)]));
    const rewriteLinks = (html) => html.replace(/href="#page:([^"]+)"/gi, (m, name) => {
      const s = byName.get(decodeURIComponent(name).toLowerCase());
      return s ? `href="${s}.html"` : m;
    });

    const files = [];
    for (const b of doc.artboards) {
      const slug = slugs.get(b.id);
      files.push({ name: `${slug}.html`, data: Buffer.from(rewriteLinks(this.documentFor(b)), "utf8") });
      const png = await this.withArtboardPage(b, (win, zoom) => this.capture(win, zoom, b, 2));
      files.push({ name: `png/${slug}.png`, data: png });
    }
    const first = doc.artboards[0] && slugs.get(doc.artboards[0].id);
    const pages = doc.artboards.map((b) => `<li><a href="${slugs.get(b.id)}.html">${b.name.replace(/</g, "&lt;")}</a> <span>${b.w}×${b.h}</span></li>`).join("\n");
    files.push({
      name: "index.html",
      data: Buffer.from(`<!doctype html><meta charset="utf-8"><title>${doc.name.replace(/</g, "&lt;")}</title>
<style>body{font:15px/1.5 -apple-system,Segoe UI,sans-serif;max-width:640px;margin:48px auto;padding:0 24px;color:#111}h1{font-size:22px}li{margin:6px 0}span{color:#888;font-size:12px;margin-left:8px}p{color:#555}</style>
<h1>${doc.name.replace(/</g, "&lt;")}</h1>
${doc.brief ? `<p>${doc.brief.replace(/</g, "&lt;")}</p>` : ""}
<ul>${pages}</ul>
${first ? `<p><a href="${first}.html">Open the prototype →</a></p>` : ""}`, "utf8"),
    });
    const { thumb, ...meta } = doc;
    files.push({ name: "design.json", data: Buffer.from(JSON.stringify(meta, null, 2), "utf8") });
    return zipFiles(files);
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
