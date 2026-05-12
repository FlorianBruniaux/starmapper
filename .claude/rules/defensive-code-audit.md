# Defensive Code Audit (Auto-loaded)

Patterns detected automatically while writing. Stop immediately if found.

---

## 1. Silent Catches (CRITICAL)

```ts
// ❌ NEVER — error silently swallowed
try {
  const data = await fetchStargazersPage(...);
} catch (error) {
  console.error(error);  // Swallowed, caller doesn't know
}

// ✅ ALWAYS — propagate or return a NextResponse error
try {
  const data = await fetchStargazersPage(...);
} catch (error) {
  return NextResponse.json({ error: "github_error" }, { status: 500 });
}
```

---

## 2. Hidden Fallbacks on Prisma (HIGH)

```ts
// ❌ NEVER — null masked as empty object
const cached = await db.geoCache.findFirst(...) || {};

// ✅ ALWAYS — explicit guard
const cached = await db.geoCache.findFirst(...);
if (!cached) return null;
```

---

## 3. Async inside forEach (CRITICAL)

```ts
// ❌ NEVER — promises are not awaited
locations.forEach(async (loc) => {
  await geocode(loc);
});

// ✅ ALWAYS
await Promise.all(locations.map(async (loc) => geocode(loc)));
```

---

## 4. Nominatim Rate Limit (HIGH — StarMapper-specific)

```ts
// ❌ NEVER — parallel Nominatim calls
await Promise.all(locations.map(loc => callNominatim(loc)));

// ✅ ALWAYS — sequential with 1100ms delay
for (const loc of locations) {
  await callNominatim(loc);
  await sleep(1100);
}
```

---

## 5. GitHub Cursor null (MEDIUM)

```ts
// ❌ NEVER — null as GraphQL variable
variables: { cursor: null }

// ✅ ALWAYS — omit the variable or pass undefined
variables: cursor ? { cursor } : {}
```

---

## 6. Geocache — unnormalized key (HIGH)

```ts
// ❌ NEVER — inconsistent casing
const key = location;

// ✅ ALWAYS — lowercase + trim
const key = location.toLowerCase().trim();
```

---

## Definition of Done

Before any commit:

- [ ] 0 `console.error` without re-throw in API routes
- [ ] 0 `|| {}` or `|| []` on Prisma return values
- [ ] 0 `forEach` with `async`
- [ ] Nominatim: always 1100ms delay between calls
- [ ] `rtk tsc` → 0 errors

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
