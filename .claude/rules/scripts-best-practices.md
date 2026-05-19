# Scripts Best Practices (Auto-loaded)

## Scope

Ces règles s'appliquent à tous les fichiers sous `scripts/`.

---

## Golden Rules

1. **Dry-run par défaut** — toute écriture destructive doit accepter `--dry-run`
2. **Idempotence** — un script relancé deux fois doit produire le même résultat
3. **Audit trail** — logger chaque opération DB modifiée (id, action, résultat)
4. **`node:` prefix obligatoire** — `node:util`, `node:fs/promises` (pas `util`, `fs`)
5. **Batch + delay** — ne jamais traiter des milliers de lignes en une seule requête non limitée

---

## Flags CLI obligatoires

| Flag | Requis quand | Exemple |
|---|---|---|
| `--dry-run` | Toute écriture ou suppression en DB | `--dry-run` (default: false) |
| `--batch-size=N` | Traitements par lots | `--batch-size=100` |
| `--delay-ms=N` | Boucles avec pause entre batches | `--delay-ms=100` |
| `--limit=N` | Test sur sous-ensemble | `--limit=50` |

**Nommage** : kebab-case (`--dry-run`, `--batch-size` — jamais `dryRun` ni `DRY_RUN`).

---

## Skeleton (à copier pour tout nouveau script)

```typescript
/**
 * mon-script.ts
 *
 * Description courte.
 *
 * Usage:
 *   pnpm tsx scripts/mon-script.ts [--dry-run] [--batch-size=N]
 */

import { parseArgs } from "node:util";
import { prisma } from "@/lib/db";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "batch-size": { type: "string", default: "100" },
    "delay-ms": { type: "string", default: "100" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const dryRun = values["dry-run"];
const batchSize = parseInt(values["batch-size"] ?? "100", 10);
const delayMs = parseInt(values["delay-ms"] ?? "100", 10);

const main = async () => {
  console.log(`Starting (dry-run: ${dryRun}, batchSize: ${batchSize})`);

  const items = await prisma.someModel.findMany({ where: { /* ... */ } });
  console.log(`Found ${items.length} items`);

  let processed = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    if (!dryRun) {
      await prisma.$transaction(
        batch.map((item) =>
          prisma.someModel.update({ where: { id: item.id }, data: { /* ... */ } })
        )
      );
    } else {
      console.log(`[dry-run] Would update ${batch.length} items`);
    }

    processed += batch.length;
    console.log(`Progress: ${processed}/${items.length}`);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log(`Done. Processed: ${processed}`);
};

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## Anti-patterns

```typescript
// ❌ Pas de --dry-run sur une écriture destructive
for (const user of users) {
  await prisma.user.update({ where: { id: user.id }, data: { /* ... */ } });
}

// ❌ readFileSync en contexte async
import { readFileSync } from "fs";
const data = readFileSync("./input.json", "utf-8");

// ✅
import { readFile } from "node:fs/promises";
const data = await readFile("./input.json", "utf-8");

// ❌ PrismaClient instancié localement sans disconnect
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// ... oublie prisma.$disconnect()
```

---

## Checklist avant de lancer en prod

- [ ] `--dry-run` testé localement sans erreur
- [ ] Idempotence vérifiée (relancé 2x = même résultat)
- [ ] Entry `package.json` ajoutée si usage récurrent
- [ ] `pnpm backfill:api-key-hash` relancé si `prisma db push` inclus dans le script

---

**Auto-loaded** : Ce fichier est chargé automatiquement à chaque session.
