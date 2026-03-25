# Task Management (Auto-loaded)

## When to Use Tasks

Use `TaskCreate` when the work has more than 3 steps OR touches more than 3 files. For small targeted changes, no task tracking needed.

## StarMapper Task Naming

```
starmapper-{scope}-{feature}
```

Examples:
- `starmapper-map-cluster-popup`
- `starmapper-api-badge-endpoint`
- `starmapper-db-geocache-import`

## Phases for StarMapper Features

Standard phase structure for a new feature:

```
Phase 1: DB schema (if needed) → prisma db push
Phase 2: API route
Phase 3: Client integration (map page or component)
Phase 4: Types exported + verified
Phase 5: TypeScript clean (rtk tsc)
```

## Chunk Loop Features

When a feature hooks into the chunk loop (anything triggered after/during stargazer fetch):

1. Identify the trigger point in `src/app/[owner]/[repo]/page.tsx`
2. Add server-side logic in `/api/chunk` or a new route
3. Client accumulates state progressively (not batch at end)
4. Test with a small repo first (< 100 stars) before large repos

## DB Changes Workflow

```bash
# After schema.prisma edit
npx prisma db push          # Apply to Neon
npx prisma generate         # Regenerate client
rtk tsc                     # Verify types
```

**Never** use `prisma migrate dev` — `db push` only (no migration history needed).

## Definition of Done (per task)

- [ ] Feature works end-to-end on localhost
- [ ] `rtk tsc` → 0 errors
- [ ] No `console.log` left in code
- [ ] Types exported from route file if used by client
- [ ] Commit staged and described

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
