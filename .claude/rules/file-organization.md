# File Organization (Auto-loaded)

## Taille de fichier comme signal SOLID/DRY

La taille n'est pas un objectif — c'est un symptôme. Quand un fichier dépasse son seuil, une règle SOLID est probablement violée.

| Seuil | Signal | Action |
|---|---|---|
| >300 lignes | Candidat pour split | Vérifier si une responsabilité peut être extraite |
| >500 lignes | Gate commit | Doit splitter ou extraire avant de merger |
| >600 lignes | Revue architecturale | Problème structurel à traiter |

**Lire le signal :**

- **SRP violé** : plusieurs concepts dans un fichier (ex: `geocoder.ts` gère à la fois le cache, le rate limiting et 3 providers différents → candidat à l'extraction)
- **DRY violé** : logique dupliquée entre fichiers au lieu d'être extraite dans `src/lib/`
- **OCP violé** : un fichier modifié pour chaque nouveau variant (ex: switch géant sur le type de provider)

**Quand Claude ajoute du code dans un fichier >300L :**

- Vérifier si la nouvelle logique appartient là ou nécessite son propre fichier
- Une fonction >50 lignes dans une lib → candidat à l'extraction
- Le même bloc de code apparaît 3+ fois → refactoring DRY avant de continuer

**Exceptions** : fichiers générés (Prisma client), config (next.config.ts).

---

## Structure `src/lib/` (StarMapper)

```
src/lib/
├── geocoder.ts          # Geocoding cascade + circuit breakers + geocache
├── github.ts            # GitHub GraphQL + REST + rate limit handling
├── db.ts                # Prisma singleton (adapter Neon ou pg)
├── db-health.ts         # checkDbHealth() — DB capacity guard
├── user-cache.ts        # GitHubUser + StarEvent writes (avec health guard)
├── countries.ts         # normalizeCountry(), country codes
├── env.ts               # Env validation (t3-env)
└── organic-score.ts     # Score calculation + signal normalization
```

---

## Règles de split

**Quand splitter un fichier :**

- Business logic mélangée avec I/O (fetch + transform dans la même fonction)
- Fichier dépasse 500 lignes de code non-généré
- Plusieurs providers ou stratégies dans le même fichier (chaque provider → fichier dédié)

**Comment splitter sans casser les imports :**

```typescript
// geocoder.ts — barrel qui garde les anciens imports fonctionnels
export { geocode, geocodeBatch } from "./geocoder/core";
export { jawgGeocode } from "./geocoder/jawg";
export { geoapifyGeocode } from "./geocoder/geoapify";
export { nominatimGeocode } from "./geocoder/nominatim";
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
