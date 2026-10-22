/* The app icon and the launch image, rendered from the vector.
 *
 *   node scripts/icons.mjs
 *
 * `npx cap add ios` ships Capacitor's own placeholder art, so without this
 * the app has somebody else's logo on the home screen. Regenerate after any
 * change to public/icon.svg.
 *
 * ── Rendered rather than resized ─────────────────────────────────────────
 *
 * public/icon.svg is vector, so every size is drawn at its own resolution
 * instead of resampled up from the 512px PNG. A 1024 icon upscaled from 512
 * is visibly soft on the one screen Apple shows it largest on.
 *
 * ── Square, and opaque ───────────────────────────────────────────────────
 *
 * The web icon carries `rx="118"`, because a favicon has to round its own
 * corners. An iOS icon must not: the system applies the mask, and a
 * pre-rounded icon leaves transparent corners outside it. Apple rejects an
 * icon with an alpha channel, and the rejection names the file rather than
 * the reason, so this draws the background square and fully opaque.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public", "icon.svg");
const ICONSET = path.join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const SPLASHSET = path.join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");

const BACKGROUND = "#08060E";

if (!fs.existsSync(SOURCE)) {
  console.error(`No ${path.relative(ROOT, SOURCE)} to render from.`);
  process.exit(1);
}

const svg = fs.readFileSync(SOURCE, "utf8");

/* The artwork without its rounded background rectangle, so it can be placed
   on backgrounds of other shapes and sizes. */
const artwork = svg
  .replace(/<rect[^>]*width="512"[^>]*height="512"[^>]*\/>/, "")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");

const defs = (svg.match(/<defs>[\s\S]*?<\/defs>/) || [""])[0];
const body = artwork.replace(/<defs>[\s\S]*?<\/defs>/, "");

/* The icon: the same drawing, on a square opaque field. */
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${defs}
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  ${body}
</svg>`;

/* The launch image: the mark small and centred on a large square, because
   iOS crops this to every display shape there is and anything near an edge
   is the thing it crops. */
const splashSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${defs}
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(128 128) scale(0.5)">
    ${body}
  </g>
</svg>`;

const page = (markup, size) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${BACKGROUND};width:${size}px;height:${size}px;overflow:hidden}
svg{display:block}</style>${markup}`;

const { default: puppeteer } = await import("puppeteer");

const browser = await puppeteer.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function render(markup, size, out) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await tab.setContent(page(markup, size), { waitUntil: "load" });
  /* `omitBackground` left false on purpose: the page paints the brand colour
     behind the drawing, so nothing anywhere is transparent. */
  await tab.screenshot({ path: out, type: "png", omitBackground: false });
  await tab.close();
  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`    ${path.relative(ROOT, out).padEnd(58)} ${size}x${size}  ${kb} KB`);
}

try {
  fs.mkdirSync(ICONSET, { recursive: true });
  fs.mkdirSync(SPLASHSET, { recursive: true });

  console.log("\n  app icon");
  await render(iconSvg(1024), 1024, path.join(ICONSET, "AppIcon-512@2x.png"));

  /* Capacitor's imageset names three scales and uses the same square for all
     of them; iOS picks one and crops it to the display. */
  console.log("\n  launch image");
  for (const name of [
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
  ]) await render(splashSvg(2732), 2732, path.join(SPLASHSET, name));

  console.log("\n  done — run `npx cap sync ios` before building\n");
} finally {
  await browser.close();
}
