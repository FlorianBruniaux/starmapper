// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Phase 0 calibration: fetch raw signals for a corpus of repos and grid-search
// optimal weights for the Organic Score algorithm.
//
// Usage:
//   pnpm exec tsx scripts/ops/calibrate-organic-score.ts
//   pnpm exec tsx scripts/ops/calibrate-organic-score.ts --no-db  # skip DB signal, API only
//   pnpm exec tsx scripts/ops/calibrate-organic-score.ts --md     # write docs/organic-score-calibration.md

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "../lib/pg-pool";

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

// ─── Corpus ───────────────────────────────────────────────────────────────────

type ExpectedTier = "healthy" | "suspicious" | "control";

type CorpusEntry = {
  owner: string;
  repo: string;
  tier: ExpectedTier;
  note: string;
};

const CORPUS: CorpusEntry[] = [
  // Healthy — established OSS projects with genuine communities
  { owner: "pallets",               repo: "flask",                  tier: "healthy",    note: "71K stars, article baseline, fork/star 0.235" },
  { owner: "langchain-ai",          repo: "langchain",              tier: "healthy",    note: "133K stars, article baseline, fork/star 0.155" },
  { owner: "Significant-Gravitas",  repo: "AutoGPT",                tier: "healthy",    note: "183K stars, article baseline, fork/star 0.090" },
  { owner: "crewAIInc",             repo: "crewAI",                 tier: "healthy",    note: "popular AI agent framework" },
  { owner: "langgenius",            repo: "dify",                   tier: "healthy",    note: "dify AI workflow builder" },
  { owner: "agno-agi",              repo: "agno",                   tier: "healthy",    note: "AI framework, formerly phidata" },
  { owner: "mem0ai",                repo: "mem0",                   tier: "healthy",    note: "AI memory layer" },
  { owner: "browser-use",           repo: "browser-use",            tier: "healthy",    note: "50K stars in 3 months, YC W25" },
  { owner: "NousResearch",          repo: "hermes-function-calling", tier: "healthy",    note: "article: relatively organic despite crypto-adjacent" },
  { owner: "yargs",                 repo: "yargs",                  tier: "healthy",    note: "mature npm CLI library" },

  // Suspicious — flagged by StarScout or article with high manipulation signals
  { owner: "unionlabs",             repo: "union",                  tier: "suspicious", note: "#1 ROSS Index Q2 2025, 47.4% fake per StarScout" },
  { owner: "shardeum",              repo: "shardeum",               tier: "suspicious", note: "fork/star 0.022, 59.3% zero-followers per article" },
  { owner: "Anoma",                 repo: "anoma",                  tier: "suspicious", note: "fork/star 0.121, 62% zero-followers per article" },
  { owner: "raga-ai-hub",           repo: "raga-catalyst",          tier: "suspicious", note: "76.2% zero-followers, 28% ghost per article" },
  { owner: "langflow-ai",           repo: "langflow",               tier: "suspicious", note: "StarScout 47.9% fake, though profile improved" },
  { owner: "FreeDomainRadio",       repo: "freedomain",             tier: "suspicious", note: "157K stars, watcher/star 0.001, 81.3% zero-followers — slug uncertain" },

  // Control — verify edge cases or repos we've scanned
  { owner: "openai",                repo: "openai-fm",              tier: "control",    note: "66% suspicious accounts per article (3rd party bots, not OpenAI)" },
  { owner: "sindresorhus",          repo: "awesome",                tier: "control",    note: "curated list — fork/star naturally low, should handle gracefully" },
  { owner: "facebook",              repo: "react",                  tier: "control",    note: "mega-repo, very likely in our DB" },
];

// ─── Organic score math ───────────────────────────────────────────────────────

type RawSignals = {
  starsCount: number;
  forksCount: number;
  watchersCount: number; // subscribers_count = watchers in REST
  zeroFollowerCount: number | null;
  sampleSize: number | null;
};

