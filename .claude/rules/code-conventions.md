# Code Conventions — StarMapper

## TypeScript

### const arrow functions only

```ts
// Correct
const fetchChunk = async (cursor: string | null): Promise<ChunkResult> => { ... };

// Wrong — never use function keyword
function fetchChunk(cursor: string | null) { ... }
```

### type over interface

```ts
// Correct
type StargazerPoint = { login: string; lat: number; lng: number; };

// Avoid
interface StargazerPoint { login: string; lat: number; lng: number; }
```

### import type for type-only imports

```ts
// Correct
import type { StargazerPoint } from "@/app/api/chunk/route";

// Wrong — Zod schemas and lib exports are runtime values
import type { geocodeBatch } from "@/lib/geocoder"; // this is a function, not a type
```

### No any, no enums

```ts
// Correct
const coords = (feature.geometry as GeoJSON.Point).coordinates;

// Wrong
const coords = (feature.geometry as any).coordinates;
```

## File Naming

kebab-case for all files and folders, no exceptions:
- `stargazer-map.tsx`
- `stargazer-map-dynamic.tsx`
- `repo-info/route.ts`
- `use-chunk-loop.ts` (hooks)

## Import Order

```ts
// --- External ---
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// --- Internal ---
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { fetchStargazersPage } from "@/lib/github";

// --- Types ---
import type { StargazerPoint } from "@/app/api/chunk/route";
```

## MapLibre GL Rules

- Always dynamic import with `ssr: false` — maplibre-gl cannot run in Node
- `memo()` + `useCallback()` for all map event handlers
- Use `map.isStyleLoaded()` guard before calling `source.setData()`
- `getClusterExpansionZoom` returns a Promise in v5 — use `.then()`, never callback

## React

- `memo()` for StargazerMap (re-renders on every points update = expensive)
- `useMemo()` for GeoJSON feature array construction
- Always cleanup map in useEffect return: `map.remove(); mapRef.current = null;`

## Formatting

- 2 spaces indentation
- Double quotes
- Semicolons always
- Trailing commas in multiline arrays/objects
- 100 char line limit
- Prettier runs automatically via hook on every Write/Edit

## API Route Conventions

- Route handlers are `const GET/POST = async (req) => NextResponse.json(...)`
- Always return typed responses — export the response type for client use
- Handle rate limit errors (429) explicitly, return `{ error: "rate_limit" }` with 429 status
- Never throw unhandled errors — wrap GitHub/Nominatim calls in try/catch

## Confidence Rule

Never implement without 97% confidence. If unsure about Nominatim behavior, GitHub GraphQL schema, or MapLibre GL API changes — check docs or ask before coding.
