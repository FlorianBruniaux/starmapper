# Debugging Methodology (Auto-loaded)

## Golden Rule

> **Lire le code de la feature bugguée AVANT de chercher ailleurs.**

Ne JAMAIS :
- Modifier du code sans comprendre le root cause
- Appliquer un fix "au cas où" sans test
- Mélanger plusieurs fixes dans un commit

## Decision Tree

```
Bug report reçu ?
├─ Lire le code de la feature mentionnée EN PREMIER
├─ Logger/tracer la requête/API complète
├─ Formuler hypothèse TESTABLE
├─ Tester l'hypothèse localement
├─ Si confirmée → fix ciblé + test
└─ Si rejetée → nouvelle hypothèse (pas de fix "au cas où")
```

## Workflow Obligatoire

### Étape 1 : Diagnostic AVANT tout code

```
□ Lire le code de la fonction/feature mentionnée
□ Logger/tracer la requête (GraphQL, Nominatim, Prisma SQL)
□ Identifier la ligne exacte qui cause le problème
□ Formuler une hypothèse TESTABLE
□ Tester l'hypothèse
□ Si confirmée → fix ciblé
□ Si rejetée → retour étape 3
```

### Étape 2 : Root Cause Analysis (5 Pourquoi)

```
1. Pourquoi [symptôme visible] ?
   → [conséquence directe]
2. Pourquoi [conséquence] ?
   → [cause intermédiaire]
3-5. Continuer jusqu'à la cause racine
→ FIX : Corriger la cause racine, pas le symptôme
```

### Étape 3 : Git workflow

```bash
# Investigation : branch temporaire
git checkout -b debug/feature-investigation

# Root cause confirmé : branch propre
git checkout -b fix/actual-root-cause
# Retirer les console.log de debug avant commit

git commit -m "fix(scope): description précise du root cause"
```

## NULL Handling (PostgreSQL / Prisma)

Pattern courant avec LEFT JOIN + Neon :

```sql
-- ❌ Bug potentiel
WHERE vms.duration > 60  -- NULL si pas de données → row exclue silencieusement

-- ✅ Fix
WHERE COALESCE(vms.duration, 0) > 60
```

## Red Flags (STOP signals)

| 🚩 Red Flag | Action |
|------------|--------|
| Fix "au cas où" | ❌ STOP — Tester d'abord |
| Scope creep | ❌ One bug at a time |
| Pas de repro local | ❌ Repro AVANT fix |
| "Je ne sais pas pourquoi mais..." | ❌ Comprendre d'abord |

## Quick Reference

| Situation | Action |
|-----------|--------|
| Bug report reçu | Lire le code EN PREMIER |
| Hypothèse formulée | Tester localement AVANT de coder |
| Fix appliqué | Vérifier que ça marche + ajouter test |
| Avant commit | Fix minimal, testé, compris |

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
