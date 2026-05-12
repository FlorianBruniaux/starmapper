# Tailwind Standards (Auto-loaded)

## ABSOLUTE RULE: Zero Arbitrary Values

**Forbidden**: `w-[40px]`, `text-[12px]`, `gap-[8px]`, `h-[320px]`, `bg-[#58a6ff]`
**Allowed**: Standard Tailwind classes or CSS tokens defined in `@theme`

```tsx
// ❌ NEVER
<div className="w-[320px] gap-[8px] text-[14px]">
<div className="bg-[#0d1117]">

// ✅ ALWAYS
<div className="w-80 gap-2 text-sm">
<div className="bg-background">
```

---

## Tailwind v4 — Inline Theme (StarMapper)

StarMapper uses Tailwind v4 with `@theme inline` in `globals.css`.
**No `tailwind.config.ts`** — tokens are CSS variables.

**Tokens defined in `@theme`**:

```css
/* src/app/globals.css */
@theme inline {
  --color-background: #0d1117;    → bg-background
  --color-foreground: #f0f6fc;    → text-foreground
  --color-muted: #8b949e;         → text-muted
  --color-border: #30363d;        → border-border
  ...
}
```

**Rule**: If a GitHub-theme color is used more than once → add it to `@theme` and use the token.

---

## Spacing Scale

| Class | px | Usage |
|-------|----|-------|
| `gap-1` | 4px | Tight |
| `gap-2` | 8px | Standard |
| `gap-4` | 16px | Sections |
| `p-4` | 16px | Card padding |
| `p-6` | 24px | Page padding |

**Forbidden**: `gap-[8px]`, `p-[16px]`

---

## Font Size Scale

| Class | px |
|-------|----|
| `text-xs` | 12px |
| `text-sm` | 14px |
| `text-base` | 16px |
| `text-lg` | 18px |
| `text-xl` | 20px |

**Forbidden**: `text-[12px]`, `text-[14px]`

---

## Icon / Square Sizes

| Class | px |
|-------|----|
| `size-4` | 16px |
| `size-5` | 20px |
| `size-6` | 24px |
| `size-8` | 32px |

**Forbidden**: `h-[16px] w-[16px]` → use `size-4`

---

## Legitimate Exceptions (rare)

- MapLibre popups: inline styles injected via `innerHTML` (outside Tailwind scope — OK in `.starmapper-popup` CSS)
- Canvas map: positional styles on the container `ref` via MapLibre API

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
