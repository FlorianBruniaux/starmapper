---
name: postgres-neon-practices
description: PostgreSQL best practices for Prisma ORM + Neon serverless. Auto-suggest on queries, indexes, transactions, and monitoring in StarMapper context.
version: "1.0.0"
effort: medium
allowed-tools: [Read, Grep, Glob]
tags: [postgres, prisma, neon, performance, database]
---

# PostgreSQL + Neon Best Practices for StarMapper

Performance and reliability guidelines for PostgreSQL accessed through Prisma 7.5 on Neon serverless infrastructure.

## When to Apply

Reference these guidelines when:

- Writing or reviewing Prisma queries (`findMany`, transactions, raw SQL)
- Creating or modifying database indexes (`@@index` in schema.prisma)
- Reviewing pagination patterns
- Debugging slow queries or connection issues
- Planning for geocache growth (currently ~51k entries, grows with usage)

## StarMapper Stack

- **ORM**: Prisma 7.5 with typed client and `@prisma/adapter-neon`
- **Database**: Neon serverless PostgreSQL (managed pooling, autovacuum, HTTP transport)
- **Two modes**: `DATABASE_DRIVER=neon` (Vercel) or `DATABASE_DRIVER=standard` (Docker/Railway)
- **Storage limit**: 512MB free tier — monitored via `db-health.ts`

## Rule Categories by Priority

| Priority | Category | Impact | References |
|----------|----------|--------|------------|
| 1 | Query Performance | HIGH | partial-indexes, covering-indexes |
| 2 | Connection Management | HIGH | idle-timeout-neon, adapter-neon-pattern |
| 3 | Concurrency & Locking | MEDIUM | short-transactions, batch-upserts |
| 4 | Data Access Patterns | HIGH | cursor-pagination, geocache-lookup |
| 5 | Monitoring | MEDIUM | explain-analyze, storage-monitoring |

## Quick Reference

### 1. Query Performance

**Partial indexes** — Add WHERE conditions for frequently filtered status fields:
```prisma
@@index([owner, repo], map: "badge_cache_owner_repo_idx")
// Consider partial index if scanning only recent entries
```

**Covering indexes** — Include extra columns to avoid table lookups:
```prisma
// Instead of just @@index([key]), add lat/lng to avoid extra lookup
@@index([key]) // geocache — key is PK, direct lookup, OK
```

### 2. Connection Management (Neon-specific)

**adapter-neon pattern** — Required for serverless:
```typescript
// db.ts — correct
const { PrismaNeon } = require("@prisma/adapter-neon");
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
return new PrismaClient({ adapter });
```

**NO `url` field in schema.prisma** — Connection via adapter only:
```prisma
datasource db {
  provider = "postgresql"
  // NO url field — passed to adapter in db.ts
}
```

### 3. Concurrency & Locking

**Short transactions** — No external calls inside `$transaction()`:
```typescript
// ❌ BAD — external call inside transaction
await db.$transaction(async (tx) => {
  await callNominatim(location); // 1100ms inside transaction!
  await tx.geoCache.create({ ... });
});

// ✅ GOOD — geocode first, then write
const coords = await geocode(location);
await db.geoCache.create({ data: { key, lat: coords?.lat, lng: coords?.lng } });
```

**Bulk upserts** — Use `createMany` with `skipDuplicates` for batch geocache inserts:
```typescript
await db.geoCache.createMany({
  data: entries,
  skipDuplicates: true,
});
```

### 4. Data Access Patterns

**GeoCache lookup** — Always normalize key:
```typescript
const key = location.toLowerCase().trim();
const cached = await db.geoCache.findUnique({ where: { key } });
```

**Cursor pagination** — Use cursor-based for growing tables (avoid offset):
```typescript
// ✅ cursor-based (StargazerCache, StarEvent)
const results = await db.starEvent.findMany({
  take: 100,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { id: "asc" },
});
```

### 5. Monitoring

**Storage check** — `db-health.ts` pattern:
```typescript
// Check before writes that could overflow Neon 512MB
const health = await checkDbHealth();
if (health.usagePercent > 95) {
  return; // skip write, log warning
}
```

**EXPLAIN ANALYZE** — Use MCP postgres for slow query analysis:
```sql
EXPLAIN ANALYZE SELECT * FROM geocache WHERE key = 'paris';
```

## Detection Patterns

Auto-suggest these when detecting:

| Pattern | Suggested Rule |
|---------|---------------|
| `findMany` without cursor on large tables | cursor-pagination |
| `$transaction()` with external API calls | short-transactions |
| `@@index` missing on `(owner, repo)` composite | covering-indexes |
| Slow query reports | explain-analyze |
| DB write without `checkDbHealth()` | storage-monitoring |
| `skip: page * limit` pattern | cursor-pagination |

## StarMapper-Specific Notes

- **GeoCache** is pre-seeded with ~51k GeoNames entries. Key = lowercase+trimmed location string.
- **StargazerCache** stores gzip+base64 compressed JSON — avoid querying full `points` column in aggregates.
- **BadgeCache** is tiny and hot — no index concerns.
- **GitHubUser + StarEvent** will grow with usage. `starredAt` index important for time-based queries.
- **Never `prisma migrate dev`** — use `prisma db push` (no migration history needed for StarMapper).
