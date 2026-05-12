# Output Quality Standards (Auto-loaded)

## Directive

Three friction patterns to eliminate: shallow passes, planning loops without output, missing task completion confirmation.

---

## 1. Exhaustiveness on the First Pass

When an analysis, audit, or review is requested:
- Read **every** relevant file — not a sample
- Report exhaustively on the first pass
- If scope is ambiguous → ask before going shallow
- NEVER deliver a partial summary

---

## 2. Bias Toward Action (not planning loops)

**Rule: Produce deliverables early, iterate after.**

- Create files as soon as possible — do not plan for 3+ exchanges without any output
- If blocked after >2 attempts → explain the blocker clearly

```
❌ Entire session of exploration + planning without creating a single file
✅ Create the skeleton file first, fill it in after
```

---

## 3. Task Completion Confirmation

After each implementation, confirm explicitly:

```
✅ Files modified: [list]
✅ TypeScript: rtk tsc — 0 errors
✅ Commit: [hash] — type(scope): description  (if requested)
✅ Push: [yes/no — per explicit request]
```

Never push without an explicit request.

---

## 4. Testing Instructions After Implementation

After each implementation, provide test steps without waiting:

```
How to test:
  1. [concrete action — URL or command]
  2. [expected result]
  3. [edge case if relevant]
```

---

## 5. Proactive: "What's Next?"

After a task, proactively state:
- What is done
- What remains
- The suggested next action

If finished → say it explicitly: "Done, nothing else pending."

---

## 6. Offer Commit at End of Task

Do not commit automatically, but propose:

```
Do you want me to commit? (rtk git status shows N modified files)
```

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
