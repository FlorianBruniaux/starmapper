# Search Strategy (Auto-loaded)

## Decision Tree

```
Search task received ?
├─ Known file path → Read directly (fastest)
├─ Known symbol/function name → Grep (exact pattern, ~20ms)
├─ Concept / intent-based → Explore agent or Grepai (semantic)
└─ Directory structure unknown → Glob first, then Read
```

## Tool Selection Matrix

| Need | Tool | Example |
|------|------|---------|
| Find file by name | Glob | `Glob("**/user-details/**")` |
| Find function definition | Grep | `Grep("const fetchStargazersPage")` |
| Find all usages of a type | Grep | `Grep("StargazerPoint", type="ts")` |
| Explore unknown directory | Glob + Read | `Glob("src/**/*.ts")` → Read |
| Understand feature scope | Explore agent | "where is badge logic implemented?" |
| Semantic search (intent) | Explore agent | "find rate limit handling" |

## StarMapper-Specific Shortcuts

| Symbol | Location |
|--------|----------|
| `StargazerPoint`, `UnmappedUser` | `src/app/api/chunk/route.ts` |
| `UserDetail` | `src/app/api/user-details/route.ts` |
| `geocode()`, `geocodeBatch()` | `src/lib/geocoder.ts` |
| `fetchStargazersPage()` | `src/lib/github.ts` |
| `prisma` singleton | `src/lib/db.ts` |
| MapLibre GL map init | `src/components/map/stargazer-map.tsx` |
| `@theme` tokens | `src/app/globals.css` |

## Rules

- Never use `find` or `ls` bash commands — use Glob
- Never use `grep` bash commands — use Grep tool
- For cross-file analysis (call graphs, impact) → Explore agent
- Grep before Read — confirm the symbol exists before loading the full file

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
