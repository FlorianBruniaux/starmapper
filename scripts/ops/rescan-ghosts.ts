// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * rescan-ghosts.ts
 *
 * Rescans repos that StarMapper knows about but holds no map data for. Two shapes qualify:
 *
 *   1. a badge_cache row with no matching stargazer_cache (indexed badge, no points)
 *   2. a badge_cache row with totalCount = 0 (ghost written by a scan that yielded nothing)
 *
 * The list is queried from the database rather than hardcoded, so the script stays correct as
 * repos get fixed or new ones break.
 *
 * Two preflight checks run before anything is written, because a rescan launched during a
 * GitHub degradation recreates exactly the ghosts it is meant to repair:
 *
 *   A. GitHub must return a non-empty stargazers connection for a control repo
 *   B. the target API must reject empty stargazer lists (the guard from f23df05 deployed)
 *
 * Each repo is driven through the existing chunk loop by spawning scripts/ops/index-repo.ts,
 * so there is exactly one implementation of the scan.
 *
 * Usage:
 *   pnpm tsx scripts/ops/rescan-ghosts.ts --dry-run
 *   pnpm tsx scripts/ops/rescan-ghosts.ts --max-stars=10000
 *   pnpm tsx scripts/ops/rescan-ghosts.ts --limit=3 --gh-token=ghp_xxx
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { prisma } from "@/lib/db";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "base-url": { type: "string", default: "https://starmapper.bruniaux.com" },
    "gh-token": { type: "string" },
    // Guards against burning the hourly GraphQL budget on a 120k-star repo by accident.
    "max-stars": { type: "string", default: "150000" },
    "min-stars": { type: "string", default: "0" },
    limit: { type: "string", default: "50" },
    "delay-ms": { type: "string", default: "5000" },
    // Escape hatch for a deliberate run against a target that has not shipped the guard yet.
    "skip-preflight": { type: "boolean", default: false },
  },
  strict: true,
  args: process.argv.slice(2),
});

const dryRun = values["dry-run"];
const baseUrl = (values["base-url"] as string).replace(/\/$/, "");
const ghToken = values["gh-token"] as string | undefined;
const maxStars = parseInt(values["max-stars"] ?? "150000", 10);
const minStars = parseInt(values["min-stars"] ?? "0", 10);
const limit = parseInt(values.limit ?? "50", 10);
const delayMs = parseInt(values["delay-ms"] ?? "5000", 10);
const skipPreflight = values["skip-preflight"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ghost = { owner: string; repo: string; totalCount: number; reason: string };

// ─── Preflight ────────────────────────────────────────────────────────────────

const CONTROL_REPO = { owner: "facebook", repo: "react" };

/** A. GitHub must actually hand back stargazers. */
const checkGitHubHealthy = async (): Promise<boolean> => {
  const token = ghToken ?? process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("No GitHub token available (pass --gh-token or set GITHUB_TOKEN).");
    return false;
  }
  const query = `query { repository(owner: "${CONTROL_REPO.owner}", name: "${CONTROL_REPO.repo}") {
    stargazerCount stargazers(first: 3) { edges { node { login } } } } }`;

  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (json.errors) {
      console.error(`GitHub GraphQL error: ${json.errors[0].message}`);
      return false;
    }
    const repo = json.data?.repository;
    const edges: unknown[] = repo?.stargazers?.edges ?? [];
    if (repo?.stargazerCount > 0 && edges.length === 0) {
      console.error(
        `GitHub reports ${repo.stargazerCount} stars on ${CONTROL_REPO.owner}/${CONTROL_REPO.repo} ` +
          "but returns an empty stargazer list. Its API is degraded, rescanning now would " +
          "recreate the ghosts. Retry later.",
      );
      return false;
    }
    console.log(`  GitHub OK — control repo returned ${edges.length} edges`);
    return true;
  } catch (err) {
    console.error(`GitHub unreachable: ${(err as Error).message}`);
    return false;
  }
};

/**
 * B. The target must reject empty stargazer lists. Verified indirectly: a chunk on a repo
 * with stars must never come back 200 with zero points and zero unmapped.
 */
