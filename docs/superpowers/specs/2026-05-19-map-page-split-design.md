# Design: MapPage split — phase 3 (→ ~700 lignes)

**Date**: 2026-05-19
**Issue**: #50
**Contexte**: page.tsx est à 1373 lignes après les extractions précédentes (useScanController, StatsModal, GrowthModal, AllStargazersModal, BadgeModal, TimelapseBar, Dock, TopPanel, useWatchMode, useTimelapse). Cible : ~700 lignes.

---

## Périmètre

7 extractions. Pas de changement fonctionnel — refactoring pur.

### Composants JSX (5)

| Composant | Source (lignes page.tsx) | Fichier cible |
|---|---|---|
| `ShareModal` | 1039-1350 (~312 lignes) | `components/map/share-modal.tsx` |
| `PreScanOverlay` | 676-766 (~91 lignes) | `components/map/pre-scan-overlay.tsx` |
| `RateLimitOverlay` | 768-814 (~47 lignes) | `components/map/rate-limit-overlay.tsx` |
| `RateLimitedModal` | 556-594 (~39 lignes) | `components/map/rate-limited-modal.tsx` |
| `RepoNotFoundModal` | 596-629 (~34 lignes) | `components/map/not-found-modal.tsx` |

### Hooks (2)

| Hook | Source (lignes page.tsx) | Fichier cible |
|---|---|---|
| `useRepoCacheLoader` | ~233-334 (~100 lignes) | `hooks/use-repo-cache-loader.ts` |
| `useCompareScan` | ~135-141 + 356-416 (~70 lignes) | `hooks/use-compare-scan.ts` |

---

## Interfaces

### ShareModal

```ts
type ShareModalProps = {
  open: boolean;
  onClose: () => void;
  owner: string;
  repo: string;
  repoInfo: RepoInfo;
  points: StargazerPoint[];
  displayStats: RepoStats | null;
  mapControlsRef: React.RefObject<MapControls | null>;
  filterCountry: string;
  filterCity: string;
  filterCompany: string;
  filterFollowers: number;
  filterDate: "all" | "30d" | "90d" | "1y";
  followerMapFilter: "all" | "high" | "mid" | "low";
  viewMode: "clusters" | "heatmap";
  mapProjection: MapProjection;
};
```

Canvas download logic (ligne 1097-1220) reste dans ShareModal — elle dépend de `mapControlsRef.current.captureCanvas()` et des props du repo uniquement.

`liPanelOpen`, `liDraft`, `liCopied`, `badgeCopied`, `filterLinkCopied` states migrent dans ShareModal (ils sont 100% locaux à ce modal).

`buildFilteredUrl` reste dans page.tsx (partagé avec TopPanel via le dock). ShareModal reçoit `buildFilteredUrl` en prop.

Attente : `sharedView` state reste dans page.tsx (utilisé aussi pour le shared-view banner ligne 853).

### PreScanOverlay

```ts
type PreScanOverlayProps = {
  status: ScanStatus;
  cacheCheckDone: boolean;
  repoInfo: RepoInfo;
  estimate: TimeEstimate;
  total: number;
  lastDbScan: string | null;
  hasToken: boolean;
  onScan: () => void;       // startScraping ou handleStartScan selon contexte
  onAddToken: () => void;   // handleStartScan (ouvre token modal si pas de token)
};
```

### RateLimitOverlay

```ts
type RateLimitOverlayProps = {
  status: ScanStatus;
  waitReason: string | null;
  retryIn: number;
  retryTotal: number;
};
```

Note : le `style={{ width: ... }}` inline sur la progress bar reste tel quel dans ce composant (valeur calculée à runtime, `unsafe-inline` requis — sujet du ticket #56).

### RateLimitedModal

```ts
type RateLimitedModalProps = {
  open: boolean;
  onAddToken: () => void;  // setRepoRateLimited(false) + setTokenOpen(true)
};
```

### RepoNotFoundModal

```ts
type RepoNotFoundModalProps = {
  open: boolean;
  owner: string;
  repo: string;
};
```

### useRepoCacheLoader

```ts
type RepoCacheLoaderOptions = {
  owner: string;
  repo: string;
  repoInfo: RepoInfo | null;            // pour badge-update (forksCount, watchersCount)
  dispatch: React.Dispatch<ScanAction>;
  setTotal: (n: number) => void;
  setCachedAt: (n: number | null) => void;
  setLatestStarredAt: (s: string | null) => void;
  setStatus: (s: ScanStatus) => void;
  setLastDbScan: (s: string | null) => void;
  setCacheCheckDone: (b: boolean) => void;
  setServerStats: (s: RepoStats | null) => void;
};

// Retourne void — effet pur, pas de valeur exposée.
const useRepoCacheLoader = (opts: RepoCacheLoaderOptions): void
```

**Règle dep critique** : `repoInfo` est exclu des deps du useEffect (le commentaire `eslint-disable-next-line` l'explique — badge-sync ne doit pas relancer sur chaque update repoInfo). L'accès se fait via un ref interne `repoInfoRef.current` mis à jour à chaque render.

### useCompareScan

```ts
type UseCompareScanReturn = {
  compareOwner: string | null;
  setCompareOwner: (s: string | null) => void;
  compareRepo: string | null;
  setCompareRepo: (s: string | null) => void;
  comparePoints: StargazerPoint[];
  compareStatus: "idle" | "loading" | "done";
  compareInfo: RepoInfo | null;
};

const useCompareScan = (ghHeaders: () => Record<string, string>): UseCompareScanReturn
```

Le hook gère en interne : les 5 états compare, `compareRunningRef`, `startCompareScan` callback, l'effect `[compareOwner, compareRepo, startCompareScan]`. L'URL-params effect dans page.tsx appelle `setCompareOwner`/`setCompareRepo` depuis le hook.

---

## Ordre d'implémentation

1. **useCompareScan** — logique isolée, pas de JSX, facile à vérifier
2. **useRepoCacheLoader** — plus complexe (ref trick pour repoInfo), critique à tester
3. **RateLimitedModal** + **RepoNotFoundModal** — petits, sans état local
4. **RateLimitOverlay** — état en props uniquement
5. **PreScanOverlay** — quelques props mais logique simple
6. **ShareModal** — le plus gros, en dernier (states locaux à migrer)

---

## Tests

- `useCompareScan` : test unitaire (mock fetch) — scan complet, AbortController sur démontage
- `useRepoCacheLoader` : test unitaire — localStorage hit, DB 200, DB 206, DB 404, donate path
- Composants JSX : smoke tests avec `@testing-library/react` — rendu + interaction principale

---

## Acceptance criteria (#50)

- [ ] `page.tsx` ≤ 700 lignes
- [ ] `rtk tsc` → 0 erreurs nouvelles (99 erreurs pré-existantes ignorées)
- [ ] `rtk vitest run` → 0 régressions + nouveaux tests verts
- [ ] Aucun `console.log` ajouté
- [ ] États locaux aux modaux (liCopied, badgeCopied, etc.) migrés dans leurs composants
