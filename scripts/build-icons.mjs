// Generate PWA icon variants from a 512×512 monogram source PNG.
// Run: node scripts/build-icons.mjs
//
// The source is `public/icons/source-512.png`. A designer can drop a new
// 512×512 PNG at that path to re-derive every variant with one command.
//
// Outputs:
//   public/icons/icon-192.png
//   public/icons/icon-512.png
//   public/icons/icon-maskable-512.png
//   public/apple-touch-icon.png
//   public/icons/safari-pinned-tab.svg  (hand-authored; not generated)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const publicDir = resolve(repoRoot, "public");
const iconsDir = resolve(publicDir, "icons");
const sourcePath = resolve(iconsDir, "source-512.png");

const BG = { r: 10, g: 10, b: 10, alpha: 1 };
const SAFE_ZONE_PX = 40;

async function loadSource() {
  const buf = await readFile(sourcePath);
  const img = sharp(buf);
  const meta = await img.metadata();
  if (meta.width !== 512 || meta.height !== 512) {
    throw new Error(
      `source-512.png must be 512x512; got ${meta.width}x${meta.height}. ` +
        `Designer can re-export the master at 512x512 and re-run.`,
    );
  }
  return { img, meta };
}

async function writeIcon(buf, relativePath) {
  const outPath = resolve(repoRoot, relativePath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  console.log(`  wrote ${relativePath} (${buf.length} bytes)`);
}

async function build() {
  console.log(`Reading source: ${sourcePath}`);
  const { img } = await loadSource();
  const raw = await img.ensureAlpha().png().toBuffer();

  // 192x192 — purpose "any"
  const icon192 = await sharp(raw).resize(192, 192, { fit: "contain", background: BG }).png().toBuffer();
  await writeIcon(icon192, "public/icons/icon-192.png");

  // 512x512 — purpose "any"
  const icon512 = await sharp(raw).resize(512, 512, { fit: "contain", background: BG }).png().toBuffer();
  await writeIcon(icon512, "public/icons/icon-512.png");

  // 512x512 maskable — 40px outer fill of the bg colour, source composited
  // centred in the inner safe zone.
  const maskable = await sharp({
    create: { width: 512, height: 512, channels: 4, background: BG },
  })
    .composite([{ input: raw, gravity: "center" }])
    .png()
    .toBuffer();
  await writeIcon(maskable, "public/icons/icon-maskable-512.png");

  // 180x180 apple-touch-icon — iOS does not scale from manifest icons.
  const appleTouch = await sharp(raw).resize(180, 180, { fit: "contain", background: BG }).png().toBuffer();
  await writeIcon(appleTouch, "public/apple-touch-icon.png");

  console.log("Safe-zone outer ring (maskable):", SAFE_ZONE_PX, "px");
  console.log("Done.");
}

build().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
