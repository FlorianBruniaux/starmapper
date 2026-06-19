// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * index-repo.ts
 *
 * Drives the StarMapper chunk loop against a target API to pre-warm
 * the geocache for a GitHub repo. No DB access — pure HTTP calls.
 *
 * Bootstraps by fetching the home page to receive the HMAC session cookie
 * that the proxy sets on every page load — same mechanism as the browser.
 *
 * Usage:
 *   pnpm index:repo -- systemdesign42/system-design-academy
 *   pnpm index:repo:local -- systemdesign42/system-design-academy
 *
 * Flags:
 *   --base-url <url>   API base URL (default: https://starmapper.bruniaux.com)
 *   --timeout <ms>     Per-chunk request timeout in ms (default: 30000)
 */

import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const COOKIE_NAME = "sm-token";
// Re-bootstrap every N chunks to refresh the 2h token TTL on large repos.
const REFRESH_EVERY = 200;

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://starmapper.bruniaux.com" },
    timeout: { type: "string", default: "30000" },
    // Pass your own GitHub PAT to avoid consuming the shared server quota.
    // Generate at https://github.com/settings/tokens (read:user scope only).
    "gh-token": { type: "string" },
  },
  strict: false,
  args: process.argv.slice(2),
  allowPositionals: true,
});

const repoArg = positionals[0];
if (!repoArg || !repoArg.includes("/")) {
  console.error("Usage: pnpm index:repo -- owner/repo [--gh-token ghp_xxx]");
  process.exit(1);
}

const [owner, ...repoParts] = repoArg.split("/");
const repo = repoParts.join("/");
const baseUrl = (values["base-url"] as string).replace(/\/$/, "");
const timeoutMs = parseInt(values.timeout as string, 10);
// Prefer --gh-token flag, then GITHUB_TOKEN env (loaded from .env.local by Make).
const ghToken = (values["gh-token"] as string | undefined) ?? process.env.GITHUB_TOKEN ?? null;

// ─── Token bootstrap ──────────────────────────────────────────────────────────

/**
 * Fetch the home page to trigger the proxy's HMAC cookie issuance, then
 * extract the sm-token from the Set-Cookie response header.
 * This mirrors what the browser does on every page load.
 */
