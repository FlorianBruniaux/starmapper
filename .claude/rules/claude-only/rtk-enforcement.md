# RTK Enforcement (Auto-loaded)

## Directive CRITICAL

**TOUTE commande CLI ayant un équivalent RTK DOIT utiliser `rtk` en prefix.**

## Decision Tree

```
Commande Bash à exécuter ?
├─ Git operation → rtk git {status|diff|log|show}
├─ Build/Lint    → rtk {tsc|prettier --check}
├─ Tests         → rtk vitest run
├─ File read     → rtk {ls|read|grep}
├─ Prisma        → rtk prisma
├─ Pipe complexe / heredoc / flag custom → Commande brute (OK)
└─ Commande non supportée → Commande brute (OK)
```

## Top Mappings

| Commande brute | RTK équivalent | Savings |
|----------------|---------------|---------|
| `git status` | `rtk git status` | 59% |
| `git diff` | `rtk git diff` | 65% |
| `git log -10` | `rtk git log -10` | 70% |
| `git show HEAD` | `rtk git show HEAD` | 65% |
| `pnpm tsc --noEmit` | `rtk tsc` | 75% |
| `pnpm vitest run` | `rtk vitest run` | **99.6%** |
| `ls -la` | `rtk ls .` | 60% |
| `cat file.ts` | `rtk read file.ts` | 50% |
| `npx prisma ...` | `rtk prisma` | 60% |

## Exceptions (ne PAS utiliser RTK)

- `cat > file << 'EOF'` — heredoc/écriture
- `git diff --cached` — flag non standard
- `git log --pretty="%H %s"` — output personnalisé
- Commandes interactives (`git rebase -i`)

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
