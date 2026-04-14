# Design System StarMapper

> Guide de référence visuel et technique. Dark theme inspiré GitHub.

---

## 1. Identité Visuelle

**Thème** : Dark GitHub, interface sombre, accents colorés, données au premier plan.

**Principes** :
- Données > chrome (la carte prend 100% de l'espace)
- Minimaliste en dehors de la carte
- Familier pour les développeurs (couleurs GitHub)

---

## 2. Palette de Couleurs

### 2.1 Backgrounds & Surfaces

| Token CSS | Hex | Usage |
|-----------|-----|-------|
| `--color-background` | `#0d1117` | App background (dark navy) |
| `--color-surface` | `#161b22` | Cards, popups, panels |
| `--color-surface-alt` | `#21262d` | Hover states, inputs |
| `--color-border` | `#30363d` | Bordures |
| `--color-border-subtle` | `#21262d` | Séparateurs légers |

### 2.2 Textes

| Token CSS | Hex | Usage |
|-----------|-----|-------|
| `--color-foreground` | `#f0f6fc` | Texte principal |
| `--color-muted` | `#8b949e` | Texte secondaire |
| `--color-muted-subtle` | `#484f58` | Texte très discret |

### 2.3 Accents Fonctionnels

| Token CSS | Hex | Classe Tailwind | Usage |
|-----------|-----|-----------------|-------|
| `--color-accent-blue` | `#58a6ff` | `text-accent-blue` | Links, info, primary repo |
| `--color-accent-green` | `#238636` | `bg-accent-green` | CTA principal, succès |
| `--color-accent-red` | `#f85149` | `text-accent-red` | Erreurs |
| `--color-accent-orange` | `#ffa657` | `text-accent-orange` | Map: followers moyen, bandeaux warning |
| `--color-accent-purple` | `#a371f7` | (none) | Map: repo compare |

### 2.4 Map Layers (non-Tailwind, MapLibre uniquement)

Gradient couleur des points par followers :

```
0–10 followers    → #58a6ff (bleu)
11–100 followers  → #ffa657 (orange)
100+ followers    → #f85149 (rouge/corail)
```

Repo compare : `#a371f7` (violet) pour distinguer du repo principal.

---

## 3. Typographie

| Usage | Classe Tailwind |
|-------|----------------|
| Titre page | `text-xl font-bold text-foreground` |
| Label | `text-sm font-medium text-foreground` |
| Corps | `text-sm text-foreground` |
| Secondaire | `text-sm text-muted` |
| Caption | `text-xs text-muted` |

**Police** : System stack (Tailwind default), pas de Google Fonts.

---

## 4. Composants Clés

### 4.1 Input (repo URL)

```tsx
<input
  className="w-full bg-surface border border-border rounded-md px-3 py-2
             text-sm text-foreground placeholder:text-muted
             focus:outline-none focus:ring-2 focus:ring-accent-blue/40
             focus:border-accent-blue"
/>
```

### 4.2 Bouton Primary (CTA)

```tsx
<button className="bg-accent-green text-white font-semibold
                   px-4 py-2 rounded-md text-sm
                   hover:opacity-90 transition-opacity">
  Map Stargazers
</button>
```

### 4.3 Bouton Secondary / Ghost

```tsx
<button className="border border-border text-muted
                   px-3 py-1.5 rounded-md text-sm
                   hover:text-foreground hover:border-accent-blue/50
                   transition-colors">
  Comparer
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

### 4.5 MapLibre Popup

Style CSS dans `globals.css` (classe `.starmapper-popup`), hors Tailwind.

```css
.starmapper-popup {
  background: #161b22;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
}
```

---

## 5. Layout

### 5.1 Landing Page

Layout deux colonnes sur desktop (`lg:flex-row`), colonne unique sur mobile.

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

Le tableau Community Maps est paginé (20 lignes/page) et trié par `updatedAt` desc par défaut. Colonnes triables : Stars, Mapped%, Countries, Last scan.

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

**Règle** : La carte prend tout l'espace disponible. Les overlays sont `position: absolute`.

---

## 6. Spacing

Base unit : 4px (Tailwind default).

| Classe | px | Usage |
|--------|----|-------|
| `gap-1` | 4px | Icône-texte |
| `gap-2` | 8px | Standard |
| `gap-4` | 16px | Sections |
| `p-3` | 12px | Padding compact |
| `p-4` | 16px | Padding standard |

**Interdit** : Valeurs arbitraires (`gap-[8px]`, `p-[12px]`)

---

## 7. Border Radius

| Classe | px | Usage |
|--------|----|-------|
| `rounded-sm` | 4px | Inputs |
| `rounded-md` | 6px | Boutons, cards |
| `rounded-lg` | 8px | Panels, modals |
| `rounded-full` | varies | Pills, avatars |

---

## 8. Accessibilité

- Focus ring : `focus:ring-2 focus:ring-accent-blue/40` sur tous les éléments interactifs
- Contraste : Texte `#f0f6fc` sur `#0d1117` ≥ 4.5:1 ✅
- Touch targets : min 44×44px sur mobile
- Map clusters : `aria-label` sur les boutons de fermeture popup

---

## 9. Dark / Light Mode

StarMapper supporte les deux modes via un toggle dans le header. Le mode par défaut est **dark**.

### Architecture du système

Trois couches collaborent :

**1. `src/lib/theme.ts`** — logique pure, côté client uniquement (`"use client"`).
- `getStoredTheme()` / `setStoredTheme()` : lit/écrit `starmapper:theme` dans `localStorage` (`"light" | "dark" | null`)
- `getSystemTheme()` : lit `prefers-color-scheme`
- `applyTheme(theme)` : applique la classe `"dark"` ou `"light"` sur `<html>` et retourne le thème résolu
- `MAP_STYLE_DARK(token)` / `MAP_STYLE_LIGHT(token)` : retourne l'URL Jawg correspondante (jawg-dark vs jawg-sunny)

**2. `src/app/layout.tsx`** — prévention du FOUC (Flash Of Unstyled Content).
Un inline script synchrone s'exécute avant le premier paint pour lire `localStorage` et appliquer la classe correcte sur `<html>` immédiatement.

```ts
// Script injecté via dangerouslySetInnerHTML dans <head>
(function() {
  var stored = localStorage.getItem('starmapper:theme');
  var preferLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  var resolved = stored === 'light' || stored === 'dark' ? stored : (preferLight ? 'light' : 'dark');
  document.documentElement.classList.add(resolved);
})();
```

**3. `src/app/globals.css`** — tokens CSS définis en trois blocs :

```css
/* Base (dark — défaut si aucune classe) */
:root { --color-background: #0d1117; ... }

/* Override auto OS */
@media (prefers-color-scheme: light) {
  :root:not(.dark) { --color-background: #ffffff; ... }
}

/* Override manuel (classe appliquée par applyTheme()) */
html.light { --color-background: #ffffff; ... }
html.dark  { --color-background: #0d1117; ... }
```

**4. `src/components/theme-toggle.tsx`** — bouton dans le header, appelle `applyTheme()` + `setStoredTheme()` au clic.

### Priorité de résolution

```
localStorage override ("light" | "dark")
    > prefers-color-scheme OS preference
        > dark (défaut)
```

### Règles d'implémentation

- **Toujours utiliser les tokens CSS** (`bg-background`, `text-foreground`...) — jamais de valeurs hex directes. Les tokens s'adaptent automatiquement au mode actif.
- **Les tuiles MapLibre** sont swappées via `MAP_STYLE_DARK`/`MAP_STYLE_LIGHT` dans `theme.ts` — le map écoute le changement de thème et recharge son style.
- **`"use client"` obligatoire** sur tout composant qui importe de `theme.ts` (accès localStorage).

---

## 10. Anti-patterns

| ❌ Interdit | ✅ Correct |
|------------|-----------|
| `bg-[#0d1117]` | `bg-background` |
| `text-[#8b949e]` | `text-muted` |
| `border-[#30363d]` | `border-border` |
| `bg-white` | `bg-surface` |
| Popup styles en inline JSX | Popup styles dans `.starmapper-popup` CSS |

---

*Dernière mise à jour : 2026-04-10 (v0.3.0)*
