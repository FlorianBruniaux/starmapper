// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * view-stats.ts
 *
 * Display page view statistics from the page_view table.
 *
 * Usage:
 *   pnpm stats:views [options]
 *
 * Options:
 *   --days <N>      Trend window in days (default: 7)
 *   --top  <N>      Top N entries per section (default: 20)
 *   --slug <value>  Filter to a specific slug, e.g. "torvalds/linux" or "Jakiboy"
 *   --type <value>  Filter to type: "repo" or "profile"
 *   --user <login>  Show profile views + all repos owned by this user
 */

import { readFileSync } from "fs";
import { parseArgs } from "node:util";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// ─── Load .env.local ──────────────────────────────────────────────────────────

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on environment */ }
};

loadEnvLocal();

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values: argv } = parseArgs({
  options: {
    days: { type: "string",  default: "7" },
    top:  { type: "string",  default: "20" },
    slug: { type: "string",  default: "" },
    type: { type: "string",  default: "" },
    user: { type: "string",  default: "" },
  },
  strict: true,
});

const DAYS      = Math.max(1, parseInt(argv.days, 10));
const TOP       = Math.max(1, parseInt(argv.top, 10));
const SLUG      = argv.slug.trim();
const TYPE      = argv.type.trim();
const USER      = argv.user.trim().toLowerCase();

// ─── DB ───────────────────────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL) { console.error("Error: DATABASE_URL not set"); process.exit(1); }

