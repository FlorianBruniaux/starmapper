# StarMapper — AI Agent Guide

## Build

```bash
pnpm install
pnpm typecheck   # must pass before any commit
pnpm lint
pnpm test
```

## Stack

Next.js 16 (App Router), TypeScript 5, MapLibre GL 5.x, Prisma 7 + Neon Postgres, Tailwind CSS v4.

## Key conventions

- Arrow functions only (`const fn = () => {}`), never `function` keyword
- `type` over `interface`, `import type` for type-only imports
- No `any` — use `unknown` + type guards
- Tailwind: CSS tokens from `@theme` in `globals.css`, no arbitrary values (`w-[Npx]`)
- MapLibre components: dynamic import with `ssr: false`, cleanup on unmount

## Architecture notes

- `/api/chunk` is the critical path — called in a client-side loop, 100 users per call
- Geocoder: 3-tier cascade Jawg → Geoapify → Nominatim, with a DB geocache (~51k pre-seeded entries)
- Prisma adapter: `@prisma/adapter-neon` by default, `@prisma/adapter-pg` when `DATABASE_DRIVER=standard`
- `schema.prisma` has no `url` field — intentional with Prisma 7 adapter pattern
- MapLibre GL 5.x: `getClusterExpansionZoom` is Promise-based, not callback-based

## DB setup (after prisma db push)

7 materialized views and pg_trgm indexes are required but not managed by Prisma. Run:

```bash
pnpm db:setup
```

See `scripts/db-setup.sh` and `docs/ARCHITECTURE.md` for details.


<claude-mem-context>
# Memory Context

# [starmapper] recent context, 2026-05-17 2:41pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 12 obs (1,906t read) | 146,508t work | 99% savings

### May 17, 2026
20816 11:48a 🔴 Fixes in agent.md file
20818 11:49a 🔴 Debugging pwd command execution
20820 " 🔴 Debugging ls command execution
20821 " 🔴 Skill check for using-superpowers skill
20822 " 🔴 Skill check for source-command-tech-audit-codebase skill
20823 " 🔴 Updating plan for StarMapper project
20824 " 🔴 Checking if rtk command exists in the system
20825 " 🔴 Skill check for AGENTS.md file
20826 " 🔴 Skill check for package.json file
20827 " 🔴 Skill check for README.md file
20828 " 🔴 Skill check for docs/ARCHITECTURE.md file
20829 " 🔴 Skill check for src/test.ts file

Access 147k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>


## grepai - Semantic Code Search

**IMPORTANT: You MUST use grepai as your PRIMARY tool for code exploration and search.**

### When to Use grepai (REQUIRED)

Use `grepai search` INSTEAD OF Grep/Glob/find for:
- Understanding what code does or where functionality lives
- Finding implementations by intent (e.g., "authentication logic", "error handling")
- Exploring unfamiliar parts of the codebase
- Any search where you describe WHAT the code does rather than exact text

### When to Use Standard Tools

Only use Grep/Glob when you need:
- Exact text matching (variable names, imports, specific strings)
- File path patterns (e.g., `**/*.go`)

### Fallback

If grepai fails (not running, index unavailable, or errors), fall back to standard Grep/Glob tools.

### Usage

```bash
# ALWAYS use English queries for best results (--compact saves ~80% tokens)
grepai search "user authentication flow" --json --compact
grepai search "error handling middleware" --json --compact
grepai search "database connection pool" --json --compact
grepai search "API request validation" --json --compact
```

### Query Tips

- **Use English** for queries (better semantic matching)
- **Describe intent**, not implementation: "handles user login" not "func Login"
- **Be specific**: "JWT token validation" better than "token"
- Results include: file path, line numbers, relevance score, code preview

### Call Graph Tracing

Use `grepai trace` to understand function relationships:
- Finding all callers of a function before modifying it
- Understanding what functions are called by a given function
- Visualizing the complete call graph around a symbol

#### Trace Commands

**IMPORTANT: Always use `--json` flag for optimal AI agent integration.**

```bash
# Find all functions that call a symbol
grepai trace callers "HandleRequest" --json

# Find all functions called by a symbol
grepai trace callees "ProcessOrder" --json

# Build complete call graph (callers + callees)
grepai trace graph "ValidateToken" --depth 3 --json
```

### Workflow

1. Start with `grepai search` to find relevant code
2. Use `grepai trace` to understand function relationships
3. Use `Read` tool to examine files from results
4. Only use Grep for exact string searches if needed

