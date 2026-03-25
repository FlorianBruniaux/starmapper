# Implementation Checklist (Auto-loaded)

## Purpose

Force systematic verification of project conventions BEFORE, DURING, and AFTER implementation.

**This checklist is auto-loaded at every session start.**

---

## Before Writing ANY Code

**Mental checkpoint BEFORE opening Write/Edit tool:**

- [ ] **Read applicable conventions** from `.claude/rules/`
  - [ ] `design-system.md` - Tailwind v4 tokens + StarMapper palette
  - [ ] `tailwind-standards.md` - No arbitrary values
  - [ ] `react-ref-patterns.md` - React + MapLibre ref patterns
  - [ ] `defensive-code-audit.md` - Error handling (API routes, Nominatim, GitHub)

- [ ] **Identify the layer** for this task
  - [ ] Server Action / Route Handler (in `src/app/api/`)?
  - [ ] React component (in `src/components/`)?
  - [ ] Utility/lib (geocoder, github client, prisma)?
  - [ ] MapLibre layer logic?

- [ ] **Plan verification**
  - [ ] How will I test this? (visual, unit, curl)
  - [ ] Is there a Nominatim rate limit concern?
  - [ ] Does this touch the DB? (Prisma migration needed?)

---

## DURING Implementation

**Active checklist while writing code:**

### TypeScript Conventions

- [ ] **Arrow functions only**: `export const myFunc = () => {}`
  - Never `export function myFunc() {}`

- [ ] **Type imports separate**:
  - `import type { FC } from 'react'`
  - Never `import { FC } from 'react'`

- [ ] **No `any`**: Use proper types or `unknown` + narrowing

### Tailwind v4 Conventions

- [ ] **No arbitrary values**:
  - Never `w-[40px]` → use `w-10`
  - Never `text-[12px]` → use `text-xs`
  - Never `gap-[8px]` → use `gap-2`

- [ ] **Use CSS tokens from `@theme`**:
  - Never `bg-[#0d1117]` → use `bg-background`
  - Never `text-[#f0f6fc]` → use `text-foreground`
  - Never `border-[#30363d]` → use `border-default`

- [ ] **Dark-first**: No `dark:` prefix needed (dark is default)

### React Patterns

- [ ] **Callback refs for MapLibre** — not `useRef` + `useEffect` combo
- [ ] **Cleanup on unmount** — MapLibre `map.remove()` in ref callback teardown
- [ ] **useCallback** for event handlers passed as props
- [ ] **No `document.querySelector`** — use React refs

### Defensive Patterns

- [ ] **No silent catches** in API routes:
  - Never `catch (error) { console.error(error) }` → return `NextResponse.json({ error: ... }, { status: 500 })`

- [ ] **Nominatim rate limit**: 1 request/second minimum between calls
  - Never call Nominatim in a loop without delay
  - Check GeoCache before calling Nominatim

- [ ] **GitHub GraphQL cursor**: check `hasNextPage` before paginating
  - Never assume `endCursor` is valid without checking

- [ ] **Prisma null checks**:
  - Never `const result = await db.find() || {}`
  - Always `if (!result) return null` or throw

- [ ] **Promise.all not forEach**:
  - Never `items.forEach(async (i) => await process(i))`
  - Always `await Promise.all(items.map(async (i) => process(i)))`

---

## AFTER Implementation (MANDATORY)

**Before committing:**

### Self-Review

- [ ] **Re-read modified files**
  - Any forgotten `console.log`?
  - Any `TODO` left in code?
  - Any hardcoded values (URLs, tokens, coordinates)?

- [ ] **Mobile layout check**
  - No `position: fixed` without testing virtual keyboard
  - Touch targets ≥ 44px

- [ ] **MapLibre check** (if touched)
  - Map cleanup on unmount
  - No memory leaks (event listeners removed)
  - Popup z-index correct

### External Verification

- [ ] **TypeScript**: `rtk tsc` (or `pnpm tsc --noEmit`)
- [ ] **Lint**: `pnpm lint` if configured
- [ ] **Visual check**: Open localhost:3000 and verify

---

## Quick Reference

```bash
# TypeScript check
rtk tsc

# Check for common violations
grep -rn "export function" src/ --include="*.ts" --include="*.tsx"
grep -rn 'w-\[[0-9]' src/ --include="*.tsx"
grep -rn 'bg-\[#' src/ --include="*.tsx"
grep -rn 'console\.log' src/ --include="*.ts" --include="*.tsx"
```

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
