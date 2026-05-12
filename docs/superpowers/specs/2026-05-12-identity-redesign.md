# StarMapper — Identity Redesign Spec

**Date**: 2026-05-12  
**Status**: Approved for implementation  
**Scope**: Visual identity — palette, typography, logo, hero section

---

## Decisions Made

| Dimension | Choix | Raison |
|---|---|---|
| Direction de marque | Night Cartography | Fond bleu nuit, cartographique, distinct de GitHub |
| Typographie headings | Sora | Plus premium que Geist, plus doux que Space Grotesk |
| Typographie body | Geist (inchangé) | Déjà en place, excellent |
| Hero section | Scatter map background | Évoque le produit sans screenshot lourd |
| Logo | Globe raffiné | Même concept, meilleure exécution + étoile ambre |

---

## 1. Palette — globals.css

### Changements dark mode (défaut)

| Token | Actuel | Nouveau | Impact |
|---|---|---|---|
| `--color-background` | `#0d1117` | `#070e1a` | Plus profond, cosmique, distinct de GitHub |
| `--color-surface` | `#161b22` | `#0d1b2e` | Teinte bleue subtile, cartographique |
| `--color-surface-alt` | `#1c2128` | `#132035` | Cohérent avec surface |
| `--color-foreground` | `#f0f6fc` | `#e8f1ff` | Légèrement plus bleu-blanc |
| `--color-accent-blue` | `#58a6ff` | `#7eb8ff` | Plus clair, plus "ciel nocturne", distinct de GitHub exact |
| `--color-accent-green` | `#3fb950` | `#10D070` | Vert plus vif, plus visible sur fond sombre |
| `--color-accent-green-emphasis` | `#238636` | `#0E9856` | CTA bouton plus lumineux, plus de punch |
| `--color-border` | `#30363d` | `#1a2e47` | Teinte bleue (équivalent rgba bleu/12% sur fond) |
| `--color-border-subtle` | `#21262d` | `#0f2035` | Idem, plus subtil |

**Ajout** : token ambre pour accents chauds (étoile logo, détails cartographiques)
```css
--color-accent-amber: #f0a050;
```

### Light mode — ajustements correspondants

Les valeurs light mode restent proches de l'actuel (fond blanc, texte sombre) mais l'accent-blue et accent-green suivent le même shift de teinte.

---

## 2. Typographie — Sora pour les headings

### Intégration

Sora est disponible via `next/font/google`. L'intégrer dans `src/app/layout.tsx` aux côtés de Geist :

```tsx
import { Geist, Geist_Mono, Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});
```

Ajouter `sora.variable` dans le `className` du `<html>`.

### Token CSS à ajouter dans `@theme`

```css
--font-heading: var(--font-sora);
```

### Règle d'utilisation

- `font-[family-name:--font-sora]` sur : `h1`, `h2` (sections), stats numériques en hero, wordmark header
- Geist (défaut) sur : tout le reste (body, labels, nav, inputs, badges)

**Fichiers impactés** :
- `src/app/layout.tsx` — import + variable
- `src/app/globals.css` — token `--font-heading`
- `src/app/page.tsx` — h1 hero, stats strip
- `src/components/header.tsx` — wordmark "StarMapper"

---

## 3. Logo SVG — Globe raffiné

### Problèmes actuels

- Lignes trop épaisses et inégales
- Étoile mal proportionnée et positionnée
- Pas d'accent chaud (tout en bleu monochrome)
- Le SVG du footer est différent de celui du header (incohérence)

### Nouveau SVG (source unique)

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
  <!-- Globe -->
  <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.2"/>
  <ellipse cx="10" cy="10" rx="3.5" ry="7.5" stroke="currentColor" stroke-width="1" opacity="0.7"/>
  <line x1="2.5" y1="10" x2="17.5" y2="10" stroke="currentColor" stroke-width="1" opacity="0.7"/>
  <path d="M3.5 6.8 Q10 5.4 16.5 6.8" stroke="currentColor" stroke-width="0.8" fill="none" opacity="0.5"/>
  <path d="M3.5 13.2 Q10 14.6 16.5 13.2" stroke="currentColor" stroke-width="0.8" fill="none" opacity="0.5"/>
  <!-- Étoile ambre centrée en haut -->
  <path d="M10 4.2 L10.5 5.9 L12.3 5.9 L10.9 7.0 L11.4 8.7 L10 7.7 L8.6 8.7 L9.1 7.0 L7.7 5.9 L9.5 5.9 Z"
        fill="#f0a050"/>
