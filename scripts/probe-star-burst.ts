// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Phase 0 — Read-only calibration for Organic Score v2 (star burst signal)
// Computes burst ratios (1d / 3d / 7d rolling windows) for a corpus of repos,
// simulates v1 and v2 scores, helps decide which weight set to ship.
//
// NO DB WRITES — pure analysis tool.
//
// Usage:
//   tsx scripts/probe-star-burst.ts           — run with Neon (DATABASE_URL)
//   tsx scripts/probe-star-burst.ts --local   — run with local Postgres (DATABASE_URL_LOCAL)
//   tsx scripts/probe-star-burst.ts --no-db   — GitHub API only, no burst/ZF signals

import { readFileSync } from "fs";
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

const args = process.argv.slice(2);
const USE_LOCAL = args.includes("--local");
const SKIP_DB   = args.includes("--no-db");

if (USE_LOCAL) {
  const local = process.env.DATABASE_URL_LOCAL;
  if (local) process.env.DATABASE_URL = local;
  else { console.error("DATABASE_URL_LOCAL not set in .env.local"); process.exit(1); }
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

type ExpectedTier = "healthy" | "suspicious" | "control";

type CorpusEntry = {
  owner: string;
  repo: string;
  tier: ExpectedTier;
  note: string;
};

const CORPUS: CorpusEntry[] = [
  // Primary test case — the repo that motivated this investigation
  { owner: "rtk-ai",              repo: "rtk",                    tier: "healthy",    note: "CLI tool, Product Hunt launch, fast growth — currently penalized at 54" },

  // Healthy — established OSS with genuine communities
  { owner: "pallets",             repo: "flask",                  tier: "healthy",    note: "71K stars, article baseline, fork/star 0.235" },
  { owner: "langchain-ai",        repo: "langchain",              tier: "healthy",    note: "133K stars, fork/star 0.155" },
  { owner: "facebook",            repo: "react",                  tier: "control",    note: "mega-repo, very likely in our DB" },
  { owner: "browser-use",         repo: "browser-use",            tier: "healthy",    note: "50K stars in 3 months, YC W25 — fast but organic" },
  { owner: "mem0ai",              repo: "mem0",                   tier: "healthy",    note: "AI memory layer" },
  { owner: "crewAIInc",          repo: "crewAI",                 tier: "healthy",    note: "popular AI agent framework" },
  { owner: "agno-agi",           repo: "agno",                   tier: "healthy",    note: "AI framework, formerly phidata" },
  { owner: "langgenius",          repo: "dify",                   tier: "healthy",    note: "AI workflow builder" },
  { owner: "Significant-Gravitas", repo: "AutoGPT",               tier: "healthy",    note: "183K stars, fork/star 0.090" },

  // Suspicious — star farming signals confirmed by StarScout or article
  { owner: "unionlabs",           repo: "union",                  tier: "suspicious", note: "#1 ROSS Index Q2 2025, 47.4% fake per StarScout" },
  { owner: "shardeum",            repo: "shardeum",               tier: "suspicious", note: "fork/star 0.022, 59.3% zero-followers" },
  { owner: "langflow-ai",         repo: "langflow",               tier: "suspicious", note: "StarScout 47.9% fake" },
  { owner: "Anoma",               repo: "anoma",                  tier: "suspicious", note: "fork/star 0.121, 62% zero-followers" },
  { owner: "raga-ai-hub",         repo: "raga-catalyst",          tier: "suspicious", note: "76.2% zero-followers, 28% ghost" },

  // Controls
  { owner: "sindresorhus",        repo: "awesome",                tier: "control",    note: "curated list — fork/star structurally low" },
  { owner: "yargs",               repo: "yargs",                  tier: "control",    note: "mature CLI library — natural low fork ratio" },
];

// ─── Normalizers (production values from organic-score.ts) ───────────────────

const lerp = (v: number, lo: number, hi: number, outLo: number, outHi: number) =>
  outLo + ((v - lo) / (hi - lo)) * (outHi - outLo);

const clamp = (v: number) => Math.max(0, Math.min(100, v));

const normFork = (v: number | null): number | null => {
  if (v === null) return null;
  if (v >= 0.10) return 100;
  if (v <= 0.02) return 0;
  if (v >= 0.07) return clamp(lerp(v, 0.07, 0.10, 50, 100));
  return clamp(lerp(v, 0.02, 0.07, 0, 50));
};

const normWatcher = (v: number | null): number | null => {
  if (v === null) return null;
  if (v >= 0.005) return 100;
  if (v <= 0.0001) return 0;
  if (v >= 0.001) return clamp(lerp(v, 0.001, 0.005, 50, 100));
  return clamp(lerp(v, 0.0001, 0.001, 0, 50));
};

const normZeroFollower = (v: number | null): number | null => {
  if (v === null) return null;
  if (v <= 10) return 100;
  if (v >= 60) return 0;
  if (v <= 30) return clamp(lerp(v, 10, 30, 100, 50));
  return clamp(lerp(v, 30, 60, 50, 0));
};

// Burst signal normalizer:
// ≤ 10% of stars in best 7d window → very healthy spread → 100
// 25% → 50 (borderline)
// ≥ 50% → clearly concentrated burst → 0
const normBurst7d = (v: number | null): number | null => {
  if (v === null) return null;
  if (v <= 0.10) return 100;
  if (v >= 0.50) return 0;
  if (v <= 0.25) return clamp(lerp(v, 0.10, 0.25, 100, 50));
  return clamp(lerp(v, 0.25, 0.50, 50, 0));
};

// ─── Score computation ────────────────────────────────────────────────────────

type Weights = {
  fork: number;
  burst: number;
  zf: number;
  watcher: number;
};

const GATE_FORK_MIN_STARS = 5000;
const GATE_BURST_MIN_SAMPLE = 500;
const GATE_ZF_MIN_SAMPLE = 30;

type SignalInputs = {
  starsCount: number;
  forksCount: number;
  watchersCount: number;
  zfPct: number | null;
  zfSampleSize: number | null;
  burstRatio7d: number | null;
  burstScannedCount: number | null;
};

const computeScore = (s: SignalInputs, w: Weights): number | null => {
  const forkRatio    = s.starsCount > 0 ? s.forksCount / s.starsCount : null;
  const watcherRatio = s.starsCount > 0 ? s.watchersCount / s.starsCount : null;

  const forkActive   = s.starsCount >= GATE_FORK_MIN_STARS;
  const burstActive  = s.burstRatio7d !== null && (s.burstScannedCount ?? 0) >= GATE_BURST_MIN_SAMPLE;
  const zfActive     = s.zfPct !== null && (s.zfSampleSize ?? 0) >= GATE_ZF_MIN_SAMPLE;
  const watchActive  = true;

  type Pair = [number | null, number];
  const active: Pair[] = [
    forkActive  ? [normFork(forkRatio),                    w.fork]    : null,
    burstActive ? [normBurst7d(s.burstRatio7d!),           w.burst]   : null,
    zfActive    ? [normZeroFollower(s.zfPct!),             w.zf]      : null,
    watchActive ? [normWatcher(watcherRatio),               w.watcher] : null,
  ].filter((p): p is [number | null, number] => p !== null && p[0] !== null);

  const valid = active.filter((p): p is [number, number] => p[0] !== null);
  if (valid.length === 0) return null;

  const totalW = valid.reduce((s, [, w]) => s + w, 0);
  return Math.round(valid.reduce((s, [v, w]) => s + v * w, 0) / totalW);
};

// Weight presets to compare
const PRESETS: Record<string, Weights> = {
  "v1 (current)":  { fork: 70, burst: 0,  zf: 25, watcher: 5 },
  "v2-A 40/30":    { fork: 40, burst: 30, zf: 25, watcher: 5 },
  "v2-B 50/20":    { fork: 50, burst: 20, zf: 25, watcher: 5 },
  "v2-C 35/35":    { fork: 35, burst: 35, zf: 25, watcher: 5 },
};

// ─── GitHub API ───────────────────────────────────────────────────────────────

type GHRepo = { stargazers_count: number; forks_count: number; subscribers_count: number };

const fetchGHRepo = async (owner: string, repo: string): Promise<GHRepo | null> => {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return null;
  const d = await res.json() as GHRepo & { message?: string };
  return d.message ? null : d;
};

// ─── DB queries ───────────────────────────────────────────────────────────────

type DailyBucket = { day: Date; cnt: bigint };

const queryBurst = async (
  db: PrismaClient,
  owner: string,
  repo: string,
): Promise<{ ratio1d: number; ratio3d: number; ratio7d: number; scannedCount: number } | null> => {
  try {
    const rows = await db.$queryRaw<DailyBucket[]>`
      SELECT DATE_TRUNC('day', "starredAt")::date AS day, COUNT(*)::bigint AS cnt
      FROM star_event
      WHERE owner = ${owner} AND repo = ${repo}
      GROUP BY day
      ORDER BY day
    `;
    if (rows.length === 0) return null;

    const daily = rows.map((r) => Number(r.cnt));
    const total = daily.reduce((s, n) => s + n, 0);
    if (total === 0) return null;

    // Rolling max windows in JS
    const rollingMax = (windowSize: number): number => {
      let max = 0;
      for (let i = 0; i < daily.length; i++) {
        let sum = 0;
        for (let j = i; j < Math.min(i + windowSize, daily.length); j++) {
          sum += daily[j];
        }
        if (sum > max) max = sum;
      }
      return max;
    };

    return {
      ratio1d:       rollingMax(1) / total,
      ratio3d:       rollingMax(3) / total,
      ratio7d:       rollingMax(7) / total,
      scannedCount:  total,
    };
  } catch (err) {
    console.warn(`  burst query failed: ${String(err).split("\n")[0]}`);
    return null;
  }
};

const queryZeroFollower = async (
  db: PrismaClient,
  owner: string,
  repo: string,
): Promise<{ pct: number; sampleSize: number } | null> => {
  try {
    const rows = await db.$queryRaw<Array<{ zero: bigint; total: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero,
        COUNT(*)::bigint AS total
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner} AND se.repo = ${repo}
        AND gu."dataVersion" >= 1
    `;
    const row = rows[0];
    if (!row || Number(row.total) === 0) return null;
    return {
      pct:        (Number(row.zero) / Number(row.total)) * 100,
      sampleSize: Number(row.total),
    };
  } catch (err) {
    console.warn(`  ZF query failed: ${String(err).split("\n")[0]}`);
    return null;
  }
};

// ─── Output helpers ───────────────────────────────────────────────────────────

const pct = (v: number | null, dec = 1) =>
  v === null ? "   —  " : `${(v * 100).toFixed(dec)}%`.padStart(7);

const score = (v: number | null) =>
  v === null ? " — " : String(v).padStart(3);

const tier = (v: number | null): string =>
  v === null ? "insufficient" :
  v >= 80 ? "healthy" :
  v >= 50 ? "moderate" : "suspicious";

const tierIcon = (expected: ExpectedTier, actual: number | null): string => {
  if (expected === "control") return " · ";
  if (actual === null) return " ? ";
  if (expected === "healthy")    return actual >= 70 ? " ✅" : " ❌";
  if (expected === "suspicious") return actual <= 50 ? " ✅" : " ❌";
  return " · ";
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`\nOrganic Score v2 — Burst Signal Calibration`);
  console.log(`DB: ${SKIP_DB ? "skipped" : USE_LOCAL ? "local" : "Neon (prod)"}`);
  console.log(`─`.repeat(120));

  let db: PrismaClient | null = null;
  if (!SKIP_DB) {
    try {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      db = new PrismaClient({ adapter: new PrismaPg(pool) } as never);
      await db.$queryRaw`SELECT 1`;
      console.log("✓ DB connected\n");
    } catch (err) {
      console.warn("⚠ DB connection failed — running without burst/ZF signals\n", String(err).split("\n")[0]);
      db = null;
    }
  }

  type ProbeResult = {
    entry: CorpusEntry;
    ghStars: number | null;
    burst: { ratio1d: number; ratio3d: number; ratio7d: number; scannedCount: number } | null;
    completeness: number | null;
    zf: { pct: number; sampleSize: number } | null;
    scores: Record<string, number | null>;
  };

  const results: ProbeResult[] = [];

  for (const entry of CORPUS) {
    process.stdout.write(`  ${(entry.owner + "/" + entry.repo).padEnd(45)} `);

    const gh = await fetchGHRepo(entry.owner, entry.repo);
    if (!gh) {
      console.log("❌ 404");
      results.push({ entry, ghStars: null, burst: null, completeness: null, zf: null, scores: {} });
      continue;
    }

    let burst: ProbeResult["burst"] = null;
    let zf:    ProbeResult["zf"]    = null;

    if (db) {
      [burst, zf] = await Promise.all([
        queryBurst(db, entry.owner, entry.repo),
        queryZeroFollower(db, entry.owner, entry.repo),
      ]);
    }

    const completeness = burst && gh.stargazers_count > 0
      ? burst.scannedCount / gh.stargazers_count
      : null;

    const burstReliable = completeness !== null && completeness >= 0.9;
    const burstForScore = burstReliable ? burst : null;

    const signals: SignalInputs = {
      starsCount:       gh.stargazers_count,
      forksCount:       gh.forks_count,
      watchersCount:    gh.subscribers_count,
      zfPct:            zf?.pct ?? null,
      zfSampleSize:     zf?.sampleSize ?? null,
      burstRatio7d:     burstForScore?.ratio7d ?? null,
      burstScannedCount: burstForScore?.scannedCount ?? null,
    };

    const scores: Record<string, number | null> = {};
    for (const [name, w] of Object.entries(PRESETS)) {
      scores[name] = computeScore(signals, w);
    }

    const burstStr = burst
      ? `burst1d=${pct(burst.ratio1d).trim()} 3d=${pct(burst.ratio3d).trim()} 7d=${pct(burst.ratio7d).trim()} scanned=${burst.scannedCount.toLocaleString()}${burstReliable ? "" : " ⚠ partial"}`
      : "no star_event data";
    const zfStr = zf ? `zf=${zf.pct.toFixed(1)}% n=${zf.sampleSize}` : "zf=—";

    console.log(`✓ GH=${gh.stargazers_count.toLocaleString().padStart(7)} forks=${(gh.forks_count / gh.stargazers_count).toFixed(3)} watchers=${(gh.subscribers_count / gh.stargazers_count).toFixed(4)} | ${burstStr} | ${zfStr}`);

    results.push({ entry, ghStars: gh.stargazers_count, burst, completeness, zf, scores });
    await new Promise((r) => setTimeout(r, 350));
  }

  // ─── Score comparison table ──────────────────────────────────────────────────

  const presetNames = Object.keys(PRESETS);

  console.log(`\n${"─".repeat(120)}`);
  console.log("SCORE COMPARISON TABLE\n");

  const header = [
    "Repo".padEnd(45),
    "Exp".padEnd(10),
    "GH Stars".padStart(9),
    "Complete".padStart(9),
    "Burst7d".padStart(8),
    ...presetNames.map((n) => n.padStart(14)),
  ].join(" | ");

  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    if (!r.ghStars) continue;
    const row = [
      (r.entry.owner + "/" + r.entry.repo).padEnd(45),
      r.entry.tier.padEnd(10),
      r.ghStars.toLocaleString().padStart(9),
      r.completeness !== null ? `${(r.completeness * 100).toFixed(0)}%`.padStart(9) : "    —    ",
      pct(r.burst?.ratio7d ?? null).padStart(8),
      ...presetNames.map((n) => {
        const s = r.scores[n];
        return `${score(s)} ${tier(s).padEnd(11)}`.padStart(14) + tierIcon(r.entry.tier, s);
      }),
    ].join(" | ");
    console.log(row);
  }

  // ─── Summary: which weight sets meet the criteria ────────────────────────────

  console.log(`\n${"─".repeat(80)}`);
  console.log("PASS/FAIL PER WEIGHT SET (healthy ≥ 70, suspicious ≤ 50)\n");

  for (const name of presetNames) {
    const healthyEntries = results.filter((r) => r.entry.tier === "healthy" && r.ghStars);
    const suspiciousEntries = results.filter((r) => r.entry.tier === "suspicious" && r.ghStars);

    const healthyPass = healthyEntries.filter((r) => {
      const s = r.scores[name]; return s !== null && s >= 70;
    }).length;
    const suspiciousPass = suspiciousEntries.filter((r) => {
      const s = r.scores[name]; return s !== null && s <= 50;
    }).length;

    const total = healthyEntries.length + suspiciousEntries.length;
    const pctOk = total > 0 ? Math.round(((healthyPass + suspiciousPass) / total) * 100) : 0;

    const rtkResult = results.find((r) => r.entry.owner === "rtk-ai");
    const rtkScore  = rtkResult?.scores[name];
    const rtkMark   = rtkScore !== null && rtkScore !== undefined && rtkScore >= 70 ? "✅" : "❌";

    console.log(
      `  ${name.padEnd(18)} healthy ${healthyPass}/${healthyEntries.length} · suspicious ${suspiciousPass}/${suspiciousEntries.length} · fit ${pctOk}% | RTK ${rtkScore ?? "—"} ${rtkMark}`,
    );
  }

  console.log(`\n${"─".repeat(80)}`);
  console.log("NOTES");
  console.log("  ⚠ partial = completeness < 90% — burst signal unreliable for this repo");
  console.log("  Burst is GATED if scannedCount < 500 (too small a sample)");
  console.log("  v2-A/B/C only activate burst if completeness ≥ 90% AND scannedCount ≥ 500\n");

  if (db) await (db as PrismaClient).$disconnect();
};

main().catch((err) => { console.error(err); process.exit(1); });
