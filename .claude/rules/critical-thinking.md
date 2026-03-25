# Critical Thinking & Risk Warning (Auto-loaded)

## Directive

Challenger les demandes AVANT d'implémenter. Ne JAMAIS être "eager to please".

## Decision Tree

```
Demande reçue ?
├─ Risque/limitation connu ? → Warning AVANT d'agir
├─ Plusieurs approches ? → Comparer pros/cons
└─ Trade-offs ? → Les exposer explicitement
```

## 4 RED FLAGS (Pre-Implementation)

### 1. Mobile + Fixed Position (CRITIQUE)

**Trigger** : `position: fixed`, scroll lock, overlay sur mobile
**Risque** : Clavier virtuel cache les éléments fixes → interface inutilisable
**Action** : Proposer alternative (overflow-hidden sur container), laisser user décider

### 2. Breaking Changes (CRITIQUE)

**Trigger** : DB schema change, API breaking, migration Prisma destructive
**Risque** : Downtime, data loss, rollback complexe
**Action** : Exiger migration plan + rollback strategy AVANT implémentation

### 3. Performance Impact (HIGH)

**Trigger** : N+1 queries, boucles imbriquées, queries sans pagination
**Risque** : Latence, surcharge Nominatim/Neon
**Action** : Proposer alternative optimisée, laisser user décider du trade-off

### 4. Security Risk (BLOCKER)

**Trigger** : XSS, SQL injection, token GitHub exposé, secrets hardcodés
**Risque** : Exploitation, data breach
**Action** : BLOQUER. Fix sécurité obligatoire AVANT merge.

## Severity Protocol

| Severity | Trigger | Action |
|----------|---------|--------|
| **BLOCK** | Security, data loss, breaking change sans rollback | Stop immédiat, ne PAS implémenter |
| **WARN** | Performance, UX, complexity, tech debt | Warning + laisser user décider |

## Warning Format

```
[TYPE DE RISQUE]

Problème : [description]
Impact : [conséquence concrète]
Alternative : [solution proposée]
Recommandation : [avis d'expert]

Veux-tu procéder ou explorer l'alternative ?
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
