# Timer Cleanup Pattern (Auto-loaded)

## Règle : tout setInterval/setTimeout dans useEffect DOIT avoir un cleanup

```typescript
// ✅ Correct
useEffect(() => {
  const id = setInterval(() => {
    /* tick */
  }, 1000);
  return () => clearInterval(id); // OBLIGATOIRE
}, []);

// ❌ Memory leak + timers multiples au re-render
useEffect(() => {
  setInterval(() => {
    /* tick */
  }, 1000); // pas de cleanup
}, []);
```

## Règle : polling conditionnel — toujours avec timeout de sécurité

Pertinent pour StarMapper : polling du résultat de scan, attente de chargement MapLibre.

```typescript
// ❌ Potentiellement infini si condition jamais vraie
const id = setInterval(() => {
  if (map.isStyleLoaded()) {
    clearInterval(id);
    proceed();
  }
}, 100);

// ✅ Avec timeout de sécurité
useEffect(() => {
  let iterations = 0;
  const MAX = 50; // 5s max
  const id = setInterval(() => {
    iterations++;
    if (map.isStyleLoaded() || iterations >= MAX) {
      clearInterval(id);
      if (map.isStyleLoaded()) proceed();
    }
  }, 100);
  return () => clearInterval(id);
}, []);
```

## Règle : nommage — le nom du ref doit correspondre au type de timer

```typescript
// ❌ Trompeur : "Timeout" mais c'est un Interval
const retryTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null);

// ✅ Précis
const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

## Règle : chunk loop — ne pas démarrer un nouveau chunk si le précédent tourne encore

```typescript
// ❌ Chunks parallèles → Nominatim rate limit dépassé
useEffect(() => {
  setInterval(() => {
    fetchChunk(cursor); // peut se superposer
  }, 500);
}, [cursor]);

// ✅ Séquentiel : chaque chunk déclenche le suivant à la fin
const runChunk = async (cursor: string | null) => {
  const result = await fetchChunk(cursor);
  if (result.nextCursor) runChunk(result.nextCursor);
};
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
