# React Ref Patterns (Auto-loaded)

## Callback Ref Pattern (Recommandé)

Pour notifier le parent quand un élément enfant est monté/démonté.

```tsx
// ✅ Callback ref — parent reçoit la ref directement
const Parent = () => {
  const handleMapRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      // node est disponible — initialiser MapLibre ici
    }
  }, []);

  return <div ref={handleMapRef} className="w-full h-full" />;
};
```

---

## useRef + cleanup (MapLibre pattern)

```tsx
const mapRef = useRef<maplibregl.Map | null>(null);
const containerRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  if (!containerRef.current) return;

  mapRef.current = new maplibregl.Map({
    container: containerRef.current,
    // ...
  });

  return () => {
    // OBLIGATOIRE : cleanup pour éviter les leaks
    mapRef.current?.remove();
    mapRef.current = null;
  };
}, []);
```

---

## Anti-patterns

```tsx
// ❌ MutationObserver dans un composant React
useEffect(() => {
  const observer = new MutationObserver(() => { ... });
  observer.observe(document.querySelector(".map"), ...);
  // → fragile, couplé au DOM, ignore le cycle de vie React
});

// ❌ document.querySelector dans un composant React
const el = document.querySelector(".cluster-popup");
// → utiliser useRef à la place
```

---

## forwardRef vs Callback Prop

| Situation | Pattern |
|-----------|---------|
| Composant enfant expose une ref au parent | `forwardRef` |
| Parent veut être notifié du montage | Callback prop `onMounted` |
| Ref interne uniquement | `useRef` local |

---

## MapLibre : combinaison ref interne + callback

```tsx
const StargazerMap = memo(({ onReady }: { onReady?: (map: Map) => void }) => {
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const map = new maplibregl.Map({ ... });
    mapRef.current = map;
    map.on("load", () => onReady?.(map));  // Notifier le parent

    return () => { map.remove(); mapRef.current = null; };
  }, [onReady]);
});
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
