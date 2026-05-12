# Debugging Methodology (Auto-loaded)

## Golden Rule

> **Read the code of the buggy feature BEFORE looking anywhere else.**

NEVER:
- Modify code without understanding the root cause
- Apply a "just in case" fix without a test
- Mix multiple fixes in a single commit

## Decision Tree

```
Bug report received?
├─ Read the code of the mentioned feature FIRST
├─ Log/trace the full request/API
├─ Formulate a TESTABLE hypothesis
├─ Test the hypothesis locally
├─ If confirmed → targeted fix + test
└─ If rejected → new hypothesis (no "just in case" fix)
```

## Mandatory Workflow

### Step 1: Diagnose BEFORE writing any code

```
□ Read the code of the mentioned function/feature
□ Log/trace the request (GraphQL, Nominatim, Prisma SQL)
□ Identify the exact line causing the problem
□ Formulate a TESTABLE hypothesis
□ Test the hypothesis
□ If confirmed → targeted fix
□ If rejected → back to step 3
```

### Step 2: Root Cause Analysis (5 Whys)

```
1. Why [visible symptom]?
   → [direct consequence]
2. Why [consequence]?
   → [intermediate cause]
3-5. Continue until the root cause
→ FIX: Fix the root cause, not the symptom
```

### Step 3: Git workflow

```bash
# Investigation: temporary branch
git checkout -b debug/feature-investigation

# Root cause confirmed: clean branch
git checkout -b fix/actual-root-cause
# Remove debug console.log before committing

git commit -m "fix(scope): precise description of root cause"
```

## NULL Handling (PostgreSQL / Prisma)

Common pattern with LEFT JOIN + Neon:

```sql
-- ❌ Potential bug
WHERE vms.duration > 60  -- NULL if no data → row silently excluded

-- ✅ Fix
WHERE COALESCE(vms.duration, 0) > 60
```

## Red Flags (STOP signals)

| 🚩 Red Flag | Action |
|------------|--------|
| "Just in case" fix | ❌ STOP — Test first |
| Scope creep | ❌ One bug at a time |
| No local repro | ❌ Reproduce BEFORE fixing |
| "I don't know why but..." | ❌ Understand first |

## Quick Reference

| Situation | Action |
|-----------|--------|
| Bug report received | Read the code FIRST |
| Hypothesis formulated | Test locally BEFORE coding |
| Fix applied | Verify it works + add test |
| Before commit | Minimal fix, tested, understood |

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