type ComputedSignals = {
  forkRatio: number | null;      // forks / stars
  watcherRatio: number | null;   // watchers / stars
  zeroFollowerPct: number | null; // 0..100
};

const computeSignals = (raw: RawSignals): ComputedSignals => ({
  forkRatio:
    raw.starsCount >= 5000 && raw.starsCount > 0
      ? raw.forksCount / raw.starsCount
      : null,
  watcherRatio:
    raw.starsCount > 0 ? raw.watchersCount / raw.starsCount : null,
  zeroFollowerPct:
    raw.sampleSize !== null && raw.sampleSize >= 30 && raw.zeroFollowerCount !== null
      ? (raw.zeroFollowerCount / raw.sampleSize) * 100
      : null,
});

// Normalize each signal to 0-100 via linear interpolation between paliers.
// Returns null when signal is gated off (null input).
// Paliers calibrés empiriquement : ≥0.10 → 100, 0.07 → 50, ≤0.02 → 0
// (0.15 était trop haut — Mem0/browser-use à 0.11 sont légitimes)
const normalizeForkRatio = (v: number | null): number | null => {
  if (v === null) return null;
  if (v >= 0.10) return 100;
  if (v <= 0.02) return 0;
  if (v >= 0.07) return 50 + ((v - 0.07) / (0.10 - 0.07)) * 50; // 0.07→50, 0.10→100
  return ((v - 0.02) / (0.07 - 0.02)) * 50;                       // 0.02→0, 0.07→50
};

const normalizeWatcherRatio = (v: number | null): number | null => {
  if (v === null) return null;
  if (v >= 0.020) return 100;
  if (v <= 0.001) return 0;
  return ((v - 0.001) / (0.020 - 0.001)) * 100;
};

const normalizeZeroFollowerPct = (v: number | null): number | null => {
  if (v === null) return null;
  if (v <= 10) return 100;
  if (v >= 60) return 0;
  return ((60 - v) / (60 - 10)) * 100;
};

const computeScore = (
  signals: ComputedSignals,
  weights: [number, number, number], // [fork, watcher, zeroFollower], sum = 100
): number | null => {
  const n1 = normalizeForkRatio(signals.forkRatio);
  const n2 = normalizeWatcherRatio(signals.watcherRatio);
  const n3 = normalizeZeroFollowerPct(signals.zeroFollowerPct);

  const pairs: Array<[number | null, number]> = [
    [n1, weights[0]],
    [n2, weights[1]],
    [n3, weights[2]],
  ];
  const active = pairs.filter((p): p is [number, number] => p[0] !== null);

  if (active.length === 0) return null;

  const totalWeight = active.reduce((s, [, w]) => s + w, 0);
  if (totalWeight === 0) return null;

  const score = active.reduce((s, [v, w]) => s + v * w, 0) / totalWeight;
  return Math.round(score);
};

// ─── GitHub API ───────────────────────────────────────────────────────────────

type GHRepoData = {
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number; // actual watchers (not stargazers)
  message?: string;
};

const fetchGHRepo = async (owner: string, repo: string): Promise<GHRepoData | null> => {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return null;
  const d = await res.json() as GHRepoData;
  if (d.message) return null;
  return d;
};

// ─── DB query ─────────────────────────────────────────────────────────────────

