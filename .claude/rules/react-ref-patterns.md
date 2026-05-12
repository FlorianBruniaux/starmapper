# React Ref Patterns (Auto-loaded)

## Callback Ref Pattern (Recommended)

To notify the parent when a child element is mounted/unmounted.

```tsx
// ✅ Callback ref — parent receives the ref directly
const Parent = () => {
  const handleMapRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      // node is available — initialize MapLibre here
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
    // MANDATORY: cleanup to prevent leaks
    mapRef.current?.remove();
    mapRef.current = null;
  };
}, []);
```

---

## Anti-patterns

```tsx
// ❌ MutationObserver inside a React component
useEffect(() => {
  const observer = new MutationObserver(() => { ... });
  observer.observe(document.querySelector(".map"), ...);
  // → fragile, coupled to DOM, ignores React lifecycle
});

// ❌ document.querySelector inside a React component
const el = document.querySelector(".cluster-popup");
// → use useRef instead
```

---

## forwardRef vs Callback Prop

| Situation | Pattern |
|-----------|---------|
| Child component exposes a ref to the parent | `forwardRef` |
| Parent wants to be notified of mounting | Callback prop `onMounted` |
| Internal ref only | local `useRef` |

---

## MapLibre: Internal Ref + Callback Combination

```tsx
const StargazerMap = memo(({ onReady }: { onReady?: (map: Map) => void }) => {
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const map = new maplibregl.Map({ ... });
    mapRef.current = map;
    map.on("load", () => onReady?.(map));  // Notify the parent

    return () => { map.remove(); mapRef.current = null; };
  }, [onReady]);
});
```

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
