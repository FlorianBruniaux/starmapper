# Design System StarMapper

> **Last verified:** 2026-05-09 — cross-checked with `src/app/globals.css`.

> Visual and technical reference guide. GitHub-inspired dark theme.

---

## 1. Visual Identity

**Theme**: Dark GitHub, dark interface, colored accents, data front and center.

**Principles**:
- Data > chrome (the map takes 100% of the space)
- Minimal outside the map
- Familiar for developers (GitHub colors)

---

## 2. Color Palette

### 2.1 Backgrounds & Surfaces

| CSS Token | Hex (dark) | Usage |
|-----------|------------|-------|
| `--color-background` | `#0d1117` | App background (dark navy) |
| `--color-surface` | `#161b22` | Cards, popups, panels |
| `--color-surface-alt` | `#1c2128` | Hover states, inputs |
| `--color-border` | `#30363d` | Borders |
| `--color-border-subtle` | `#21262d` | Light separators |

### 2.2 Text

| CSS Token | Hex (dark) | Usage |
|-----------|------------|-------|
| `--color-foreground` | `#f0f6fc` | Primary text |
| `--color-muted` | `#8b949e` | Secondary text |
| `--color-muted-subtle` | `#848d97` | Subtle text |

### 2.3 Functional Accents

| CSS Token | Hex (dark) | Tailwind class | Usage |
|-----------|------------|-----------------|-------|
| `--color-accent-blue` | `#58a6ff` | `text-accent-blue` | Links, info, primary repo |
| `--color-accent-green` | `#3fb950` | `bg-accent-green` | Primary CTA, success |
| `--color-accent-green-emphasis` | `#238636` | `bg-accent-green-emphasis` | Filled CTA button |
| `--color-accent-red` | `#f85149` | `text-accent-red` | Errors |
| `--color-accent-orange` | `#f0883e` | `text-accent-orange` | "moderate" tier, warning banners |
| `--color-accent-orange-bg` | `color-mix(orange 15%)` | `bg-accent-orange-bg` | Orange pill/badge background |
| `--color-accent-orange-border` | `color-mix(orange 30%)` | `border-accent-orange-border` | Orange pill/badge border |
| `--color-accent-purple` | `#a371f7` | `text-accent-purple` | Map: repo compare |
| `--color-warning-subtle` | `#271d0e` | `bg-warning-subtle` | Subtle warning background |

### 2.4 Light mode overrides (key values)

| CSS Token | Hex (light) |
|-----------|-------------|
| `--color-background` | `#ffffff` |
| `--color-surface` | `#f0f3f6` |
| `--color-surface-alt` | `#e4e8ec` |
| `--color-foreground` | `#24292f` |
| `--color-accent-orange` | `#bc4c00` |
| `--color-accent-blue` | `#0969da` |
| `--color-accent-green` | `#1a7f37` |
| `--color-muted-subtle` | `#6e7681` |

### 2.5 Map Layers (non-Tailwind, MapLibre only)

Point color gradient by follower count (hardcoded JS values in `stargazer-map.tsx`):

```
0–10 followers    → #58a6ff (blue)
11–100 followers  → #ffa657 (MapLibre orange — distinct from DS token)
100+ followers    → #f85149 (red/coral)
```

Repo compare: `#a371f7` (purple) to distinguish from the primary repo.

> Note: `#ffa657` is the orange used in MapLibre JS layers. The DS token `--color-accent-orange` is `#f0883e` (dark) / `#bc4c00` (light). These values are intentionally different.

---

## 3. Typography

| Usage | Tailwind class |
|-------|----------------|
| Page title | `text-xl font-bold text-foreground` |
| Label | `text-sm font-medium text-foreground` |
| Body | `text-sm text-foreground` |
| Secondary | `text-sm text-muted` |
| Caption | `text-xs text-muted` |
| Compact label | `text-2xs text-muted` (custom, defined in `@theme`) |

**Font**: Geist Sans / Geist Mono (via `--font-geist-sans` / `--font-geist-mono`).

---

## 4. Key Components

### 4.1 Input (repo URL)

```tsx
<input
  className="w-full bg-surface border border-border rounded-md px-3 py-2
             text-sm text-foreground placeholder:text-muted
             focus:outline-none focus:ring-2 focus:ring-accent-blue/40
             focus:border-accent-blue"
/>
```

### 4.2 Primary Button (CTA)

```tsx
<button className="bg-accent-green text-white font-semibold
                   px-4 py-2 rounded-md text-sm
                   hover:opacity-90 transition-opacity">
  Map Stargazers
</button>
```

### 4.3 Secondary / Ghost Button

```tsx
<button className="border border-border text-muted
                   px-3 py-1.5 rounded-md text-sm
                   hover:text-foreground hover:border-accent-blue/50
                   transition-colors">
  Compare
</button>
```

### 4.4 Badge / Pill

```tsx
<span className="inline-flex items-center gap-1
                 bg-surface border border-border
                 px-2 py-0.5 rounded-full text-xs text-muted">
  {count} repos
</span>
```

### 4.5 "Experimental" badge / orange pill

```tsx
<span className="inline-flex items-center px-2 py-0.5 rounded-full
                 bg-accent-orange-bg text-accent-orange border border-accent-orange-border
                 text-2xs font-semibold uppercase tracking-wide">
  Experimental
</span>
```

### 4.6 MapLibre Popup

CSS style in `globals.css` (`.starmapper-popup` class), outside Tailwind.

