# Research Output Rule (Auto-loaded)

## Directive

**Toute recherche exploratoire DOIT être écrite dans un fichier.**

Ne jamais résumer la recherche verbalement en réponse texte. La compaction de contexte efface les résumés verbaux — pas les fichiers.

---

## Format Obligatoire

**Nom du fichier** : `research-{feature}.md` à la racine du projet

```markdown
# Research: {feature}

**Date** : {date}
**Feature** : {description courte}

## Files Found

- `src/lib/geocoder.ts` — rôle dans la feature
- `src/app/api/chunk/route.ts` — logique concernée

## Prisma Entities

- `GeoCache` — champs clés, contraintes

## Patterns Observés

- Pattern 1 : description (fichier:ligne si pertinent)

## Dépendances Non-Évidentes

- X dépend de Y parce que...
- Rate limit: Nominatim 1 req/s → impact sur la feature

## Risks & Open Questions

- [ ] Question ouverte à trancher avant implémentation
- ⚠️ Risque identifié : ...

## Existing Tests

- Gap: pas de test sur Y
```

---

## Triggers

Écrire `research-{feature}.md` quand :
- Exploration d'une feature avant de planifier
- Analyse de l'impact d'un changement sur le codebase
- Investigation d'un bug nécessitant plusieurs fichiers

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
