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
  captureCanvas: () => Promise<string | null>;  // callback, pas RefObject (follow-up: #56)
  buildFilteredUrl: () => string;               // reste dans page.tsx, partagé avec TopPanel
  filterCountry: string;
  filterCity: string;
  filterCompany: string;
  filterFollowers: number;
  filterDate: "all" | "30d" | "90d" | "1y";
  followerMapFilter: "all" | "high" | "mid" | "low";
  viewMode: "clusters" | "heatmap";
  mapProjection: MapProjection;
  liDraft: string;                              // contrôlé — draft LinkedIn persist entre open/close
  onLiDraftChange: (s: string) => void;
};
```

**États locaux qui migrent dans ShareModal** : `liPanelOpen`, `liCopied`, `badgeCopied`, `filterLinkCopied`.
Reset acceptable à la fermeture (feedback transient).

**`liDraft` reste dans page.tsx** et passe en prop contrôlée — un draft en cours ne doit pas
disparaître si l'utilisateur ferme et rouvre le modal.

**Canvas download** : extraire en `const handleDownload = useCallback(async () => { ... }, [...])` nommé
à l'intérieur du composant, pas en inline arrow sur le bouton.

**Note follow-up** : `captureCanvas` passé en callback (pas en `RefObject`) est déjà la bonne API.
Si `mapControlsRef` est restructuré ailleurs, ShareModal n'a pas à changer.

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
  /**
   * Pre-resolved by page.tsx: either `startScraping` or `handleStartScan`
   * depending on repo size and token state. PreScanOverlay does not re-implement the logic.
   */
  onStart: () => void;
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

Note : le `style={{ width: ... }}` inline sur la progress bar reste tel quel (valeur calculée
à runtime — sujet du ticket #56, pas in scope ici).

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

Le hook **possède** `cacheCheckDone`, `lastDbScan`, et `serverStats` en interne et les **retourne**.
Il ne prend pas de setters pour ces valeurs. `dispatch`, `setTotal`, `setCachedAt`,
`setLatestStarredAt`, `setStatus` restent en entrée car partagés avec useScanController.

```ts
type RepoCacheLoaderOptions = {
  owner: string;
  repo: string;
  repoInfo: RepoInfo | null;
  dispatch: React.Dispatch<ScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setCachedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setLatestStarredAt: React.Dispatch<React.SetStateAction<string | null>>;
  setStatus: React.Dispatch<React.SetStateAction<ScanStatus>>;  // Dispatch<SetStateAction<T>>, pas (s: T) => void
};

type RepoCacheLoaderResult = {
  cacheCheckDone: boolean;
  lastDbScan: string | null;
  serverStats: RepoStats | null;
};

const useRepoCacheLoader = (opts: RepoCacheLoaderOptions): RepoCacheLoaderResult
```

**Type important** : `setStatus` doit être typé `React.Dispatch<React.SetStateAction<ScanStatus>>`
(pas `(s: ScanStatus) => void`) pour accepter les function updaters — strict mode le vérifiera.

**Badge-sync** : ne pas utiliser un `repoInfoRef` pour contourner exhaustive-deps.
Séparer en deux effets distincts :
1. Effet principal `[owner, repo]` — loadCache + DB revalidation + donate.
2. Effet badge-sync `[owner, repo]` avec `repoInfo` en dep — déclenché uniquement quand
   `repoInfo` est disponible. Le badge-sync ne relance pas le loadCache.

**Guard null** : `repoInfo?.forksCount` / `repoInfo?.watchersCount` — optional chaining obligatoire,
la DB peut répondre avant que repoInfo soit chargé.

### useCompareScan

Le hook gère en interne : les 5 états compare, `compareRunningRef`, `startCompareScan` callback,
et l'effect `[compareOwner, compareRepo, startCompareScan]`.

L'URL-params effect **reste dans page.tsx** — il lit aussi `country`, `city`, `followers`, etc.
qui sont état page.tsx. Le hook expose `setCompareOwner`/`setCompareRepo` pour que l'effet URL
puisse les appeler. C'est la seule seam entre les deux.

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

`ghHeaders` dans le dependency array de `startCompareScan` — déjà le cas dans le code source.

---

## Ordre d'implémentation

1. **useRepoCacheLoader** — le plus risqué (deps trick à corriger, cross-cutting state). Tests d'abord, extraction ensuite.
2. **useCompareScan** — logique isolée, pas de JSX. Tests d'abord.
3. **RateLimitedModal** + **RepoNotFoundModal** — petits, sans état local.
4. **RateLimitOverlay** — état en props uniquement.
5. **PreScanOverlay** — quelques props, logique simple.
6. **ShareModal** — le plus gros, en dernier (states locaux à migrer + `liDraft` contrôlé).

---

## Tests requis

### useRepoCacheLoader
- localStorage hit → dispatch set + setStatus("cached")
- DB 200, `scannedMs > local.scannedAt` → surcharge le cache local
- **DB 200, `scannedMs <= local.scannedAt`** → silently discards DB (branche non-évidente)
- DB 206 + pas de local → setLastDbScan
- DB 206 + local → donate path
- DB 404 + local → donate path
- DB down (reject) → setCacheCheckDone(true) quand même

### useCompareScan
- Scan complet : fetche chunks jusqu'à nextCursor null, setCompareStatus("done")
- AbortController cleanup sur démontage en cours de scan
- **Throttle 2s** : 3 chunks rapides → setComparePoints appelé ≤ 2 fois pendant le scan
- compareOwner/compareRepo null → aucun fetch

### Composants JSX
- Smoke tests `@testing-library/react` : rendu + interaction principale
- `aria-label="LinkedIn post draft"` sur le textarea de ShareModal (accessibility gap confirmé)

---

## Acceptance criteria (#50)

- [ ] `page.tsx` ≤ 700 lignes
- [ ] `rtk tsc` → 0 erreurs nouvelles (99 erreurs pré-existantes non-régressées)
- [ ] `rtk vitest run` → 0 régressions + nouveaux tests verts
- [ ] Aucun `console.log` ajouté
- [ ] `liDraft` passe en prop contrôlée à ShareModal (draft persist entre open/close)
- [ ] Badge-sync dans son propre effet, pas via repoInfoRef
- [ ] `captureCanvas` passé comme callback `() => Promise<string | null>`, pas comme RefObject
