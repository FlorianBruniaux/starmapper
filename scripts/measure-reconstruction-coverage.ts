// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * measure-reconstruction-coverage.ts
 *
 * POC-B: the crawler go/no-go gate. Zero GitHub API calls, pure SQL on our own DB.
 *
 * The question: if we crawl our known users' starredRepositories, how much of a
 * repo's stargazer set do we reconstruct? A user's star of repo X is recoverable
 * from the crawl only if that user is already in our pool via some OTHER repo.
 * So the leave-one-out coverage of X is:
 *
 *   recovered(X) = stargazers of X who ALSO appear in star_event for a repo != X
 *   coverage(X)  = recovered(X) / totalStargazers(X)
 *
 * This simulates "forget we ever scanned X" and measures how many of its
 * stargazers we would still know, hence recover by crawling the known pool.
 * mappable(X) narrows that to users we can actually place (lat/lng not null).
 *
 * Read-only (SELECT only). Runs against whatever DATABASE_URL is set: prod, or a
 * local mirror after `pnpm db:sync:from-prod`.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a && pnpm tsx scripts/measure-reconstruction-coverage.ts
 *   ... --repo facebook/react          # a specific repo
 *   ... --limit 12                     # auto-sample N mid-size repos (default 10)
 */

import { parseArgs } from "node:util";

import { prisma } from "@/lib/db";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    limit: { type: "string", default: "10" },
  },
  strict: true,
  args: process.argv.slice(2),
});

type RepoRow = { owner: string; repo: string };
type Coverage = { owner: string; repo: string; total: number; recovered: number; mappable: number };

/**
 * Repos to test: an explicit one, or a random mid-size sample. The sample reads
 * `stargazer_cache` (2,642 rows, has totalCount already), NOT a GROUP BY over the
 * 33M-row star_event, so it is safe to run against prod.
 */
const selectRepos = async (): Promise<RepoRow[]> => {
  if (values.repo) {
    const [owner, repo] = values.repo.split("/");
    return owner && repo ? [{ owner, repo }] : [];
  }
  const limit = parseInt(values.limit ?? "10", 10);
  // Mid-size repos are the honest test: huge repos skew high, tiny ones are noise.
  const rows = await prisma.$queryRaw<RepoRow[]>`
    SELECT owner, repo
    FROM stargazer_cache
    WHERE "totalCount" BETWEEN 1000 AND 15000
    ORDER BY RANDOM()
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ owner: r.owner, repo: r.repo }));
};

const coverageFor = async (owner: string, repo: string): Promise<Coverage> => {
  // Single EXISTS per target login (not three subqueries), then one LEFT JOIN to
  // github_user with FILTER counts. Roughly 3x cheaper than the naive form, to
  // stay under the Neon pooler statement timeout.
  const rows = await prisma.$queryRaw<Array<{ total: bigint; recovered: bigint; mappable: bigint }>>`
    WITH target AS (
      SELECT DISTINCT login FROM star_event WHERE owner = ${owner} AND repo = ${repo}
    ),
    flagged AS (
      SELECT
        t.login,
        EXISTS (
          SELECT 1 FROM star_event o
          WHERE o.login = t.login AND NOT (o.owner = ${owner} AND o.repo = ${repo})
        ) AS rec
      FROM target t
    )
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE f.rec)::bigint AS recovered,
      COUNT(*) FILTER (WHERE f.rec AND gu.lat IS NOT NULL AND gu.lng IS NOT NULL)::bigint AS mappable
    FROM flagged f
    LEFT JOIN github_user gu ON gu.login = f.login
  `;
  const r = rows[0] ?? { total: 0n, recovered: 0n, mappable: 0n };
  return { owner, repo, total: Number(r.total), recovered: Number(r.recovered), mappable: Number(r.mappable) };
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : (((s[mid - 1] as number) + (s[mid] as number)) / 2);
};

const main = async (): Promise<void> => {
  console.log("\nPOC-B reconstruction coverage (leave-one-out, zero API)\n");
  const repos = await selectRepos();
  if (repos.length === 0) {
    console.error("No repos selected. Pass --repo owner/repo or check the DB.");
    return;
  }

  console.log("repo                                total   recovered  cov%   mappable  map%");
  console.log("─".repeat(78));

  const covPcts: number[] = [];
  const mapPcts: number[] = [];
  for (const { owner, repo } of repos) {
    const name = `${owner}/${repo}`.slice(0, 34);
    try {
      const c = await coverageFor(owner, repo);
      const cov = c.total > 0 ? (c.recovered / c.total) * 100 : 0;
      const map = c.total > 0 ? (c.mappable / c.total) * 100 : 0;
      covPcts.push(cov);
      mapPcts.push(map);
      console.log(
        `${name.padEnd(34)} ${String(c.total).padStart(7)}   ${String(c.recovered).padStart(8)}  ${cov.toFixed(0).padStart(3)}%   ${String(c.mappable).padStart(7)}  ${map.toFixed(0).padStart(3)}%`,
      );
    } catch {
      // One repo timing out must not kill the whole sample.
      console.log(`${name.padEnd(34)} ${"SKIPPED (query timeout)".padStart(40)}`);
    }
  }

  console.log("─".repeat(78));
  console.log(`\nMedian recovery coverage : ${median(covPcts).toFixed(1)}%`);
  console.log(`Median mappable coverage : ${median(mapPcts).toFixed(1)}%  (recovered AND geolocated)`);
  console.log(`\nGate reading: mappable coverage is what actually renders on a map.`);
  console.log(`If the median is low (say under ~20%), the crawler rebuilds only a thin`);
  console.log(`slice of a new repo's map and is probably not worth its cost and token risk.`);
  console.log(`If it is high, the reverse crawl genuinely resurrects per-repo maps.\n`);
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
