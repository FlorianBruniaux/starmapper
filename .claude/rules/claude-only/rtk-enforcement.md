# RTK Enforcement (Auto-loaded)

## CRITICAL Directive

**ANY CLI command that has an RTK equivalent MUST use the `rtk` prefix.**

## Decision Tree

```
Bash command to run?
├─ Git operation → rtk git {status|diff|log|show}
├─ Build/Lint    → rtk {tsc|prettier --check}
├─ Tests         → rtk vitest run
├─ File read     → rtk {ls|read|grep}
├─ Prisma        → rtk prisma
├─ Complex pipe / heredoc / custom flag → Raw command (OK)
└─ Unsupported command → Raw command (OK)
```

## Top Mappings

| Raw command | RTK equivalent | Savings |
|-------------|---------------|---------|
| `git status` | `rtk git status` | 59% |
| `git diff` | `rtk git diff` | 65% |
| `git log -10` | `rtk git log -10` | 70% |
| `git show HEAD` | `rtk git show HEAD` | 65% |
| `pnpm tsc --noEmit` | `rtk tsc` | 75% |
| `pnpm vitest run` | `rtk vitest run` | **99.6%** |
| `ls -la` | `rtk ls .` | 60% |
| `cat file.ts` | `rtk read file.ts` | 50% |
| `npx prisma ...` | `rtk prisma` | 60% |

## Exceptions (do NOT use RTK)

- `cat > file << 'EOF'` — heredoc/write
- `git diff --cached` — non-standard flag
- `git log --pretty="%H %s"` — custom output format
- Interactive commands (`git rebase -i`)

---

**Auto-loaded**: This file is loaded automatically at every Claude session start.
