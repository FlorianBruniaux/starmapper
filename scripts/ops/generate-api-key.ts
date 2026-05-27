// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * generate-api-key.ts
 *
 * Generate a new API key for the StarMapper GeoJSON API, write it to DB,
 * and print a ready-to-send email template.
 *
 * Usage:
 *   pnpm tsx scripts/ops/generate-api-key.ts --email="user@example.com" --name="John Doe"
 *   pnpm tsx scripts/ops/generate-api-key.ts --email="user@example.com" --name="Jane" --note="Research paper"
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Load .env.local (same pattern as other scripts)
const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const eq = t.indexOf("=");
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    note: { type: "string" },
  },
});

if (!values.email || !values.name) {
  console.error("Usage: pnpm tsx scripts/generate-api-key.ts --email=<email> --name=<name> [--note=<note>]");
  process.exit(1);
}

const createClient = () => {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};

const main = async () => {
  const prisma = createClient();

  const record = await prisma.apiKey.create({
    data: {
      email: values.email!,
      name: values.name!,
      note: values.note ?? null,
    },
  });

  await prisma.$disconnect();

  console.log(`\n✅ API key created`);
  console.log(`   key:   ${record.key}`);
  console.log(`   email: ${record.email}`);
  console.log(`   name:  ${record.name}`);
  if (record.note) console.log(`   note:  ${record.note}`);
  console.log(`   DB:    api_key table (check via Prisma Studio)\n`);

  const emailTemplate = `
────────────────────────────────────────────────────────────────
COPY-PASTE EMAIL TEMPLATE
────────────────────────────────────────────────────────────────
Subject: Your StarMapper API key

Hi ${values.name},

Here's your API key for the StarMapper GeoJSON API:

  ${record.key}

Usage:

  curl -H "Authorization: Bearer ${record.key}" \\
    https://starmapper.bruniaux.com/api/geo/facebook/react

Response format:

  {
    "metadata": { "owner", "repo", "totalCount", "geocodedCount", "scannedAt", "apiVersion" },
    "countries": [{ "name": "United States", "count": 42000 }, ...],
    "cities": [{ "name": "San Francisco", "count": 3200 }, ...]
  }

Notes:
- Rate limit: 60 requests/minute per IP
- Only repos already scanned on starmapper.bruniaux.com are available
- If a repo isn't cached yet, scan it first at: https://starmapper.bruniaux.com/{owner}/{repo}
- Keep this key private — contact me if you need to rotate it

Best,
Florian
────────────────────────────────────────────────────────────────
`;

  console.log(emailTemplate);
};

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
