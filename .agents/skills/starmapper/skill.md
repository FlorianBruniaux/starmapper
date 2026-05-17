---
name: starmapper
description: Add a StarMapper badge (world map of stargazers) to the current repo's README. Detects OWNER/REPO from git remote and inserts the HTML block in the right place.
version: 1.0.0
effort: low
tags: [readme, badge, starmapper, github]
allowed-tools: Bash, Read, Edit
---

# StarMapper Badge

Add a StarMapper section to the current repo's README that shows a world map of stargazers.

## Instructions

1. **Detect OWNER/REPO** from git remote:

   ```bash
   git remote get-url origin
   ```

   Parse `OWNER` and `REPO` from the URL (supports both HTTPS and SSH formats).

2. **Find the README** — check for `README.md` at repo root (fallback: `readme.md`, `README.rst`).

3. **Find the insertion point** — always insert the full world map block (never a badge-only inline). Best spot: just before the first `---` separator, or before `## Installation` / `## Getting Started`. If none, insert before the first `##` section.

   **Insert this block** (with actual OWNER/REPO substituted):

```html
<p align="center">
  <a href="https://starmapper.bruniaux.com/OWNER/REPO">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://starmapper.bruniaux.com/api/map-image/OWNER/REPO?theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://starmapper.bruniaux.com/api/map-image/OWNER/REPO?theme=light" />
      <img alt="StarMapper — see who stars this repo on a world map" src="https://starmapper.bruniaux.com/api/map-image/OWNER/REPO" />
    </picture>
  </a>
</p>
```

4. **Confirm** with one line: `StarMapper added → README.md (OWNER/REPO)`

## Edge cases

- If StarMapper section already exists in the README: skip and say "Already present."
- If OWNER/REPO can't be parsed from remote: ask the user to provide them.
- Do not add a trailing newline mess — match the file's existing newline style.