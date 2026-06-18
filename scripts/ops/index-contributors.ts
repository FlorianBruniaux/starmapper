// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * index-contributors.ts
 *
 * Drives the StarMapper contributors-chunk loop against a target API to
 * pre-warm the geocache for a repo's contributors. No DB access — pure HTTP.
 *
 * Usage:
 *   pnpm index:contributors -- torvalds/linux
 *   pnpm index:contributors:local -- owner/repo
 *   make index-contributors REPO=owner/repo
 *
 * Flags:
 *   --base-url <url>   API base URL (default: https://starmapper.bruniaux.com)
 *   --timeout <ms>     Per-chunk request timeout in ms (default: 30000)
 *   --gh-token <token> GitHub PAT — uses own quota instead of shared
 */

import { parseArgs } from "node:util";

const COOKIE_NAME = "sm-token";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    "base-url": { type: "string", default: "https://starmapper.bruniaux.com" },
    timeout: { type: "string", default: "30000" },
    "gh-token": { type: "string" },
  },
  strict: false,
  args: process.argv.slice(2),
  allowPositionals: true,
});

const repoArg = positionals[0];
if (!repoArg || !repoArg.includes("/")) {
  console.error("Usage: pnpm index:contributors -- <owner/repo> [--gh-token ghp_xxx]");
  process.exit(1);
}

const [owner, repo] = repoArg.split("/") as [string, string];
const baseUrl = (values["base-url"] as string).replace(/\/$/, "");
const timeoutMs = parseInt(values.timeout as string, 10);
const ghToken = (values["gh-token"] as string | undefined) ?? process.env.GITHUB_TOKEN ?? null;

// ─── Token bootstrap ──────────────────────────────────────────────────────────

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
  console.log(smToken ? "ok" : "not available (local dev without SM_TOKEN_SECRET is fine)");

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

  console.log(`Repo: ${owner}/${repo}`);
  console.log(`Target: ${baseUrl}\n`);

  let page = 1;
  let mapped = 0;
  let unmapped = 0;
  let total = 0;
  let computingRetries = 0;
  const MAX_COMPUTING_RETRIES = 6; // 30s each = 3 minutes max wait

  while (page <= 5) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/contributors-chunk`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ owner, repo, page }),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nPage ${page} request failed: ${msg}`);
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
        process.stdout.write(`\nRate limited. Waiting ${waitSec}s (until ${resetAt})...\n`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue; // retry same page
      }
      console.error(`\nPage ${page} HTTP 429`);
      break;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`\nPage ${page} HTTP ${resp.status}: ${text}`);
      break;
    }

    const data = (await resp.json()) as {
      points?: unknown[];
      unmapped?: unknown[];
      nextPage?: number | null;
      totalCount?: number;
      computing?: boolean;
      error?: string;
    };

    if (data.error) {
      console.error(`\nPage ${page} error: ${data.error}`);
      break;
    }

    // GitHub is still computing contributor stats — wait and retry
    if (data.computing) {
      computingRetries++;
      if (computingRetries > MAX_COMPUTING_RETRIES) {
        console.error("\nGitHub still computing after max retries. Try again later.");
        break;
      }
      process.stdout.write(`  GitHub computing stats... retry ${computingRetries}/${MAX_COMPUTING_RETRIES} in 30s\n`);
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    computingRetries = 0;

    const pts = data.points?.length ?? 0;
    const unm = data.unmapped?.length ?? 0;
    const nextPage = data.nextPage ?? null;
    total = data.totalCount ?? total;

    mapped += pts;
    unmapped += unm;
    const processed = mapped + unmapped;

    process.stdout.write(
      `  Page ${String(page).padEnd(2)} | +${String(pts).padEnd(3)} mapped | +${String(unm).padEnd(3)} unmapped | ${processed}/${total}\n`,
    );

    if (nextPage === null) break;
    page = nextPage;
  }

  const pct = mapped + unmapped > 0 ? Math.round((mapped * 100) / (mapped + unmapped)) : 0;

  console.log(`\nDone: ${owner}/${repo}`);
  console.log(`  Contributors total : ${total}`);
  console.log(`  Mapped             : ${mapped} (${pct}%)`);
  console.log(`  Unmapped           : ${unmapped}`);
  console.log(`  URL                : ${baseUrl}/${owner}/${repo}/contributors`);
  console.log(`\nGeocache is now warm. Visit the URL above to explore the map.`);
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
