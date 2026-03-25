# Defensive Code Audit (Auto-loaded)

Patterns détectés automatiquement pendant l'écriture. Stop immédiat si trouvé.

---

## 1. Silent Catches (CRITICAL)

```ts
// ❌ JAMAIS — erreur avalée silencieusement
try {
  const data = await fetchStargazersPage(...);
} catch (error) {
  console.error(error);  // Avalé, caller ne sait pas
}

// ✅ TOUJOURS — propager ou retourner NextResponse d'erreur
try {
  const data = await fetchStargazersPage(...);
} catch (error) {
  return NextResponse.json({ error: "github_error" }, { status: 500 });
}
```

---

## 2. Hidden Fallbacks sur Prisma (HIGH)

```ts
// ❌ JAMAIS — null masqué comme objet vide
const cached = await db.geoCache.findFirst(...) || {};

// ✅ TOUJOURS — guard explicite
const cached = await db.geoCache.findFirst(...);
if (!cached) return null;
```

---

## 3. Async dans forEach (CRITICAL)

```ts
// ❌ JAMAIS — les promises ne sont pas attendues
locations.forEach(async (loc) => {
  await geocode(loc);
});

// ✅ TOUJOURS
await Promise.all(locations.map(async (loc) => geocode(loc)));
```

---

## 4. Nominatim Rate Limit (HIGH — StarMapper-specific)

```ts
// ❌ JAMAIS — appels Nominatim en parallèle
await Promise.all(locations.map(loc => callNominatim(loc)));

// ✅ TOUJOURS — séquentiel avec délai 1100ms
for (const loc of locations) {
  await callNominatim(loc);
  await sleep(1100);
}
```

---

## 5. GitHub Cursor null (MEDIUM)

```ts
// ❌ JAMAIS — null comme variable GraphQL
variables: { cursor: null }

// ✅ TOUJOURS — omettre la variable ou passer undefined
variables: cursor ? { cursor } : {}
```

---

## 6. Géocache — clé non normalisée (HIGH)

```ts
// ❌ JAMAIS — casse inconsistante
const key = location;

// ✅ TOUJOURS — lowercase + trim
const key = location.toLowerCase().trim();
```

---

## Definition of Done

Avant tout commit :

- [ ] 0 `console.error` sans re-throw dans les API routes
- [ ] 0 `|| {}` ou `|| []` sur des retours Prisma
- [ ] 0 `forEach` avec `async`
- [ ] Nominatim : toujours 1100ms de délai entre appels
- [ ] `rtk tsc` → 0 erreur

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
