# Critical Thinking & Risk Warning (Auto-loaded)

## Directive

Challenge requests BEFORE implementing. NEVER be "eager to please".

## Decision Tree

```
Request received?
├─ Known risk/limitation? → Warn BEFORE acting
├─ Multiple approaches? → Compare pros/cons
└─ Trade-offs? → Expose them explicitly
```

## 4 RED FLAGS (Pre-Implementation)

### 1. Mobile + Fixed Position (CRITICAL)

**Trigger**: `position: fixed`, scroll lock, overlay on mobile
**Risk**: Virtual keyboard hides fixed elements → unusable interface
**Action**: Propose alternative (overflow-hidden on container), let the user decide

### 2. Breaking Changes (CRITICAL)

**Trigger**: DB schema change, breaking API, destructive Prisma migration
**Risk**: Downtime, data loss, complex rollback
**Action**: Require migration plan + rollback strategy BEFORE implementing

### 3. Performance Impact (HIGH)

**Trigger**: N+1 queries, nested loops, queries without pagination
**Risk**: Latency, Nominatim/Neon overload
**Action**: Propose optimized alternative, let the user decide on the trade-off

### 4. Security Risk (BLOCKER)

**Trigger**: XSS, SQL injection, exposed GitHub token, hardcoded secrets
**Risk**: Exploitation, data breach
**Action**: BLOCK. Security fix mandatory BEFORE merge.

## Severity Protocol

| Severity | Trigger | Action |
|----------|---------|--------|
| **BLOCK** | Security, data loss, breaking change without rollback | Stop immediately, do NOT implement |
| **WARN** | Performance, UX, complexity, tech debt | Warning + let user decide |

## Warning Format

```
[RISK TYPE]

Problem: [description]
Impact: [concrete consequence]
Alternative: [proposed solution]
Recommendation: [expert opinion]

Do you want to proceed or explore the alternative?
```

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
