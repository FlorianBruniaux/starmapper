# StarMapper Chrome Extension

Adds a **★ Map** button on every GitHub repository page that opens the StarMapper map without leaving GitHub.

## Features

- **★ Map button** injected next to Watch / Star / Fork — navigates directly to `starmapper.bruniaux.com/owner/repo`
- **Toolbar popup** — shows the current repo with a one-click open, plus a search field to map any repo by slug or URL
- **Context menu** — right-click any GitHub repo link → "Open on StarMapper"
- Handles GitHub's SPA navigation (Turbo) — button reappears after client-side route changes
- Follows GitHub's CSS variables for dark/light mode compatibility

## Dev setup

```bash
cd extension
npm install
npm run icons   # generate PNG icons from icons/icon.svg (requires ImageMagick or sharp-cli)
npm run dev     # Vite watch mode → writes to dist/
```

Then in Chrome:
1. `chrome://extensions` → enable Developer mode
2. "Load unpacked" → select the `dist/` folder
3. Navigate to any `github.com/owner/repo` page

## Production build

```bash
npm run build   # outputs to dist/
```

Zip `dist/` and upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Icon generation

The manifest references `icons/icon16.png`, `icon48.png`, `icon128.png`. Generate them from `icons/icon.svg`:

```bash
# With ImageMagick (brew install imagemagick)
convert -resize 16x16 icons/icon.svg icons/icon16.png
convert -resize 48x48 icons/icon.svg icons/icon48.png
convert -resize 128x128 icons/icon.svg icons/icon128.png

# Or with the bundled script (auto-detects available tools)
npm run icons
```

## Tech stack

- **Manifest V3** (required for Chrome Web Store)
- **TypeScript** — strict mode, no `any`
- **Vite + @crxjs/vite-plugin** — handles content script bundling, service worker, popup HTML
- No React — content script is plain DOM manipulation (~2.75 kB)

## File map

```
manifest.json       MV3 manifest — permissions, content_scripts, action
src/content.ts      Injected into github.com — detects repo URL, injects button
src/background.ts   Service worker — context menu on right-click
src/popup.ts        Toolbar popup logic — current repo + search
popup.html          Popup UI
icons/              SVG source + generated PNGs
```