const querySample = async (
  db: PrismaClient,
  owner: string,
  repo: string,
): Promise<{ zeroFollowerCount: number; sampleSize: number } | null> => {
  try {
    const rows = await db.$queryRaw<Array<{ zero_count: bigint; sample_size: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE gu.followers = 0)::bigint AS zero_count,
        COUNT(*)::bigint                                  AS sample_size
      FROM github_user gu
      INNER JOIN star_event se ON se.login = gu.login
      WHERE se.owner = ${owner}
        AND se.repo  = ${repo}
        AND gu."dataVersion" >= 1
    `;
    const row = rows[0];
    if (!row || Number(row.sample_size) === 0) return null;
    return {
      zeroFollowerCount: Number(row.zero_count),
      sampleSize: Number(row.sample_size),
    };
  } catch (err) {
    console.warn(`  DB query failed for ${owner}/${repo}:`, String(err).split("\n")[0]);
    return null;
  }
};

// ─── Grid search ──────────────────────────────────────────────────────────────

type RepoResult = {
  entry: CorpusEntry;
  raw: RawSignals | null;
  signals: ComputedSignals | null;
  apiOk: boolean;
};

const gridSearch = (results: RepoResult[]): {
  bestWeights: [number, number, number];
  bestFit: number;
  matrix: Array<{ weights: [number, number, number]; fit: number; details: string }>;
} => {
  const healthyResults = results.filter((r) => r.entry.tier === "healthy" && r.signals);
  const suspiciousResults = results.filter((r) => r.entry.tier === "suspicious" && r.signals);

  let bestWeights: [number, number, number] = [35, 25, 40];
  let bestFit = -1;
  const matrix: Array<{ weights: [number, number, number]; fit: number; details: string }> = [];

  // Step 5 for manageable combinations
  for (let w1 = 0; w1 <= 100; w1 += 5) {
    for (let w2 = 0; w2 <= 100 - w1; w2 += 5) {
      const w3 = 100 - w1 - w2;
      if (w3 < 0) continue;
      const weights: [number, number, number] = [w1, w2, w3];

      let healthyPass = 0;
      for (const r of healthyResults) {
        const s = computeScore(r.signals!, weights);
        if (s !== null && s >= 75) healthyPass++;
      }

      let suspiciousPass = 0;
      for (const r of suspiciousResults) {
        const s = computeScore(r.signals!, weights);
        if (s !== null && s <= 50) suspiciousPass++;
      }

      const totalPossible = healthyResults.length + suspiciousResults.length;
      const fit = totalPossible > 0 ? ((healthyPass + suspiciousPass) / totalPossible) * 100 : 0;

      if (fit > bestFit) {
        bestFit = fit;
        bestWeights = weights;
      }

      if (fit >= 70) {
        matrix.push({
          weights,
          fit,
          details: `healthy ${healthyPass}/${healthyResults.length} · suspicious ${suspiciousPass}/${suspiciousResults.length}`,
        });
      }
    }
  }

  matrix.sort((a, b) => b.fit - a.fit);

  return { bestWeights, bestFit, matrix: matrix.slice(0, 20) };
};

// ─── Markdown output ──────────────────────────────────────────────────────────

const fmt = (v: number | null, dec = 3) => v === null ? "—" : v.toFixed(dec);
const fmtPct = (v: number | null) => v === null ? "—" : `${v.toFixed(1)}%`;
const fmtScore = (v: number | null) => v === null ? "—" : String(v);

const buildMarkdown = (
  results: RepoResult[],
  bestWeights: [number, number, number],
  bestFit: number,
  matrix: Array<{ weights: [number, number, number]; fit: number; details: string }>,
  date: string,
): string => {
  const lines: string[] = [
    `# Organic Score — Calibration Data`,
    ``,
    `**Date**: ${date}  `,
    `**Purpose**: Empirical validation of Organic Score signals and weight selection.  `,
    `**Corpus**: ${results.length} repos (${results.filter(r => r.entry.tier === "healthy").length} healthy expected, ${results.filter(r => r.entry.tier === "suspicious").length} suspicious expected, ${results.filter(r => r.entry.tier === "control").length} controls).`,
    ``,
    `## Signal Mapping (normalisation 0→100)`,
    ``,
    `| Signal | Gate | Paliers |`,
    `|---|---|---|`,
    `| Fork/Star ratio | stars ≥ 5000 | ≥ 0.15 → 100 · 0.05 → 50 · ≤ 0.02 → 0 |`,
    `| Watcher/Star ratio | always | ≥ 0.020 → 100 · 0.005 → 50 · ≤ 0.001 → 0 |`,
    `| % zero-followers (dataVersion ≥ 1) | sampleSize ≥ 30 | ≤ 10% → 100 · 30% → 50 · ≥ 60% → 0 |`,
    ``,
    `## Raw Signals`,
    ``,
    `| Repo | Expected | Stars | Fork/Star | Watcher/Star | % zero-followers | Sample size | Note |`,
    `|---|---|---|---|---|---|---|---|`,
    ...results.map((r) => {
      const signals = r.signals;
      const tier = r.entry.tier;
      const tierEmoji = tier === "healthy" ? "✅" : tier === "suspicious" ? "🔴" : "🔶";
      if (!r.apiOk) {
        return `| ${r.entry.owner}/${r.entry.repo} | ${tierEmoji} ${tier} | ❌ 404 | — | — | — | — | ${r.entry.note} |`;
      }
      return `| ${r.entry.owner}/${r.entry.repo} | ${tierEmoji} ${tier} | ${r.raw!.starsCount.toLocaleString()} | ${fmt(signals!.forkRatio)} | ${fmt(signals!.watcherRatio)} | ${fmtPct(signals!.zeroFollowerPct)} | ${r.raw!.sampleSize ?? "—"} | ${r.entry.note} |`;
    }),
    ``,
    `## Scores with Best Weights [fork=${bestWeights[0]}%, watcher=${bestWeights[1]}%, zero-followers=${bestWeights[2]}%]`,
    ``,
    `**Grid search fit**: ${bestFit.toFixed(1)}% (% repos correctly classified healthy≥75 or suspicious≤50)`,
    ``,
    `| Repo | Expected | Score | Tier | ✓/✗ |`,
    `|---|---|---|---|---|`,
    ...results.map((r) => {
      if (!r.signals || !r.apiOk) return `| ${r.entry.owner}/${r.entry.repo} | ${r.entry.tier} | — | insufficient | — |`;
      const score = computeScore(r.signals, bestWeights);
      const tier = score === null ? "insufficient" : score >= 80 ? "healthy" : score >= 50 ? "moderate" : "suspicious";
      let pass = "—";
      if (r.entry.tier === "healthy") pass = score !== null && score >= 75 ? "✅" : "❌";
      if (r.entry.tier === "suspicious") pass = score !== null && score <= 50 ? "✅" : "❌";
      return `| ${r.entry.owner}/${r.entry.repo} | ${r.entry.tier} | ${fmtScore(score)} | ${tier} | ${pass} |`;
    }),
    ``,
    `## Top Weight Combinations (fit ≥ 70%)`,
    ``,
    `| Fork% | Watcher% | ZeroFollower% | Fit | Details |`,
    `|---|---|---|---|---|`,
    ...matrix.map((m) =>
      `| ${m.weights[0]} | ${m.weights[1]} | ${m.weights[2]} | ${m.fit.toFixed(1)}% | ${m.details} |`
    ),
    ``,
    `## Final Decision`,
    ``,
    `**Chosen weights**: fork=${bestWeights[0]}%, watcher=${bestWeights[1]}%, zero-followers=${bestWeights[2]}%`,
    ``,
    `**Rationale**: *(fill in manually after reviewing the table above)*`,
    ``,
    `**Caveats**:`,
    `- Fork/star gated on stars ≥ 5000 to avoid flagging small legit projects`,
    `- Zero-follower signal requires sampleSize ≥ 30 enriched users (dataVersion ≥ 1) in our DB`,
    `- Some suspicious repos not in our DB → signal #3 unavailable for those (API-only calibration)`,
    `- Langflow: StarScout 47.9% fake, but profil improved → moderate/suspicious acceptable`,
    `- FreeDomain: repo slug uncertain — may have 404'd`,
    ``,
    `## Links`,
    ``,
    `- [CMU/StarScout paper (ICSE 2026)](https://arxiv.org/abs/2412.13459)`,
    `- [Article: Inside GitHub's Fake Star Economy (April 2026)](https://elenamarche-tti.substack.com/p/inside-githubs-fake-star-economy)`,
    `- [Dagster investigation (2023)](https://dagster.io/blog/fake-stars)`,
  ];

  return lines.join("\n") + "\n";
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const args = process.argv.slice(2);
  const skipDb = args.includes("--no-db");
  const writeFile = args.includes("--md");

  const token = process.env.GITHUB_TOKEN;
  if (!token) console.warn("⚠ GITHUB_TOKEN not set — rate limit: 60 req/hr\n");

  let db: PrismaClient | null = null;
  if (!skipDb) {
    try {
      const pool = createScriptPool(process.env.DATABASE_URL ?? "");
      const adapter = new PrismaPg(pool);
      db = new PrismaClient({ adapter } as never);
      console.log("✓ DB connected\n");
    } catch (err) {
      console.warn("⚠ DB connection failed — running in --no-db mode\n", err);
      db = null;
    }
  }

  const results: RepoResult[] = [];

  for (const entry of CORPUS) {
    process.stdout.write(`  ${entry.owner}/${entry.repo} ... `);

    const ghData = await fetchGHRepo(entry.owner, entry.repo);
    if (!ghData) {
      console.log("❌ 404/error");
      results.push({ entry, raw: null, signals: null, apiOk: false });
      continue;
    }

    const raw: RawSignals = {
      starsCount: ghData.stargazers_count,
      forksCount: ghData.forks_count,
      watchersCount: ghData.subscribers_count,
      zeroFollowerCount: null,
      sampleSize: null,
    };

    if (db) {
      const sample = await querySample(db, entry.owner, entry.repo);
      if (sample) {
        raw.zeroFollowerCount = sample.zeroFollowerCount;
        raw.sampleSize = sample.sampleSize;
      }
    }

    const signals = computeSignals(raw);

    console.log(
      `✓ stars=${ghData.stargazers_count.toLocaleString()} fork/★=${(signals.forkRatio ?? NaN).toFixed(3)} watcher/★=${(signals.watcherRatio ?? NaN).toFixed(4)} zf%=${signals.zeroFollowerPct !== null ? signals.zeroFollowerPct.toFixed(1) + "%" : "—"}${raw.sampleSize !== null ? ` (n=${raw.sampleSize})` : ""}`
    );

    results.push({ entry, raw, signals, apiOk: true });

    await new Promise((r) => setTimeout(r, 300)); // polite delay
  }

  console.log("\n── Grid Search ──────────────────────────────────────────────");
  const { bestWeights, bestFit, matrix } = gridSearch(results);

  console.log(`\nBest weights: fork=${bestWeights[0]}% · watcher=${bestWeights[1]}% · zero-follower=${bestWeights[2]}%`);
  console.log(`Fit: ${bestFit.toFixed(1)}%\n`);

  console.log("── Scores with best weights ─────────────────────────────────");
  for (const r of results) {
    if (!r.apiOk || !r.signals) continue;
    const score = computeScore(r.signals, bestWeights);
    const tier = score === null ? "insufficient" : score >= 80 ? "healthy" : score >= 50 ? "moderate" : "suspicious";
    const pass =
      r.entry.tier === "healthy" ? (score !== null && score >= 75 ? "✅" : "❌") :
      r.entry.tier === "suspicious" ? (score !== null && score <= 50 ? "✅" : "❌") : "  ";
    console.log(`  ${pass} ${r.entry.owner}/${r.entry.repo}: ${score ?? "—"} (${tier}) [expected: ${r.entry.tier}]`);
  }

  if (writeFile) {
    const date = new Date().toISOString().split("T")[0];
    const md = buildMarkdown(results, bestWeights, bestFit, matrix, date);
    const outPath = join(process.cwd(), "docs", "organic-score-calibration.md");
    writeFileSync(outPath, md, "utf8");
    console.log(`\n✓ Written: ${outPath}`);
  }

  if (db) await db.$disconnect();
};

main().catch((err) => { console.error(err); process.exit(1); });
