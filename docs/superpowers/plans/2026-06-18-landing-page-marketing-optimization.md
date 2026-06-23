# Landing Page Marketing Optimization: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the StarMapper homepage so a first-time visitor understands the product value in one glance, before ever scrolling.

**Architecture:** All changes are in two files: `src/app/_components/landing-client.tsx` (the entire visible page) and `src/app/page.tsx` (server-side fetch count). No new files. No new dependencies. Pure copy + structure rewrite.

**Tech Stack:** Next.js 16 App Router, React, Tailwind v4 CSS tokens (no arbitrary values).

## Global Constraints

- Tailwind v4: no arbitrary values (`w-[40px]` etc.), use tokens from `@theme` in `src/app/globals.css`
- CSS semantic tokens only: `bg-background`, `text-foreground`, `text-muted`, `border-border`, `bg-surface`, etc.
- Arrow functions only (`const X = () => {}`, never `function X()`)
- No `any`, no `console.log`
- `rtk tsc` must return 0 errors after every task
- All changes are visual/copy, no TypeScript type changes, no new imports needed
- Never modify MapLibre components or the chunk loop

---

## File Map

| File | What changes |
|------|-------------|
| `src/app/_components/landing-client.tsx` | Hero subtitle · 3 bullet points · Steps line · Social proof · Community Maps section |
| `src/app/page.tsx` | Fetch 6 repos instead of 12 |

---

## Task 1: Rewrite the hero subtitle

**Files:**
- Modify: `src/app/_components/landing-client.tsx` (lines 164–167)

**Context:** The current subtitle uses the word "stargazers" which doesn't resonate with a first-time visitor who hasn't yet understood the product. "GitHub audience" is immediately clearer.

Current text (line 164–167):
```tsx
<p className="text-muted text-lg leading-relaxed max-w-lg">
  Know where your stargazers live, who the influential
  ones are, and whether the count is real.
</p>
```

- [ ] **Step 1: Replace the subtitle text**

Replace with:
```tsx
<p className="text-muted text-lg leading-relaxed max-w-lg">
  See where your GitHub audience lives, who the 10k-reach fans are,
  and whether the star count is real.
</p>
```

- [ ] **Step 2: Verify TypeScript**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Step 3: Visual check**

Open `http://localhost:3000` (or `pnpm dev` if not running). Confirm the new subtitle renders correctly under the H1.

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/landing-client.tsx
git commit -m "copy(ui): rewrite hero subtitle, stargazers to GitHub audience"
```

---

## Task 2: Rewrite the 3 bullet points

**Files:**
- Modify: `src/app/_components/landing-client.tsx` (lines 171–208)

**Context:** The current 3 bullets lead with Organic Score (fake stars), an advanced feature. A first-time visitor needs to understand the core value first (geographical map), then filtering for influence, then trust/fake stars. The new order: geographic, influence, trust.

Current bullet order:
1. Organic Score: flags fake stars
2. Influential stargazers: filter by follower count
3. Dependent repos: shows every project using your library

New order and wording:
1. Pinpoint your audience: see exactly where fans live
2. Influential stargazers: filter to 1k+ reach devs
3. Organic Score: flags fake stars

- [ ] **Step 1: Replace the `<ul>` block (lines ~171–208)**

Replace the entire `<ul className="flex flex-col gap-2.5" aria-label="Key features">` block with:

```tsx
<ul className="flex flex-col gap-2.5" aria-label="Key features">
  <li className="flex items-start gap-2.5 text-sm">
    <span className="mt-0.5 size-4 shrink-0 rounded-full
      bg-accent-blue/15 flex items-center justify-center">
      <span className="size-1.5 rounded-full bg-accent-blue" />
    </span>
    <span className="text-muted">
      <span className="text-foreground font-medium">
        See your audience on a map
      </span>
      {" "}(country, city, continent) updated in real time as we scan
    </span>
  </li>
  <li className="flex items-start gap-2.5 text-sm">
    <span className="mt-0.5 size-4 shrink-0 rounded-full
      bg-accent-purple/15 flex items-center justify-center">
      <span className="size-1.5 rounded-full bg-accent-purple" />
    </span>
    <span className="text-muted">
      <span className="text-foreground font-medium">
        Influential stargazers
      </span>
      {" "}filter by follower count to surface the 1k-reach devs in your audience
    </span>
  </li>
  <li className="flex items-start gap-2.5 text-sm">
    <span className="mt-0.5 size-4 shrink-0 rounded-full
      bg-accent-orange/15 flex items-center justify-center">
      <span className="size-1.5 rounded-full bg-accent-orange" />
    </span>
    <span className="text-muted">
      <span className="text-foreground font-medium">
        Organic Score
      </span>
      {" "}flags fake stars before investors or users trust the count
    </span>
  </li>
</ul>
```

- [ ] **Step 2: Verify TypeScript**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Step 3: Visual check**

Confirm 3 bullets appear with correct colors: blue (map), purple (influence), orange (organic score). Check all 3 render on mobile width too (dev tools → 390px).

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/landing-client.tsx
git commit -m "copy(ui): reorder hero bullets, geographic to influence to organic score"
```

---

## Task 3: Move the steps line above the form

**Files:**
- Modify: `src/app/_components/landing-client.tsx` (the `<form>` block and the steps paragraph)

**Context:** The "1. Paste a repo · 2. We scan GitHub · 3. Everyone sees the map" line is currently at the bottom of the suggestions block, in `text-2xs text-muted-subtle`. It's the clearest explanation of how the product works, and it's nearly invisible. Move it just above the `<form>` element, as a standalone line that sets expectations before the user types.

