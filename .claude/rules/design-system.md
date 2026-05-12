# Design System Rules — StarMapper (Auto-loaded)

## Directive

**Never guess a color or a spacing value.**
Always use the CSS tokens defined in `src/app/globals.css`.

---

## Token Hierarchy (MANDATORY)

```
CSS @theme tokens  >  Standard Tailwind classes  >  ❌ Arbitrary values
```

**Never**: `bg-[#0d1117]`, `text-[#8b949e]`, `border-[#30363d]`
**Always**: `bg-background`, `text-muted`, `border-border`

---

## StarMapper Palette → Tailwind Classes

### Backgrounds
| Need | Class |
|------|-------|
| App background | `bg-background` |
| Card / popup | `bg-surface` |
| Hover / input | `bg-surface-alt` |

### Text
| Need | Class |
|------|-------|
| Primary text | `text-foreground` |
| Secondary text | `text-muted` |
| Subtle text | `text-muted-subtle` |

### Borders
| Need | Class |
|------|-------|
| Standard border | `border-border` |
| Light separator | `border-border-subtle` |

### Accents
| Need | Class |
|------|-------|
| Links / info | `text-accent-blue` |
| CTA / success | `bg-accent-green` |
| Errors | `text-accent-red` |

---

## Enforced UI Patterns

### Input
```tsx
className="bg-surface border border-border rounded-md px-3 py-2 text-sm
           text-foreground placeholder:text-muted
           focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
```

### CTA Button
```tsx
className="bg-accent-green text-white font-semibold px-4 py-2 rounded-md
           text-sm hover:opacity-90 transition-opacity"
```

### Ghost Button
```tsx
className="border border-border text-muted px-3 py-1.5 rounded-md text-sm
           hover:text-foreground hover:border-accent-blue/50 transition-colors"
```

---

## MapLibre: Outside Tailwind Scope

MapLibre layer styles (point colors, clusters) are defined in JS inside `stargazer-map.tsx`.
Popup styles live in `.starmapper-popup` in `globals.css`.
**Do not use Tailwind to style MapLibre elements.**

---

## Layout Rule

- The map always occupies `flex-1` or `100vh - header`
- Overlays (stats, drawer) are `position: absolute` on top of the map
- **Never** `position: fixed` on mobile (virtual keyboard)

---

## Pre-commit UI Checklist

- [ ] 0 arbitrary Tailwind values (`[Npx]`)
- [ ] 0 direct hex colors (`bg-[#xxx]`)
- [ ] CSS tokens used for all repeated colors
- [ ] Focus ring present on interactive elements
- [ ] Touch target ≥ 44px on mobile

---

**Full reference**: `docs/design-system.md`

**Auto-loaded**: This file is loaded automatically at every Claude session start.