const pool   = new pg.Pool({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const bar = (n: number, max: number, width = 20): string => {
  const filled = max > 0 ? Math.round((n / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
};

const pad = (s: string, w: number) => s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);

const divider = "─".repeat(72);

type TopRow = { slug: string; type: string; total: bigint };
type DayRow = { date: Date; total: bigint };

const printTopRows = (rows: TopRow[]) => {
  const max = rows.length > 0 ? Number(rows[0].total) : 1;
  for (const row of rows) {
    const n = Number(row.total);
    const label = rows.some((r) => r.type !== rows[0].type)
      ? `[${row.type === "repo" ? "repo   " : "profile"}] ${row.slug}`
      : row.slug;
    console.log(`  ${pad(label, 48)} ${bar(n, max)} ${String(n).padStart(6)} views`);
  }
};

const printTrend = (rows: DayRow[], label: string) => {
  if (rows.length === 0) return;
  const max = Math.max(...rows.map((r) => Number(r.total)));
  console.log(`\n${divider}`);
  console.log(`  ${label}`);
  console.log(divider);
  for (const row of rows) {
    const n = Number(row.total);
    const d = row.date.toISOString().slice(0, 10);
    console.log(`  ${d}  ${bar(n, max, 30)} ${String(n).padStart(5)}`);
  }
};

// ─── Mode: specific user (profile + all their repos) ─────────────────────────

const runUserMode = async () => {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setUTCHours(0, 0, 0, 0);

  const repoPrefix = `${USER}/%`;

  const [profileRows, repoRows, trend, profileTotal, repoTotal] = await Promise.all([
    // Profile daily breakdown
    prisma.$queryRaw<DayRow[]>`
      SELECT date, SUM(count)::bigint AS total
      FROM page_view
      WHERE type = 'profile' AND LOWER(slug) = ${USER} AND date >= ${since}
      GROUP BY date ORDER BY date ASC
    `,
    // All repos owned by user (all-time)
    prisma.$queryRaw<TopRow[]>`
      SELECT slug, type, SUM(count)::bigint AS total
      FROM page_view
      WHERE type = 'repo' AND LOWER(slug) LIKE ${repoPrefix}
      GROUP BY slug, type ORDER BY total DESC LIMIT ${TOP}
    `,
    // Combined trend (profile + all repos)
    prisma.$queryRaw<DayRow[]>`
      SELECT date, SUM(count)::bigint AS total
      FROM page_view
      WHERE date >= ${since}
        AND (
          (type = 'profile' AND LOWER(slug) = ${USER})
          OR (type = 'repo'    AND LOWER(slug) LIKE ${repoPrefix})
        )
      GROUP BY date ORDER BY date ASC
    `,
    // All-time profile total
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count)::bigint AS total FROM page_view
      WHERE type = 'profile' AND LOWER(slug) = ${USER}
    `,
    // All-time repos total
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count)::bigint AS total FROM page_view
      WHERE type = 'repo' AND LOWER(slug) LIKE ${repoPrefix}
    `,
  ]);

  await prisma.$disconnect();
  await pool.end();

  const pTotal = Number(profileTotal[0]?.total ?? BigInt(0));
  const rTotal = Number(repoTotal[0]?.total ?? BigInt(0));

  console.log(`\n${divider}`);
  console.log(`  StarMapper — Stats for user: ${USER}`);
  console.log(divider);
  console.log(`\n  Profile views (all-time)  ${pTotal.toLocaleString()}`);
  console.log(`  Repo views   (all-time)   ${rTotal.toLocaleString()}`);
  console.log(`  Total                     ${(pTotal + rTotal).toLocaleString()}\n`);

  printTrend(trend, `Combined trend — last ${DAYS} days`);
  printTrend(profileRows, `Profile /profile/${USER} — last ${DAYS} days`);

  if (repoRows.length > 0) {
    console.log(`\n${divider}`);
    console.log(`  Repos owned by ${USER} (all-time)`);
    console.log(divider);
    printTopRows(repoRows);
  } else {
    console.log(`\n  No repo views tracked for ${USER} yet.`);
  }

  console.log(`\n${divider}\n`);
};

// ─── Mode: specific slug ──────────────────────────────────────────────────────

const runSlugMode = async () => {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setUTCHours(0, 0, 0, 0);

  const typeFilter = TYPE || (SLUG.includes("/") ? "repo" : "profile");

  const [trend, allTime] = await Promise.all([
    prisma.$queryRaw<DayRow[]>`
      SELECT date, SUM(count)::bigint AS total
      FROM page_view
      WHERE type = ${typeFilter} AND LOWER(slug) = ${SLUG.toLowerCase()} AND date >= ${since}
      GROUP BY date ORDER BY date ASC
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count)::bigint AS total
      FROM page_view
      WHERE type = ${typeFilter} AND LOWER(slug) = ${SLUG.toLowerCase()}
    `,
  ]);

  await prisma.$disconnect();
  await pool.end();

  const total = Number(allTime[0]?.total ?? BigInt(0));
  const label = typeFilter === "repo" ? `/${SLUG}` : `/profile/${SLUG}`;

  console.log(`\n${divider}`);
  console.log(`  StarMapper — Stats for ${label}`);
  console.log(divider);
  console.log(`\n  All-time total  ${total.toLocaleString()} views\n`);

  printTrend(trend, `Daily trend — last ${DAYS} days`);
  console.log(`\n${divider}\n`);
};

// ─── Mode: global overview ────────────────────────────────────────────────────

const runGlobalMode = async () => {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setUTCHours(0, 0, 0, 0);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const trendRows = TYPE
    ? await prisma.$queryRaw<DayRow[]>`
        SELECT date, SUM(count)::bigint AS total
        FROM page_view WHERE date >= ${since} AND type = ${TYPE}
        GROUP BY date ORDER BY date ASC
      `
    : await prisma.$queryRaw<DayRow[]>`
        SELECT date, SUM(count)::bigint AS total
        FROM page_view WHERE date >= ${since}
        GROUP BY date ORDER BY date ASC
      `;

  const [repoRows, profileRows, todayRows, grandTotal] = await Promise.all([
    TYPE === "profile" ? Promise.resolve([]) : prisma.$queryRaw<TopRow[]>`
      SELECT slug, type, SUM(count)::bigint AS total
      FROM page_view WHERE type = 'repo'
      GROUP BY slug, type ORDER BY total DESC LIMIT ${TOP}
    `,
    TYPE === "repo" ? Promise.resolve([]) : prisma.$queryRaw<TopRow[]>`
      SELECT slug, type, SUM(count)::bigint AS total
      FROM page_view WHERE type = 'profile'
      GROUP BY slug, type ORDER BY total DESC LIMIT ${TOP}
    `,
    prisma.$queryRaw<Array<{ type: string; total: bigint }>>`
      SELECT type, SUM(count)::bigint AS total
      FROM page_view WHERE date = ${today}
      GROUP BY type
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count)::bigint AS total FROM page_view
    `,
  ]);

  await prisma.$disconnect();
  await pool.end();

  const todayRepo    = Number(todayRows.find((r) => r.type === "repo")?.total    ?? BigInt(0));
  const todayProfile = Number(todayRows.find((r) => r.type === "profile")?.total ?? BigInt(0));
  const total        = Number(grandTotal[0]?.total ?? BigInt(0));

  console.log(`\n${divider}`);
  console.log("  StarMapper — Page View Stats");
  console.log(divider);
  console.log(`\n  Today     repos: ${todayRepo}   profiles: ${todayProfile}`);
  console.log(`  All-time  total: ${total.toLocaleString()} views\n`);

  printTrend(trendRows, `Daily trend — last ${DAYS} days`);

  if (repoRows.length > 0) {
    console.log(`\n${divider}`);
    console.log(`  Top ${TOP} repos (all-time)`);
    console.log(divider);
    printTopRows(repoRows);
  }

  if (profileRows.length > 0) {
    console.log(`\n${divider}`);
    console.log(`  Top ${TOP} profiles (all-time)`);
    console.log(divider);
    printTopRows(profileRows);
  }

  console.log(`\n${divider}\n`);
};

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const main = async () => {
  if (USER)      return runUserMode();
  if (SLUG)      return runSlugMode();
  return runGlobalMode();
};

main().catch((err) => { console.error(err); process.exit(1); });
