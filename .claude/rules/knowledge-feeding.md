# Knowledge Feeding (Auto-loaded)

## Directive

Quand Claude apprend quelque chose de nouveau sur le codebase StarMapper, il DOIT mettre à jour les instructions IA — sans attendre que l'utilisateur le demande.

**Principe** : Chaque session doit laisser le contexte IA plus riche qu'elle ne l'a trouvé.

---

## Quand mettre à jour ?

### Triggers obligatoires (faire sans demander)

| Situation | Action |
|-----------|--------|
| Un rate limit change (Geoapify, Jawg, Nominatim, GitHub) | Mettre à jour `CLAUDE.md` section "Rate Limits" |
| Une convention de code est clarifiée ou une exception découverte | Mettre à jour `.claude/rules/code-conventions.md` |
| Un pattern récurrent identifié (géocoder, chunk loop, cache) | L'ajouter dans `.claude/rules/architecture.md` ou rule appropriée |
| Un modèle Prisma ajouté ou modifié | Mettre à jour `CLAUDE.md` section "Architecture" |
| MapLibre GL API change (version majeure) | Mettre à jour `CLAUDE.md` "Known Gotchas" |
| Une version de dépendance majeure change | Mettre à jour `CLAUDE.md` section "Tech Stack" |
| Nouveau endpoint API ajouté | Mettre à jour `CLAUDE.md` section "Additional Endpoints" |

### Triggers à proposer (demander à l'utilisateur)

| Situation | Proposer |
|-----------|---------|
| Architecture décision importante (ex: changer provider géocoding) | "Veux-tu que j'ajoute cette décision dans `CLAUDE.md` ?" |
| Nouveau pattern de cache ou compression | "Je peux documenter ce pattern dans `architecture.md`" |
| Nouvel agent ou skill ajouté | "Veux-tu que je mette à jour la liste des agents dans `CLAUDE.md` ?" |

---

## Où mettre quoi ?

```
Connaissance acquise
├─ Architecture / patterns StarMapper
│  └─ .claude/rules/architecture.md (patterns techniques)
│     CLAUDE.md section II (request flow, rate limits, schemas)
│
├─ Convention de code (TypeScript, imports, naming, Tailwind)
│  └─ .claude/rules/code-conventions.md
│
├─ Design system (tokens, couleurs, composants)
│  └─ .claude/rules/design-system.md
│
├─ Pattern React / MapLibre / frontend
│  └─ .claude/rules/react-ref-patterns.md
│
├─ Pattern défensif (error handling, rate limits, DB guards)
│  └─ .claude/rules/defensive-code-audit.md
│
├─ Gotcha identifié (comportement inattendu d'une lib)
│  └─ CLAUDE.md section IV "Known Gotchas"
│
└─ Env var ou config deployment
   └─ CLAUDE.md section VI "Environment Variables"
```

---

## Règles d'écriture

1. **Compact** : 1 fait = 1 ligne ou 1 bullet point. Ne pas gonfler les fichiers.
2. **Vérifiable** : Toute info ajoutée doit être vérifiable dans le code (schema Prisma, config, etc.).
3. **Signal utilisateur** : Mentionner ce qui a été mis à jour à la fin de la réponse.
4. **Pas de duplication** : Vérifier si l'info existe déjà dans le fichier cible avant d'ajouter.
5. **Pas de spéculation** : Ne documenter que ce qui est confirmé, pas ce qui est supposé.

---

## Format du signal utilisateur

À la fin d'une réponse où une mise à jour a été faite :

```
📝 Doc mise à jour : `CLAUDE.md` section "Known Gotchas"
   → MapLibre GL 5.x: getClusterExpansionZoom est maintenant Promise-based
```

---

## Anti-patterns

❌ **Ne PAS faire** :
- Ajouter des infos non vérifiées ("je pense que c'est X")
- Documenter des détails d'implémentation trop granulaires
- Mélanger dans CLAUDE.md des infos qui appartiennent aux rules
- Modifier CLAUDE.md pour des changements de session temporaires

✅ **Faire** :
- Distinguer "architecture stable" (→ CLAUDE.md) vs "règle de code" (→ .claude/rules/)
- Proposer explicitement quand la mise à jour est subjective

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
