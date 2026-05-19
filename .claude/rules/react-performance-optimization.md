# React Performance Optimization (Auto-loaded)

## React.memo — quand l'utiliser

Wrapper avec `React.memo` si **tous** ces critères sont vrais :

1. Le composant re-render souvent (parent fréquemment mis à jour)
2. Le composant est "pur" (mêmes props → même output)
3. Le render est coûteux (calculs lourds, liste longue, MapLibre)

```typescript
// ✅ Coûteux + parent souvent mis à jour (ex: StargazerMap reçoit des points à chaque chunk)
const StargazerMap = React.memo(({ points, onMarkerClick }: StargazerMapProps) => (
  <div ref={mapRef} />
));

// ❌ Inutile sur un composant trivial qui re-render rarement
const Title = React.memo(({ text }: { text: string }) => <h1>{text}</h1>);
```

## Anti-pattern : composants définis inline dans le parent

```typescript
// ❌ Composant recréé à chaque render du parent → toujours re-mount
const ParentComponent = () => {
  const InlineCard = ({ value }: { value: number }) => <div>{value}</div>; // PROBLÈME

  return <InlineCard value={42} />;
};

// ✅ Définir en dehors du parent
const MetricCard = ({ value }: { value: number }) => <div>{value}</div>;

const ParentComponent = () => <MetricCard value={42} />;
```

## useMemo — décision tree

Utiliser `useMemo` uniquement si :

- Calcul coûteux (construction de GeoJSON features, tri/filtre sur >100 items)
- OU la valeur est passée comme prop à un composant mémoïsé

```typescript
// ✅ Construction GeoJSON coûteuse — recalculée seulement si points changent
const geoJsonData = useMemo(
  () => ({
    type: "FeatureCollection" as const,
    features: points.map(p => ({
      type: "Feature" as const,
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { login: p.login },
    })),
  }),
  [points],
);

// ❌ Calcul trivial — useMemo coûte plus cher que le calcul lui-même
const label = useMemo(() => `${count} stars`, [count]);
// → const label = `${count} stars`; (simple)
```

## useCallback — même règle

Utiliser `useCallback` si la fonction est passée à un composant mémoïsé ou dans un tableau de dépendances `useEffect`.

```typescript
// ✅ Passé à un composant mémoïsé — stabilise la référence
const handleMarkerClick = useCallback((login: string) => {
  setSelectedUser(login);
}, []);

// ❌ Inutile si la fonction n'est pas partagée vers l'extérieur
const handleClose = useCallback(() => setOpen(false), []); // setState simple → pas besoin
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
