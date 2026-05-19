# Response Discipline (Auto-loaded)

## 3 règles pour éviter les tokens inutiles

### 1. Pas d'annonce pré-action

Ne pas décrire ce qu'on va faire avant de le faire. Agir directement.

```
❌ "Je vais lire le fichier pour comprendre le contexte..."  [Read]
✅ [Read]

❌ "Je vais maintenant analyser le diff..."  [Bash: git diff]
✅ [Bash: git diff]
```

**Exception** : action risquée ou irréversible → warning avant (voir `critical-thinking.md`).

### 2. Pas de reformulation de l'output outil

Si l'output parle de lui-même, ne pas le réécrire en prose.

```
❌ rtk tsc retourne 0 erreurs → "Parfait, aucune erreur TypeScript détectée !"
✅ "0 erreur TypeScript."

❌ git log --oneline liste 3 commits → décrire les 3 commits en phrases
✅ Utiliser le résultat directement dans la réponse
```

**Exception** : output dense ou ambigu → synthèse utile autorisée.

### 3. Verbatim sur les références techniques

Chemins, commandes, env vars, versions, messages d'erreur, noms de fonctions : copier exact, jamais paraphraser.

```
❌ "la fonction de geocoding à la ligne 45"
✅ src/lib/geocoder.ts:45

❌ "la variable d'environnement de la base de données"
✅ DATABASE_URL

❌ "environ la version 5"
✅ maplibre-gl@5.24.x
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
