# Knowledge Feeding (Auto-loaded)

## Directive

When Claude learns something new about the StarMapper codebase, it MUST update the AI instructions — without waiting for the user to ask.

**Principle**: Every session should leave the AI context richer than it found it.

---

## When to Update?

### Mandatory triggers (do without asking)

| Situation | Action |
|-----------|--------|
| A rate limit changes (Geoapify, Jawg, Nominatim, GitHub) | Update `CLAUDE.md` section "Rate Limits" |
| A code convention is clarified or an exception discovered | Update `.claude/rules/code-conventions.md` |
| A recurring pattern identified (geocoder, chunk loop, cache) | Add it to `.claude/rules/architecture.md` or the appropriate rule |
| A Prisma model is added or modified | Update `CLAUDE.md` section "Architecture" |
| MapLibre GL API change (major version) | Update `CLAUDE.md` "Known Gotchas" |
| A major dependency version changes | Update `CLAUDE.md` section "Tech Stack" |
| New API endpoint added | Update `CLAUDE.md` section "Additional Endpoints" |

### Triggers to propose (ask the user)

| Situation | Propose |
|-----------|---------|
| Important architecture decision (e.g. changing geocoding provider) | "Do you want me to add this decision to `CLAUDE.md`?" |
| New cache or compression pattern | "I can document this pattern in `architecture.md`" |
| New agent or skill added | "Do you want me to update the agents list in `CLAUDE.md`?" |

---

## Where Does What Go?

```
Knowledge acquired
├─ Architecture / StarMapper patterns
│  └─ .claude/rules/architecture.md (technical patterns)
│     CLAUDE.md section II (request flow, rate limits, schemas)
│
├─ Code convention (TypeScript, imports, naming, Tailwind)
│  └─ .claude/rules/code-conventions.md
│
├─ Design system (tokens, colors, components)
│  └─ .claude/rules/design-system.md
│
├─ React / MapLibre / frontend pattern
│  └─ .claude/rules/react-ref-patterns.md
│
├─ Defensive pattern (error handling, rate limits, DB guards)
│  └─ .claude/rules/defensive-code-audit.md
│
├─ Identified gotcha (unexpected library behavior)
│  └─ CLAUDE.md section IV "Known Gotchas"
│
└─ Env var or deployment config
   └─ CLAUDE.md section VI "Environment Variables"
```

---

## Writing Rules

1. **Compact**: 1 fact = 1 line or 1 bullet point. Do not bloat files.
2. **Verifiable**: Every added piece of information must be verifiable in the code (Prisma schema, config, etc.).
3. **User signal**: Mention what was updated at the end of the response.
4. **No duplication**: Check if the info already exists in the target file before adding.
5. **No speculation**: Only document what is confirmed, not what is assumed.

---

## User Signal Format

At the end of a response where an update was made:

```
📝 Doc updated: `CLAUDE.md` section "Known Gotchas"
   → MapLibre GL 5.x: getClusterExpansionZoom is now Promise-based
```

---

## Anti-patterns

❌ **Do NOT**:
- Add unverified information ("I think it's X")
- Document overly granular implementation details
- Mix into CLAUDE.md information that belongs in the rules
- Modify CLAUDE.md for temporary session-level changes

✅ **Do**:
- Distinguish "stable architecture" (→ CLAUDE.md) vs "code rule" (→ .claude/rules/)
- Propose explicitly when the update is subjective

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