const checkTargetGuarded = async (probe: Ghost | undefined): Promise<boolean> => {
  if (!probe) return true; // nothing to rescan, nothing to verify
  try {
    const page = await fetch(`${baseUrl}/${probe.owner}/${probe.repo}`);
    const cookie = page.headers.get("set-cookie")?.split(";")[0] ?? "";
    const res = await fetch(`${baseUrl}/api/chunk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ owner: probe.owner, repo: probe.repo, cursor: null }),
    });

    if (res.status === 503) {
      const body = (await res.json()) as { error?: string };
      if (body.error === "github_empty_stargazers") {
        console.error("Target rejects empty lists correctly, but GitHub is still degraded.");
        return false;
      }
    }
    if (!res.ok) {
      console.error(`Probe chunk returned HTTP ${res.status}, aborting out of caution.`);
      return false;
    }

    const body = (await res.json()) as {
      points: unknown[];
      unmapped: unknown[];
      totalCount: number;
    };
    if (body.totalCount > 0 && body.points.length === 0 && body.unmapped.length === 0) {
      console.error(
        `${baseUrl} returned an empty chunk for a repo with ${body.totalCount} stars without ` +
          "erroring. Either the empty-list guard is not deployed there, or GitHub is degraded. " +
          "Rescanning would write repos with no data. Use --skip-preflight to override.",
      );
      return false;
    }
    console.log(`  Target OK — probe chunk returned ${body.points.length} points`);
    return true;
  } catch (err) {
    console.error(`Target unreachable: ${(err as Error).message}`);
    return false;
  }
};

// ─── Ghost discovery ──────────────────────────────────────────────────────────

const findGhosts = async (): Promise<Ghost[]> => {
  const rows = await prisma.$queryRaw<Array<{ owner: string; repo: string; totalCount: number; reason: string }>>`
    SELECT bc.owner, bc.repo, bc."totalCount", 'no_stargazer_cache' AS reason
    FROM badge_cache bc
    LEFT JOIN stargazer_cache sc ON sc.owner = bc.owner AND sc.repo = bc.repo
    WHERE sc.owner IS NULL AND bc."totalCount" > 0
    UNION ALL
    SELECT bc.owner, bc.repo, bc."totalCount", 'total_count_zero' AS reason
    FROM badge_cache bc
    WHERE bc."totalCount" = 0
    ORDER BY 3 DESC
  `;
  return rows.map((r) => ({ ...r, totalCount: Number(r.totalCount) }));
};

// ─── Scan one repo through the existing chunk loop ────────────────────────────

const scanRepo = (owner: string, repo: string): Promise<number> =>
  new Promise((resolve) => {
    const args = ["scripts/ops/index-repo.ts", `${owner}/${repo}`, "--base-url", baseUrl];
    if (ghToken) args.push("--gh-token", ghToken);

    const child = spawn("node_modules/.bin/tsx", args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`  spawn failed: ${err.message}`);
      resolve(1);
    });
  });

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log(`rescan-ghosts — target ${baseUrl}${dryRun ? " (dry-run)" : ""}`);

  const all = await findGhosts();
  const eligible = all
    .filter((g) => g.totalCount <= maxStars && g.totalCount >= minStars)
    .slice(0, limit);
  const skipped = all.length - eligible.length;

  console.log(`\nFound ${all.length} repos with no map data:`);
  for (const g of all) {
    const mark = eligible.includes(g) ? " " : "-";
    console.log(`  ${mark} ${g.owner}/${g.repo}  ${g.totalCount} stars  (${g.reason})`);
  }
  if (skipped > 0) {
    console.log(
      `\n${skipped} skipped by --limit=${limit} / --min-stars=${minStars} / --max-stars=${maxStars}.`,
    );
  }
  if (eligible.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  const budget = eligible.reduce((s, g) => s + g.totalCount, 0);
  console.log(
    `\n${eligible.length} repos to rescan, ${budget.toLocaleString()} stars cumulated ` +
      `(~${Math.ceil(budget / 10).toLocaleString()} GraphQL points, budget is 5000/hr per token).`,
  );

  if (!skipPreflight) {
    console.log("\nPreflight:");
    const ghOk = await checkGitHubHealthy();
    if (!ghOk) {
      console.error("\nAborted: GitHub is not serving stargazers.");
      process.exitCode = 1;
      return;
    }
    const targetOk = await checkTargetGuarded(eligible[0]);
    if (!targetOk) {
      console.error("\nAborted: target preflight failed.");
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("\nPreflight skipped (--skip-preflight).");
  }

  if (dryRun) {
    console.log("\n[dry-run] Stopping here, no repo was scanned.");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const [i, g] of eligible.entries()) {
    console.log(`\n─── [${i + 1}/${eligible.length}] ${g.owner}/${g.repo} (${g.totalCount} stars)`);
    const code = await scanRepo(g.owner, g.repo);
    if (code === 0) {
      ok++;
    } else {
      failed++;
      console.error(`  FAILED — exit ${code}`);
    }
    if (i < eligible.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  console.log(`\nDone. ${ok} rescanned, ${failed} failed, ${skipped} skipped.`);
  if (failed > 0) process.exitCode = 1;
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
