# Universal Engineering Rules (Auto-loaded)

> Règles applicables à toute tâche de code — indépendamment du framework. En cas de conflit avec une règle StarMapper-specific (architecture.md, code-conventions.md), la règle **StarMapper-specific prime**.

---

## Méthodologie

**Never Skip Planning** — Ne pas démarrer une tâche non-triviale (3+ étapes) sans planifier d'abord. Stopper et re-planifier immédiatement si quelque chose décroche.

**Never Underuse Subagents** — Ne pas polluer la fenêtre de contexte avec de la recherche ou de l'exploration parallèle. Déléguer aux subagents (Explore, Plan...). Une tâche par subagent, concerns séparés.

**Never Mark a Task Complete Without Proof** — Ne pas dire qu'une tâche est terminée sans avoir lancé `rtk tsc` et vérifié le comportement. Ne pas s'approuver soi-même sans se demander : « un senior engineer approuverait-il ça ? »

**Never Ask for Hand-Holding on Bugs** — Ne pas demander à l'utilisateur comment corriger un bug. Trouver et fixer. Ne pas attendre qu'on indique quels logs regarder.

---

## Règle 1 — Ne jamais bloquer les flux critiques pour des features secondaires

Si une opération secondaire/optionnelle échoue, le flux principal ne doit pas être bloqué. Ne pas re-throw depuis un bloc non-critique — `try/catch` avec fallback null/void.

**StarMapper** : un geocoding raté ne doit pas interrompre le chunk loop. Un write BadgeCache raté ne doit pas planter le scan.

## Règle 2 — Ne jamais permettre d'incohérence cross-layer

Un rename de type dans `route.ts` doit être propagé à tous les clients. Ne pas fermer un changement sans un `grep` final sur tous les fichiers qui importent le type.

**StarMapper** : `StargazerPoint` et `UnmappedUser` sont exportés depuis `/api/chunk/route.ts` et consommés côté client. Un rename = grep obligatoire.

## Règle 3 — Ne jamais inventer un pattern quand il en existe déjà un

Lire les fichiers existants dans la zone affectée AVANT d'écrire du code. Reproduire les conventions du codebase à la lettre — structure de fichiers, naming, barrel exports, error handling.

## Règle 4 — Ne jamais sur-ingéniérer

Pas de code mort, commentaires inutiles, abstractions superflues, ou features spéculatives. Chaque ligne doit servir un objectif immédiat et clair.

## Règle 5 — Ne jamais faire des changements non-chirurgicaux

Ne pas modifier quoi que ce soit qui n'est pas requis par la tâche en cours. Ne pas toucher des fichiers non liés. Ne pas renommer un symbole sans avoir grep tous ses appelants.

## Règle 6 — Ne jamais re-requêter la DB pour des données déjà en mémoire

Vérifier ce que l'appelant a déjà en scope avant d'écrire une requête Prisma. Utiliser `include`/`select` dans la requête initiale plutôt que des requêtes séparées en N+1.

## Règle 7 — Ne jamais produire d'effets de bord externes dans une transaction DB

Une transaction Prisma peut être rollbackée. Les effets externes (appels HTTP, emails, writes Upstash) ne se rollbackent PAS avec elle. Toujours différer ces appels après la transaction.

## Règle 8 — Ne jamais supprimer ou renommer sans vérifier le scope complet

`grep` sur tout le codebase avant de supprimer un symbole. Lancer le build de production (`pnpm build`) — le build prod est strict, le dev indulgent.

## Règle 9 — Ne jamais calibrer la gestion d'erreur sans questionner la criticité

Se demander : « si ça échoue, est-il acceptable de continuer silencieusement ? »

- Non → laisser throw (ou retourner NextResponse 500)
- Oui → `catch`, log minimal, continuer avec fallback

Chaque `catch` qui swallow une erreur mérite un commentaire court expliquant pourquoi c'est acceptable.

## Règle 10 — Ne jamais résoudre un conflit de merge sans scanner tout le repo

```bash
grep -rn '^<<<<<<<\|^>>>>>>>' . --include="*.ts" --include="*.tsx" --include="*.md"
```

Lancer `rtk tsc` et `pnpm test` après résolution.

---

## Seuils de qualité

| Métrique | Seuil |
|---|---|
| Longueur max fonction | 50 lignes |
| Longueur max fichier | 500 lignes (gate) |
| Paramètres max par fonction | 4 (options object au-delà) |
| Profondeur d'imbrication max | 3 niveaux (early return sinon) |
| Violations `rtk tsc` introduites | 0 |
| Violations lint introduites | 0 |

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
