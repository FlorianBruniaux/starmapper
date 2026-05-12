/**
 * Generate PNG icons from icons/icon.svg.
 * Requires: npm install -g sharp-cli  OR  npx @squoosh/cli
 *
 * Usage: node scripts/generate-icons.mjs
 *
 * Alternatively, open icons/icon.svg in Inkscape, Figma, or any SVG editor
 * and export as PNG at 16×16, 48×48, and 128×128.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "icons", "icon.svg");
const sizes = [16, 48, 128];

// Try sharp (if installed as local dep or globally via npx)
const trySharp = () => {
  for (const size of sizes) {
    const out = join(root, "icons", `icon${size}.png`);
    execSync(
      `npx sharp-cli --input "${src}" --output "${out}" resize ${size} ${size}`,
      { stdio: "inherit" }
    );
  }
};

// Try convert (ImageMagick) as fallback
const tryConvert = () => {
  for (const size of sizes) {
    const out = join(root, "icons", `icon${size}.png`);
    execSync(`convert -resize ${size}x${size} "${src}" "${out}"`, { stdio: "inherit" });
  }
};

// Try rsvg-convert as fallback
const tryRsvg = () => {
  for (const size of sizes) {
    const out = join(root, "icons", `icon${size}.png`);
    execSync(`rsvg-convert -w ${size} -h ${size} "${src}" -o "${out}"`, { stdio: "inherit" });
  }
};

if (!existsSync(join(root, "icons"))) {
  mkdirSync(join(root, "icons"), { recursive: true });
}

const tools = [
  ["sharp-cli (npm)", trySharp],
  ["convert (ImageMagick)", tryConvert],
  ["rsvg-convert (librsvg)", tryRsvg],
];

let success = false;
for (const [name, fn] of tools) {
  try {
    fn();
    console.log(`✓ Icons generated with ${name}`);
    success = true;
    break;
  } catch {
    // try next tool
  }
}

if (!success) {
  console.error(`
No icon generation tool found. Options:
  1. pnpm add -D @resvg/resvg-js  (then update this script)
  2. brew install librsvg  (then: rsvg-convert)
  3. brew install imagemagick  (then: convert)
  4. Manually export icons/icon.svg at 16×16, 48×48, 128×128 as PNG

The extension will load without icons (Chrome shows a default puzzle piece).
`);
  process.exit(1);
}
