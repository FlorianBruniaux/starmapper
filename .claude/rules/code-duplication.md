# Code Duplication Detection (Auto-loaded)

## DRY Principle

**Golden Rule** : Si une fonction existe à 2+ endroits avec la même logique → refactoriser immédiatement.

---

## Detection Triggers

### CRITICAL : Identical Function Signatures

```typescript
// 🚨 RED FLAG : même fonction dans plusieurs fichiers
// src/lib/geocoder.ts
export const normalizeLocation = (loc: string) => loc.toLowerCase().trim();

// src/app/api/chunk/route.ts
export const normalizeLocation = (loc: string) => loc.toLowerCase().trim(); // ❌ doublon
```

**Action** : Centraliser dans `src/lib/` et importer partout.

---

### HIGH : Similar Logic with Minor Variations

Même algorithme avec de petites différences → extraire avec paramètres.

---

## Workflow de Refactoring

1. **Identifier** : `git grep "export const myFunction"` avant d'écrire du code
2. **Décider l'emplacement** :
   - Utilité pure → `src/lib/`
   - Logique métier → `src/lib/[domain]/`
3. **Créer Single Source of Truth** avec JSDoc
4. **Refactorer** : importer depuis le fichier centralisé
5. **Vérifier** : `rtk tsc` puis tests

---

## Emplacement par Type (StarMapper)

| Type | Emplacement | Exemple |
|------|-------------|---------|
| Geocoding helpers | `src/lib/geocoder.ts` | normalisation locations |
| GitHub API helpers | `src/lib/github.ts` | formatage réponses GraphQL |
| Types partagés | exporter depuis `route.ts` | `StargazerPoint`, `UnmappedUser` |
| Constantes | `src/lib/constants.ts` | limites rate limit |

---

## Anti-Patterns

| ❌ | ✅ |
|----|-----|
| "Il n'y a que 2 occurrences, c'est OK" | Fixer immédiatement — 2 devient 3 |
| Copier-coller + modifier 1 ligne | Extraire + paramétrer la différence |
| Variations sans justification | Standardiser sur une seule variante |

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
