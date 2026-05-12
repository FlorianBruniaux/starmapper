# StarMapper Chrome Extension

Adds a **★ Map** button on every GitHub repository page that opens the StarMapper map without leaving GitHub.

## Features

- **★ Map button** injected next to Watch / Star / Fork — navigates directly to `starmapper.bruniaux.com/owner/repo`
- **Toolbar popup** — shows the current repo with a one-click open, last 5 recently mapped repos, and a search field to map any repo by slug or URL
- **Context menu** — right-click any GitHub repo link → "Open on StarMapper" (system pages like `/settings`, `/explore` are filtered out)
- Handles GitHub's SPA navigation (Turbo + bfcache) — button reappears after client-side route changes
- Follows GitHub's CSS variables for dark/light mode compatibility
- Recent repos persisted in `chrome.storage.local`

## Dev setup

```bash
cd extension
npm install
npm run dev     # WXT dev mode — writes to .output/chrome-mv3-dev/ with HMR
```

Then in Chrome:
1. `chrome://extensions` → enable Developer mode
2. "Load unpacked" → select `.output/chrome-mv3-dev/`
3. Navigate to any `github.com/owner/repo` page

## Production build

```bash
npm run build   # outputs to .output/chrome-mv3/
npm run zip     # packages .output/chrome-mv3/ as a .zip for the Chrome Web Store
```

Upload the `.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

## Type checking

```bash
npm run typecheck   # runs wxt prepare + tsc --noEmit
```

## Icon generation

PNG icons are pre-generated in `public/icons/`. To regenerate from `icons/icon.svg`:

```bash
npm run icons   # uses scripts/generate-icons.mjs (auto-detects sharp-cli or ImageMagick)
# then copy to public/icons/
cp icons/icon*.png public/icons/
```

## Tech stack

- **Manifest V3** (Chrome Web Store requirement)
- **TypeScript** — strict mode, no `any`
- **WXT** — modern extension framework, replaces @crxjs/vite-plugin. HMR in dev, `wxt zip` for packaging
- No React — content script is plain DOM manipulation, popup is vanilla TS

## File map

```
wxt.config.ts                   WXT config — manifest settings, permissions
entrypoints/
  background.ts                 Service worker — context menu on right-click (filters system pages)
  content.ts                    Injected into github.com — detects repo URL, injects button, stores recents
  popup/
    index.html                  Popup UI — current repo, recent repos, search
    main.ts                     Popup logic — chrome.storage for recent repos
public/
  icons/                        Pre-generated PNGs (16, 48, 128px)
icons/
  icon.svg                      SVG source for icon generation
scripts/
  generate-icons.mjs            Icon generation helper
```
