# Tailwind Standards (Auto-loaded)

## RÈGLE ABSOLUE : Zéro valeur arbitraire

**Interdit** : `w-[40px]`, `text-[12px]`, `gap-[8px]`, `h-[320px]`, `bg-[#58a6ff]`
**Autorisé** : Classes Tailwind standard ou tokens CSS définis dans `@theme`

```tsx
// ❌ JAMAIS
<div className="w-[320px] gap-[8px] text-[14px]">
<div className="bg-[#0d1117]">

// ✅ TOUJOURS
<div className="w-80 gap-2 text-sm">
<div className="bg-background">
```

---

## Tailwind v4 — Inline Theme (StarMapper)

StarMapper utilise Tailwind v4 avec `@theme inline` dans `globals.css`.
**Pas de `tailwind.config.ts`** — les tokens sont des variables CSS.

**Tokens définis dans `@theme`** :

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

**Règle** : Si une couleur GitHub-theme est utilisée plus d'une fois → l'ajouter dans `@theme` et utiliser le token.

---

## Spacing Scale

| Classe | px | Usage |
|--------|----|-------|
| `gap-1` | 4px | Serré |
| `gap-2` | 8px | Standard |
| `gap-4` | 16px | Sections |
| `p-4` | 16px | Padding card |
| `p-6` | 24px | Padding page |

**Interdit** : `gap-[8px]`, `p-[16px]`

---

## Font Size Scale

| Classe | px |
|--------|----|
| `text-xs` | 12px |
| `text-sm` | 14px |
| `text-base` | 16px |
| `text-lg` | 18px |
| `text-xl` | 20px |

**Interdit** : `text-[12px]`, `text-[14px]`

---

## Icon / Square Sizes

| Classe | px |
|--------|----|
| `size-4` | 16px |
| `size-5` | 20px |
| `size-6` | 24px |
| `size-8` | 32px |

**Interdit** : `h-[16px] w-[16px]` → `size-4`

---

## Exceptions légitimes (rares)

- MapLibre popups : styles inline injectés via `innerHTML` (hors portée Tailwind — OK dans `.starmapper-popup` CSS)
- Canvas map : styles positionnels sur le container `ref` via MapLibre API

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
