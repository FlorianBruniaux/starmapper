# Design System Rules — StarMapper (Auto-loaded)

## Directive

**Ne jamais deviner une couleur ou une valeur de spacing.**
Toujours utiliser les tokens CSS définis dans `src/app/globals.css`.

---

## Hiérarchie des tokens (OBLIGATOIRE)

```
Tokens CSS @theme  >  Classes Tailwind standard  >  ❌ Valeurs arbitraires
```

**Jamais** : `bg-[#0d1117]`, `text-[#8b949e]`, `border-[#30363d]`
**Toujours** : `bg-background`, `text-muted`, `border-border`

---

## Palette StarMapper → Classes Tailwind

### Backgrounds
| Besoin | Classe |
|--------|--------|
| App background | `bg-background` |
| Card / popup | `bg-surface` |
| Hover / input | `bg-surface-alt` |

### Textes
| Besoin | Classe |
|--------|--------|
| Texte principal | `text-foreground` |
| Texte secondaire | `text-muted` |
| Texte très discret | `text-muted-subtle` |

### Bordures
| Besoin | Classe |
|--------|--------|
| Bordure standard | `border-border` |
| Séparateur léger | `border-border-subtle` |

### Accents
| Besoin | Classe |
|--------|--------|
| Links / info | `text-accent-blue` |
| CTA / succès | `bg-accent-green` |
| Erreurs | `text-accent-red` |

---

## Patterns UI imposés

### Input
```tsx
className="bg-surface border border-border rounded-md px-3 py-2 text-sm
           text-foreground placeholder:text-muted
           focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
```

### Bouton CTA
```tsx
className="bg-accent-green text-white font-semibold px-4 py-2 rounded-md
           text-sm hover:opacity-90 transition-opacity"
```

### Bouton Ghost
```tsx
className="border border-border text-muted px-3 py-1.5 rounded-md text-sm
           hover:text-foreground hover:border-accent-blue/50 transition-colors"
```

---

## MapLibre : hors portée Tailwind

Les styles des layers MapLibre (couleurs points, clusters) sont définis en JS dans `stargazer-map.tsx`.
Les styles des popups sont dans `.starmapper-popup` dans `globals.css`.
**Ne pas utiliser Tailwind pour styler les éléments MapLibre.**

---

## Règle Layout

- La carte occupe **toujours** `flex-1` ou `100vh - header`
- Les overlays (stats, drawer) sont `position: absolute` sur la carte
- **Jamais** `position: fixed` sur mobile (clavier virtuel)

---

## Checklist avant commit UI

- [ ] 0 valeur arbitraire Tailwind (`[Npx]`)
- [ ] 0 couleur hex directe (`bg-[#xxx]`)
- [ ] Tokens CSS utilisés pour toutes les couleurs répétées
- [ ] Focus ring présent sur éléments interactifs
- [ ] Touch target ≥ 44px sur mobile

---

**Référence complète** : `docs/design-system.md`

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
