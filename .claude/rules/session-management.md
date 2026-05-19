# Session Management (Auto-loaded)

## Decision Tree : que faire entre 2 messages ?

```
Tâche en cours OK               → continuer
Approche cassée                 → /rewind (esc esc) jusqu'au point de divergence
Nouvelle tâche indépendante     → /clear avec brief de 5 lignes
Session > 300k tokens           → /compact AVEC description ("compact en gardant X")
Recherche/audit volumineuse     → spawn subagent (Explore ou Task tool)
```

## Règles d'or

- **Rewind > "essaie autre chose"** : on garde le contexte fichiers, on perd la mauvaise tentative
- **Une tâche = une session** : exception pour doc d'une feature qu'on vient d'écrire (cache chaud)
- **Compact AVANT auto-compact** : auto fire à 80%, fait au pire moment (model en zone de dégradation)
- **Subagent = context isolé** : audits, recherches "où est X", lectures massives → ne polluent pas la session principale

## Anti-patterns

| ❌ Faire ça | ✅ Faire plutôt |
|---|---|
| "Non, essaie autre chose" | `/rewind` puis re-prompter avec contexte |
| Continuer > 400k tokens pour économiser | `/clear` avec brief, repartir propre |
| Laisser auto-compact firer | `/compact focus: X` proactif |
| Lire 30 fichiers dans la session principale | Spawn un Explore agent qui rapporte synthèse |

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
