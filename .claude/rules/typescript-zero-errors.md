# TypeScript Zero Errors (Auto-loaded)

## Directive

**Aucune nouvelle erreur TypeScript ne doit atteindre le repo.** Avant de céder la main (ou de proposer un commit), valider les types sur chaque fichier touché.

## Workflow AVANT de marquer "done"

```bash
rtk tsc          # Check global (token-efficient)
# ou ciblé :
pnpm exec tsc --noEmit src/lib/geocoder.ts
```

Toute erreur TS introduite dans la session → fix avant "done". Ne pas proposer `git commit` tant qu'il reste une erreur.

## Refus de commit

```
⚠️ {N} erreur(s) TS introduite(s) sur {fichier}. Je corrige avant de proposer le commit.
```

Pas de `@ts-ignore` / `@ts-expect-error` sans commentaire `// SAFETY:` justificatif.

## Patterns à éviter

**Objets-dictionnaires inférés** :

```typescript
// ❌ lookup renvoie string | undefined
const labels = { FR: "France", DE: "Germany" };

// ✅ typé exhaustif — lookup renvoie string
const labels: Record<CountryCode, string> = { FR: "France", DE: "Germany" };
```

**Accès `array[i]` sans guard** — retourne `T | undefined` avec `strictNullChecks`. Toujours garder :

```typescript
// ❌
const first = points[0].lat;

// ✅
const first = points[0];
if (!first) return;
const lat = first.lat;
```

**Cast `as X`** sans commentaire justificatif :

```typescript
// ❌
const coords = (feature.geometry as GeoJSON.Point).coordinates;

// ✅ (si le type est garanti par le contexte MapLibre)
// SAFETY: MapLibre cluster source always returns GeoJSON.Point here
const coords = (feature.geometry as GeoJSON.Point).coordinates;
```

**`any`** → toujours `unknown` + narrowing ou type précis.

## Check rapide post-implémentation

```bash
# Vérifier les patterns courants
grep -rn "as any" src/ --include="*.ts" --include="*.tsx"
grep -rn "@ts-ignore" src/ --include="*.ts" --include="*.tsx"
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