</svg>
```

**Couleur** : `currentColor` pour le globe (hérite de `text-accent-blue`), étoile fixe en `#f0a050` (ambre).

### Centralisation

Extraire le SVG en composant `<LogoMark />` dans `src/components/logo.tsx`. Remplacer les occurrences inline dans :
- `src/components/header.tsx` — `LogoSvg` inline
- `src/components/footer.tsx` — SVG inline dans le brand block

---

## 4. Hero — Scatter Map Background

### Objectif

Ajouter un fond de nuage de points style stargazers semi-transparent derrière le hero, sans alourdir le LCP ni bloquer l'interactivité.

### Implémentation

SVG statique inline dans `src/app/page.tsx`, `position: absolute`, `pointer-events: none`, `aria-hidden`.

Points représentant des zones de concentration de stargazers (North America, Europe, Asie, Australie, South America). Lignes de constellation optionnelles en très faible opacité.

```tsx
// Dans la section hero, avant le contenu :
<div className="absolute inset-0 pointer-events-none" aria-hidden="true">
  <svg
    viewBox="0 0 800 400"
    className="w-full h-full opacity-[0.07]"
    preserveAspectRatio="xMidYMid slice"
  >
    {/* ~40 dots positionnés sur les continents */}
    {/* 3-4 lignes de constellation très fines */}
  </svg>
</div>
```

**Opacité** : `0.07` dark / `0.04` light — juste perceptible, ne concurrence pas le texte.

**Performance** : SVG inline, zéro réseau, zéro JS. Pas d'impact LCP.

**Responsive** : `preserveAspectRatio="xMidYMid slice"` — recadre proprement sur mobile.

---

## 5. CTA Button

Le bouton "Map Stargazers" utilise `bg-accent-green-emphasis` (#238636 actuellement → #0E9856 nouveau). La classe Tailwind reste `bg-accent-green-emphasis`, seule la valeur CSS change dans `globals.css`.

**Pas de changement de markup** — uniquement le token CSS.

---

## 6. Section Headers

Les titres de sections (`text-2xs uppercase tracking-widest text-muted-subtle`) restent en Geist. Pas de Sora sur les labels de sections — Sora uniquement pour les vraies hiérarchies H1/H2.

---

## Fichiers à modifier

| Fichier | Changement |
|---|---|
| `src/app/globals.css` | Nouveau palette dark + light + token `--color-accent-amber` + `--font-heading` |
| `src/app/layout.tsx` | Import Sora + variable CSS |
| `src/components/logo.tsx` | **Nouveau fichier** — composant `<LogoMark />` |
| `src/components/header.tsx` | Utilise `<LogoMark />`, wordmark en Sora |
| `src/components/footer.tsx` | Utilise `<LogoMark />` |
| `src/app/page.tsx` | Scatter map SVG en hero, h1 en Sora, stats en Sora |

---

## Hors scope

- Refonte de la page map `[owner]/[repo]`
- Changement du layout navigation
- Nouvelles features UI
- Refonte des pages `/explore`, `/devs`, `/profile`

Les tokens CSS étant globaux, les autres pages bénéficient automatiquement du nouveau palette. Seul le hero et le logo sont des changements ciblés.

---

## Risques

| Risque | Mitigation |
|---|---|
| Sora augmente le bundle font | `display: swap` + `next/font` (subset latin uniquement, poids 400/600/700 seulement) |
| Contraste palette new dark | Vérifier `--color-muted` (#8ba0be) sur `--color-background` (#070e1a) après changement — target 4.5:1 |
| Borders en rgba() cassent opacity modifiers Tailwind | Spec utilise des hex pour les borders — pas de rgba() dans les tokens |
| SVG hero trop visible sur light mode | Opacité 0.04 en light, tester |
| Footer/header logo incohérents si oubli | Centraliser dans `logo.tsx` avant tout |