const fetchSmToken = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${baseUrl}/`, {
      headers: {
        "User-Agent": "StarMapper-indexer/1.0 (script; starmapper.bruniaux.com)",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = setCookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  process.stdout.write("Bootstrapping session token... ");
  const smToken = await fetchSmToken();
  if (smToken) {
    console.log("ok");
  } else {
    console.log("not available (local dev without SM_TOKEN_SECRET is fine)");
  }

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "StarMapper-indexer/1.0 (script; starmapper.bruniaux.com)",
  };
  if (smToken) baseHeaders["Cookie"] = `${COOKIE_NAME}=${smToken}`;
  if (ghToken) {
    baseHeaders["x-gh-token"] = ghToken;
    console.log("Using personal GitHub token (dedicated quota).");
  } else {
    console.log("No GitHub token — using shared server quota (slower, more rate limits).");
  }

  const infoRes = await fetch(
    `${baseUrl}/api/repo-info?owner=${owner}&repo=${repo}`,
    { headers: baseHeaders },
  );
  if (!infoRes.ok) {
    console.error(`repo-info failed: ${infoRes.status} ${infoRes.statusText}`);
    process.exit(1);
  }
  const info = (await infoRes.json()) as { stars?: number; name?: string };
  const stars = info.stars ?? 0;
  const repoName = info.name ?? `${owner}/${repo}`;

  const chunks = Math.ceil(stars / 100);
  const worstMin = Math.ceil((stars * 1.1) / 60);
  const bestMin = Math.ceil((chunks * 3) / 60);

  console.log(`Repo: ${repoName} | ${stars} stars`);
  console.log(
    `Estimate: ~${bestMin}min best (warm cache) / ~${worstMin}min worst (cold Nominatim)`,
  );
  console.log(`Target: ${baseUrl}\n`);

  let cursor: string | null = null;
  let mapped = 0;
  let unmapped = 0;
  let chunkNum = 0;
  let total = stars;
  let currentToken = smToken;
  const allPoints: unknown[] = [];
  const allUnmapped: unknown[] = [];

  while (true) {
    chunkNum++;

    // Refresh the HMAC token every REFRESH_EVERY chunks to stay within the 2h TTL.
    if (chunkNum % REFRESH_EVERY === 0 && currentToken) {
      const fresh = await fetchSmToken();
      if (fresh) {
        currentToken = fresh;
        baseHeaders["Cookie"] = `${COOKIE_NAME}=${fresh}`;
      }
    }

    const body: Record<string, string> = { owner, repo };
    if (cursor) body.cursor = cursor;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/chunk`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nChunk ${chunkNum} failed: ${msg}`);
      break;
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 429) {
      const data = (await resp.json().catch(() => ({}))) as { error?: string; resetAt?: number };
      if (data.resetAt) {
        const waitMs = Math.max(10_000, data.resetAt - Date.now());
        const waitSec = Math.ceil(waitMs / 1000);
        const resetAt = new Date(data.resetAt).toLocaleTimeString();
        process.stdout.write(
          `\nRate limited. Waiting ${waitSec}s (until ${resetAt})...\n`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        chunkNum--;
        continue;
      }
      // StarMapper's own sliding-window rate limit (30 req/60s) — no resetAt.
      // Wait 65s (full window + margin) and retry the same chunk.
      const retryMs = 65_000;
      process.stdout.write(
        `\nChunk ${chunkNum} rate limited (server). Waiting ${Math.ceil(retryMs / 1000)}s...\n`,
      );
      await new Promise((r) => setTimeout(r, retryMs));
      chunkNum--;
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`\nChunk ${chunkNum} HTTP ${resp.status}: ${text}`);
      break;
    }

    const data = (await resp.json()) as {
      points?: unknown[];
      unmapped?: unknown[];
      nextCursor?: string | null;
      totalCount?: number;
      error?: string;
    };

    if (data.error) {
      console.error(`\nChunk ${chunkNum} error: ${data.error}`);
      break;
    }

    const pts = data.points?.length ?? 0;
    const unm = data.unmapped?.length ?? 0;
    if (Array.isArray(data.points)) allPoints.push(...data.points);
    if (Array.isArray(data.unmapped)) allUnmapped.push(...data.unmapped);
    cursor = data.nextCursor ?? null;
    total = data.totalCount ?? total;

    mapped += pts;
    unmapped += unm;
    const processed = mapped + unmapped;

    process.stdout.write(
      `  Chunk ${String(chunkNum).padEnd(4)} | +${String(pts).padEnd(3)} mapped | +${String(unm).padEnd(3)} unmapped | ${processed}/${total}\n`,
    );

    if (!cursor) break;
  }

  const pct =
    mapped + unmapped > 0 ? Math.round((mapped * 100) / (mapped + unmapped)) : 0;

  console.log(`\nDone: ${owner}/${repo}`);
  console.log(`  Stars total : ${total}`);
  console.log(`  Mapped      : ${mapped} (${pct}%)`);
  console.log(`  Unmapped    : ${unmapped}`);
  console.log(`  Chunks run  : ${chunkNum}`);
  console.log(`  URL         : ${baseUrl}/${owner}/${repo}`);

  // Write StargazerCache only when the loop completed (cursor === null = full scan).
  if (!cursor && allPoints.length + allUnmapped.length > 0) {
    process.stdout.write("\nSaving StargazerCache... ");
    try {
      const pointsGz   = gzipSync(JSON.stringify(allPoints)).toString("base64");
      const unmappedGz = gzipSync(JSON.stringify(allUnmapped)).toString("base64");

      // Prefer the admin endpoint (CRON_SECRET auth, no browser cookie needed).
      // Falls back to the public endpoint when CRON_SECRET is not available.
      const cronSecret = process.env.CRON_SECRET;
      const [cacheUrl, cacheAuthHeaders] = cronSecret
        ? [
            `${baseUrl}/api/admin/stargazer-cache`,
            { Authorization: `Bearer ${cronSecret}` },
          ]
        : [
            `${baseUrl}/api/stargazer-cache`,
            {} as Record<string, string>,
          ];

      const cacheBody = cronSecret
        ? { owner, repo, totalCount: total, pointsGz, unmappedGz }
        : { owner, repo, totalCount: total, ts: Date.now(), pointsGz, unmappedGz };

      const cacheRes = await fetch(cacheUrl, {
        method: "POST",
        headers: { ...baseHeaders, ...cacheAuthHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(cacheBody),
      });

      if (cacheRes.ok) {
        console.log("saved.");
        console.log(`  → ${baseUrl}/${owner}/${repo} now loads from cache instantly.`);
      } else {
        const err = await cacheRes.text().catch(() => "");
        console.log(`failed (${cacheRes.status}): ${err}`);
        console.log(`  → Visit the URL in a browser as fallback.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`error: ${msg}`);
      console.log(`  → Visit the URL in a browser as fallback.`);
    }
  } else if (cursor) {
    console.log(`\nLoop ended early (cursor still active) — StargazerCache not written.`);
    console.log(`  → Visit the URL in a browser to complete.`);
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
