# Git Merge Discipline (Auto-loaded)

## Problème prévenu

Faire `git stash` pendant un merge en cours (`.git/MERGE_HEAD` présent) corrompt silencieusement l'état. Le `git commit` qui suit crée un commit à **1 parent** au lieu d'un vrai merge commit à 2 parents. Résultat : GitHub recompte les conflits à chaque avancée sur la branche cible et bloque la PR (statut `mergeable: CONFLICTING`).

---

## Règle absolue — JAMAIS `git stash` pendant un merge

Avant tout `git stash` ou `git checkout` d'un fichier, vérifier l'état merge :

```bash
test -f .git/MERGE_HEAD && echo "⚠️ MERGE IN PROGRESS — stash interdit"
```

Si merge en cours et besoin d'annuler :

```bash
git merge --abort    # Abandonne le merge proprement
git stash             # Maintenant safe
# ... plus tard ...
git stash pop
git merge origin/main  # Relancer le merge
```

---

## Règle absolue — JAMAIS `git checkout HEAD -- .` sans inventaire

`git checkout HEAD -- .` (ou `git restore .`) **efface définitivement** toutes les modifs non commitées. Pas de reflog, pas de récupération.

**Avant tout reset aveugle** :

```bash
# 1. Lister TOUS les fichiers modifiés
git status --short

# 2. Sauvegarder d'abord
git stash push -m "safeguard-before-reset-$(date +%s)" --include-untracked

# 3. Réaliser le reset
git checkout HEAD -- .

# 4. Récupérer après
git stash pop
```

Préférer un reset sélectif : `git checkout HEAD -- <fichier>` en ne listant QUE les fichiers auto-générés ou connus safe.

---

## Vérification OBLIGATOIRE post-merge-commit

Après chaque `git commit` qui conclut un merge :

```bash
git show HEAD --format="%P" --no-patch
# ✅ Doit afficher 2+ SHAs (un par parent)
# ❌ 1 seul SHA = merge cassé, recommencer
```

Si 1 seul parent :
1. `git reset --hard HEAD~1` (commit NON pushé) ou `git revert` (si pushé)
2. Refaire le merge : `git merge origin/main`
3. Re-vérifier les parents

---

## Vérification OBLIGATOIRE post-push sur merge commit

```bash
gh pr view <N> --json mergeable,mergeStateStatus
# ✅ mergeable:MERGEABLE + mergeStateStatus:CLEAN
# ⚠️ mergeable:CONFLICTING → merge mal fait, fix immédiat
```

---

## Checklist pré-commit merge

- [ ] Tous les conflits résolus (`git status` = 0 `UU`/`AA`)
- [ ] Scan markers résiduels : `grep -rn '^<<<<<<<\|^>>>>>>>' . --include="*.ts" --include="*.tsx" --include="*.md"`
- [ ] `rtk tsc` → 0 erreurs
- [ ] Post-commit : `git show HEAD --format="%P"` affiche 2+ SHAs
- [ ] Post-push : `gh pr view --json mergeable` = MERGEABLE

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
