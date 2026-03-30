# TDD — Test-Driven Development (Auto-loaded)

## Directive

**Tout nouveau code dans `src/lib/` et `src/app/api/` DOIT être accompagné d'un test.**

StarMapper est à 0% de couverture aujourd'hui. L'objectif n'est pas d'imposer TDD dogmatique sur du code legacy, mais de ne pas aggraver la situation et de construire progressivement.

---

## Workflow Red-Green-Refactor

```
1. RED    → Écrire le test qui échoue
2. VERIFY → Lancer le test, confirmer qu'il échoue pour la bonne raison
3. GREEN  → Écrire le minimum de code pour passer
4. VERIFY → Lancer le test, confirmer qu'il passe
5. REFACTOR → Nettoyer (le test reste vert)
```

---

## Règles par zone

### Nouveau code (TDD OBLIGATOIRE)

| Zone | Type de test | Priorité |
|------|-------------|----------|
| `src/lib/geocoder.ts` | Unit — cache hit/miss, cascade fallback, null result | CRITIQUE |
| `src/lib/github.ts` | Unit — cursor handling, rate limit response | HAUTE |
| `src/lib/user-cache.ts` | Unit — DB health guard, skip on overflow | HAUTE |
| `src/app/api/chunk/route.ts` | Integration — full chunk processing | HAUTE |
| `src/app/api/stargazer-cache/` | Integration — compression/decompression | MOYENNE |
| `src/lib/countries.ts` | Unit — normalizeCountry | FAIBLE |

### Code existant (TDD fortement recommandé)

- Modifier une fonction existante sans test → ajouter le test en même temps
- Small fix to existing code → tests optional but encouraged
- Ne pas bloquer sur l'absence de test sur du legacy non-critique (UI, page layout)

---

## Exemples StarMapper

### Bon test (geocoder)

```typescript
// src/lib/geocoder.test.ts
test("geocode() retourne null pour une location vide", async () => {
  const result = await geocode("");
  expect(result).toBeNull();
});

test("geocode() hit cache — ne call pas Nominatim", async () => {
  const spy = vi.spyOn(nominatim, "call");
  // Préparer le cache avec "Paris" → { lat: 48.85, lng: 2.35 }
  await geocode("Paris");
  expect(spy).not.toHaveBeenCalled();
});
```

### Mauvais test (trop vague)

```typescript
test("geocoder works", async () => {
  const result = await geocode("Paris");
  expect(result).toBeDefined(); // ❌ trop vague
});
```

---

## Vitest Setup

StarMapper utilise Vitest. Tests dans les mêmes dossiers que les sources ou dans `src/__tests__/`.

```bash
pnpm test           # run all tests
pnpm test:watch     # watch mode
pnpm test:coverage  # coverage report
```

---

## Coverage Roadmap

| Milestone | Target | Focus |
|-----------|--------|-------|
| **Actuel** | ~0% | Baseline |
| **Phase 1** | 15% | geocoder.ts, github.ts, user-cache.ts |
| **Phase 2** | 30% | API routes critiques (chunk, stargazer-cache) |
| **Phase 3** | 60% | lib/ complet, routes importantes |

---

## Exceptions (ask user first)

- Scripts one-shot (`scripts/`)
- Config files
- Generated code (Prisma client)
- Page layout components sans logique métier

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
