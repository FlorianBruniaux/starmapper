# Chrome Extension — Publishing and maintenance

## Developer account

One-time prerequisite: create a developer account at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) ($5 one-time fee).

---

## First publish

### 1. Build + zip

```bash
cd extension
npm install
npm run zip
# → .output/starmapper-extension-1.0.0-chrome.zip
```

### 2. Required Store listing assets

The Store requires at minimum:

- 1 screenshot (1280×800 or 640×400) — the popup in action on a GitHub page is enough
- A promotional icon 440×280 (optional but recommended)
- Short description (≤132 chars) + long description

Suggested short description:
> Map the stargazers of any GitHub repository without leaving GitHub.

### 3. Upload

1. Developer Dashboard → "New item"
2. Upload the `.zip`
3. Fill in: name, description, category "Developer Tools", screenshots
4. Privacy disclosure: check "This extension does not collect user data" (`chrome.storage.local` is used locally only)
5. Submit

Google review time: 1–3 days for the first submission.

---

## Updates

### Process

1. Bump `version` in `extension/wxt.config.ts`:
   ```ts
   version: "1.0.1",   // follow semver: patch for bugfixes, minor for new features
   ```
2. Build:
   ```bash
   cd extension
   npm run zip
   ```
3. Dashboard → select the extension → "Upload new package" → upload the new `.zip` → submit

Turnaround: a few hours after the first approval (updates go through faster).

### When to bump

| Change | Version |
|---|---|
| Minor bugfix (injection, bfcache, popup) | `1.0.x` |
| New button or new supported page | `1.x.0` |
| Manifest permission change | `1.x.0` — triggers re-review |

---

## Current permissions (manifest)

```
tabs            — read the active tab URL (popup: detect current repo)
contextMenus    — right-click menu on GitHub links
storage         — store recent repos (chrome.storage.local, local only)
host_permissions: https://github.com/*
```

Any new permission (e.g. `notifications`) triggers a re-review and asks the user to accept.

---

## Extension roadmap

### Next: "View profile on StarMapper" button

On GitHub profile pages (`github.com/[login]`), inject a "★ Profile" button next to the "Follow" button that opens `starmapper.bruniaux.com/profile/[login]`.

**Required changes:**
- `wxt.config.ts`: `host_permissions` already includes `"https://github.com/*"` — extend the content script `matches`
- `content.ts`: detect profile (1 path segment) vs repo (2 segments), inject the right button based on context
- Bump to `1.1.0`

**Target selector** for the Follow button on GitHub:

```ts
// Container of the Follow button on github.com/[login]
const profileActions = document.querySelector(".js-profile-editable-area")
  ?? document.querySelector('[data-view-component="true"].Layout-sidebar');
```