The steps paragraph to move is currently inside `<div className="flex flex-col gap-3">` (the suggestions + social proof block), at the bottom:
```tsx
<p className="text-2xs text-muted-subtle flex items-center gap-1.5">
  <span>1. Paste a repo</span>
  <span className="text-border" aria-hidden="true">·</span>
  <span>2. We scan GitHub</span>
  <span className="text-border" aria-hidden="true">·</span>
  <span>3. Everyone sees the map</span>
</p>
```

- [ ] **Step 1: Remove the steps paragraph from the suggestions block**

Find and delete the `<p className="text-2xs text-muted-subtle flex items-center gap-1.5">` block (the three "1. Paste · 2. We scan · 3. Everyone" spans) from its current position inside the `<div className="flex flex-col gap-3">` block.

- [ ] **Step 2: Add the steps line just above the `<form>` element**

Insert this block immediately before `<form data-tour="landing-search" onSubmit={handleSubmit}`:

```tsx
{/* How it works: 3 steps, above the form */}
<p className="text-xs text-muted-subtle flex items-center gap-1.5">
  <span>1. Paste a repo</span>
  <span className="text-border" aria-hidden="true">·</span>
  <span>2. We scan GitHub</span>
  <span className="text-border" aria-hidden="true">·</span>
  <span>3. Everyone sees the map</span>
</p>
```

Note: bump the font from `text-2xs` to `text-xs` so it reads more clearly at this position.

- [ ] **Step 3: Verify TypeScript**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Step 4: Visual check**

The steps line should now appear *above* the input field. The suggestions/social proof block below the form should no longer contain that line. Check that the layout doesn't break on mobile.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/landing-client.tsx
git commit -m "ux(ui): move how-it-works steps above the search form"
```

---

## Task 4: Improve social proof text

**Files:**
- Modify: `src/app/_components/landing-client.tsx` (the social proof paragraph inside the suggestions block)

**Context:** Current: `"{initialTotal.toLocaleString()}+ repos mapped by the community so far"`. This is abstract. Adding 3 well-known repos makes it immediately credible.

Current code (inside `<div className="flex flex-col gap-3">`):
```tsx
{initialTotal > 0 && (
  <p className="text-xs text-muted-subtle">
    {initialTotal.toLocaleString()}+ repos mapped by the
    community so far
  </p>
)}
```

- [ ] **Step 1: Replace the social proof paragraph**

```tsx
{initialTotal > 0 && (
  <p className="text-xs text-muted-subtle">
    {initialTotal.toLocaleString()}+ repos mapped, including{" "}
    <span className="text-muted">Next.js, React, and Rust</span>
  </p>
)}
```

- [ ] **Step 2: Verify TypeScript**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Step 3: Visual check**

Confirm the social proof reads: "2 459+ repos mapped, including Next.js, React, and Rust".

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/landing-client.tsx
git commit -m "copy(ui): strengthen social proof with named repos"
```

---

## Task 5: Reshape the Community Maps section

**Files:**
- Modify: `src/app/page.tsx` (fetch count: 12 → 6)
- Modify: `src/app/_components/landing-client.tsx` (section title + layout)

**Context:** The section currently shows 12 repos under "Community maps", a title that means nothing to a first-time visitor. Cutting to 6 repos and renaming to "Recently explored" makes it scannable and self-explanatory. The "Browse all N repos" button already exists; 12 rows is redundant.

### Step A: Reduce the server-side fetch to 6 repos

- [ ] **Step 1: Update the fetch in `page.tsx`**

In `src/app/page.tsx`, change line 13:
```tsx
// Before
const data = await fetchReposData(12, true);

// After
const data = await fetchReposData(6, true);
```

### Step B: Update the section in `landing-client.tsx`

- [ ] **Step 2: Rename "Community maps" → "Recently explored"**

Find this line (inside the community maps `<section>`):
```tsx
<h2 className="text-muted-subtle text-2xs uppercase tracking-widest">
  Community maps
</h2>
```

Replace with:
```tsx
<h2 className="text-muted-subtle text-2xs uppercase tracking-widest">
  Recently explored
</h2>
```

- [ ] **Step 3: Change the grid to 2 columns max on desktop**

Current grid:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
```

Replace with (6 repos × 2 cols = 3 rows, clean layout):
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
```

Grid stays the same (6 repos in a 3-col grid is 2 rows, which is fine). No change needed here. Only the fetch count and section title need updating.

- [ ] **Step 4: Verify TypeScript**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Step 5: Visual check**

The community section should now show 6 repos max, under the title "Recently explored", with the "Browse all N repos" button on the right. Check that the section still disappears gracefully if `initialRepos` is empty (the `{initialRepos.length > 0 && (` guard is already in place).

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/_components/landing-client.tsx
git commit -m "ux(ui): community maps → recently explored, reduce to 6 repos"
```

---

## Verification Pass

After all 5 tasks:

- [ ] **Full TypeScript check**

```bash
rtk tsc
```
Expected: 0 errors.

- [ ] **Visual review checklist**

Open `http://localhost:3000` and verify:

1. Hero subtitle says "See where your GitHub audience lives..."
2. Bullet 1 (blue dot): "See your audience on a map (country, city...)"
3. Bullet 2 (purple dot): "Influential stargazers: filter by follower count..."
4. Bullet 3 (orange dot): "Organic Score: flags fake stars..."
5. Steps line "1. Paste a repo · 2. We scan GitHub · 3. Everyone sees the map" appears *above* the input
6. Social proof reads "X+ repos mapped, including Next.js, React, and Rust"
7. Community section title says "Recently explored" (not "Community maps")
8. Community section shows 6 repos max

- [ ] **Mobile check** (390px viewport in dev tools)

All 3 bullets readable. Steps line doesn't wrap weirdly. Form layout intact.

- [ ] **Announce completion**

Copy changes: done. No new dependencies. No type changes. `rtk tsc` clean.
