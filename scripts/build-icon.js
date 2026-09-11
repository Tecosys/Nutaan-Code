// Regenerates assets/icon.ico from assets/logo.png with all the standard
// Windows icon sizes embedded. electron-builder's own PNG->ICO conversion
// silently produced a single 256x256-only .ico for our source image, which
// Windows renders as a tiny logo inside a blank tile at smaller sizes
// (desktop, Start Menu, taskbar). Run with: node scripts/build-icon.js
const path = require("node:path");
const { Jimp } = require("jimp");
const pngToIco = require("png-to-ico").default;
const fs = require("node:fs/promises");

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SRC = path.join(__dirname, "..", "assets", "logo.png");
const OUT = path.join(__dirname, "..", "assets", "icon.ico");

(async () => {
  const base = await Jimp.read(SRC);
  const buffers = [];
  for (const size of SIZES) {
    const resized = base.clone().resize({ w: size, h: size });
    buffers.push(await resized.getBuffer("image/png"));
  }
  const ico = await pngToIco(buffers);
  await fs.writeFile(OUT, ico);
  console.log(`Wrote ${OUT} with sizes: ${SIZES.join(", ")}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
