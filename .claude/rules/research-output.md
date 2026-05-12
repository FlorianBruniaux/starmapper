# Research Output Rule (Auto-loaded)

## Directive

**All exploratory research MUST be written to a file.**

Never summarize research verbally in a text response. Context compaction erases verbal summaries — not files.

---

## Mandatory Format

**File name**: `research-{feature}.md` at the project root

```markdown
# Research: {feature}

**Date**: {date}
**Feature**: {short description}

## Files Found

- `src/lib/geocoder.ts` — role in the feature
- `src/app/api/chunk/route.ts` — relevant logic

## Prisma Entities

- `GeoCache` — key fields, constraints

## Observed Patterns

- Pattern 1: description (file:line if relevant)

## Non-Obvious Dependencies

- X depends on Y because...
- Rate limit: Nominatim 1 req/s → impact on the feature

## Risks & Open Questions

- [ ] Open question to resolve before implementation
- ⚠️ Identified risk: ...

## Existing Tests

- Gap: no test on Y
```

---

## Triggers

Write `research-{feature}.md` when:
- Exploring a feature before planning
- Analyzing the impact of a change on the codebase
- Investigating a bug that spans multiple files

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