```css
.starmapper-popup .maplibregl-popup-content {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-foreground);
}
```

---

## 5. Layout

### 5.1 Landing Page

Two-column layout on desktop (`lg:flex-row`), single column on mobile.

```
┌──────────────────────────────────────────────────────┐
│ Header (h-14, sticky)                                │
│ Logo | [Theme toggle] [Token button]                 │
├───────────────────────┬──────────────────────────────┤
│ Left panel (form)     │ Right panel (community table)│
│                       │                              │
│  Title (xl, bold)     │  "Community Maps"            │
│  Subtitle (sm, muted) │  [Sortable table: repos]     │
│                       │  [Pagination prev/next]      │
│  [URL Input ] [Map →] │                              │
│  [Compare toggle]     │                              │
│                       │                              │
│  How it works         │                              │
│  Recent & examples    │                              │
│  FAQ                  │                              │
│                       │                              │
└───────────────────────┴──────────────────────────────┘
```

The Community Maps table is paginated (20 rows/page) and sorted by `updatedAt` desc by default. Sortable columns: Stars, Mapped%, Countries, Last scan.

### 5.2 Map Page

```
┌─────────────────────────────────────┐
│ Header (h-12)                       │
├─────────────────────────────────────┤
│                                     │
│  MapLibre GL (flex-1, full width)   │
│                                     │
│  [Stats overlay]  [Unmapped drawer] │
└─────────────────────────────────────┘
```

**Rule**: The map takes all available space. Overlays are `position: absolute`.

---

## 6. Spacing

Base unit: 4px (Tailwind default).

| Class | px | Usage |
|--------|----|-------|
| `gap-1` | 4px | Icon-text |
| `gap-2` | 8px | Standard |
| `gap-4` | 16px | Sections |
| `p-3` | 12px | Compact padding |
| `p-4` | 16px | Standard padding |

**Forbidden**: Arbitrary values (`gap-[8px]`, `p-[12px]`)

---

## 7. Border Radius

| Class | px | Usage |
|--------|----|-------|
| `rounded-sm` | 4px | Inputs |
| `rounded-md` | 6px | Buttons, cards |
| `rounded-lg` | 8px | Panels, modals |
| `rounded-full` | varies | Pills, avatars |

---

## 8. Accessibility

- Focus ring: `*:focus-visible` → `outline: 2px solid var(--color-accent-blue)` (global in `globals.css`)
- Primary text contrast: `#f0f6fc` on `#0d1117` ≥ 4.5:1 ✅
- "New" badge: `#24292f` on `#f0883e` = ~5.4:1 ✅ WCAG AA
- Touch targets: min 44×44px on mobile
- Map clusters: `aria-label` on popup close buttons

---

## 9. Dark / Light Mode

StarMapper supports both modes via a toggle in the header. The default mode is **dark**.

### System architecture

Three layers work together:

**1. `src/lib/theme.ts`**: pure logic, client-side only (`"use client"`).
- `getStoredTheme()` / `setStoredTheme()`: reads/writes `starmapper:theme` in `localStorage` (`"light" | "dark" | null`)
- `getSystemTheme()`: reads `prefers-color-scheme`
- `applyTheme(theme)`: applies the `"dark"` or `"light"` class on `<html>` and returns the resolved theme

**2. `src/app/layout.tsx`**: FOUC (Flash Of Unstyled Content) prevention.
A synchronous inline script runs before the first paint to read `localStorage` and apply the correct class on `<html>` immediately.

```ts
// Script injected via dangerouslySetInnerHTML in <head>
(function() {
  var stored = localStorage.getItem('starmapper:theme');
  var preferLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  var resolved = stored === 'light' || stored === 'dark' ? stored : (preferLight ? 'light' : 'dark');
  document.documentElement.classList.add(resolved);
})();
```

**3. `src/app/globals.css`**: CSS tokens defined in three blocks:

```css
/* Base (dark, default if no class) */
:root { --color-background: #0d1117; ... }

/* Auto OS override */
@media (prefers-color-scheme: light) {
  :root:not(.dark) { --color-background: #ffffff; ... }
}

/* Manual override (class applied by applyTheme()) */
html.light { --color-background: #ffffff; ... }
html.dark  { --color-background: #0d1117; ... }
```

**4. `src/components/theme-toggle.tsx`**: button in the header, calls `applyTheme()` + `setStoredTheme()` on click.

### Resolution priority

```
localStorage override ("light" | "dark")
    > prefers-color-scheme OS preference
        > dark (default)
```

### Implementation rules

- **Always use CSS tokens** (`bg-background`, `text-foreground`...), never direct hex values. Tokens adapt automatically to the active mode.
- **MapLibre tiles** are swapped via style URL in `map-style.ts`; the map listens for theme changes and reloads its style.
- **`"use client"` required** on any component that imports from `theme.ts` (localStorage access).

---

## 10. Anti-patterns

| ❌ Forbidden | ✅ Correct |
|------------|-----------|
| `bg-[#0d1117]` | `bg-background` |
| `text-[#8b949e]` | `text-muted` |
| `border-[#30363d]` | `border-border` |
| `bg-white` | `bg-surface` |
| `bg-orange-500/15` | `bg-accent-orange-bg` |
| `text-orange-400` | `text-accent-orange` |
| `border-orange-500/30` | `border-accent-orange-border` |
| Popup styles as inline JSX | Popup styles in `.starmapper-popup` CSS |

---

*Last updated: 2026-05-12 (v0.4.6)*
