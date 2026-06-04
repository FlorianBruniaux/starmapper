// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * index-followers.ts
 *
 * Drives the StarMapper followers-chunk loop against a target API to pre-warm
 * the geocache for a GitHub user's followers. No DB access — pure HTTP calls.
 *
 * Usage:
 *   pnpm index:followers -- FlorianBruniaux
 *   pnpm index:followers:local -- FlorianBruniaux
 *   make index-followers LOGIN=FlorianBruniaux
 *
 * Flags:
 *   --base-url <url>   API base URL (default: https://starmapper.bruniaux.com)
 *   --timeout <ms>     Per-chunk request timeout in ms (default: 30000)
 *   --gh-token <token> GitHub PAT (read:user scope) — uses own quota instead of shared
 */

import { parseArgs } from "node:util";

const COOKIE_NAME = "sm-token";
const REFRESH_EVERY = 200;

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

const login = positionals[0];
if (!login) {
  console.error("Usage: pnpm index:followers -- <github-login> [--gh-token ghp_xxx]");
  process.exit(1);
}

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

  console.log(`Login: ${login}`);
  console.log(`Target: ${baseUrl}\n`);

  let cursor: string | null = null;
  let mapped = 0;
  let unmapped = 0;
  let chunkNum = 0;
  let total = 0;
  let currentToken = smToken;

  while (true) {
    chunkNum++;

    if (chunkNum % REFRESH_EVERY === 0 && currentToken) {
      const fresh = await fetchSmToken();
      if (fresh) {
        currentToken = fresh;
        baseHeaders["Cookie"] = `${COOKIE_NAME}=${fresh}`;
      }
    }

    const body: Record<string, string> = { login };
    if (cursor) body.cursor = cursor;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/api/followers-chunk`, {
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
        process.stdout.write(`\nRate limited. Waiting ${waitSec}s (until ${resetAt})...\n`);
        await new Promise((r) => setTimeout(r, waitMs));
        chunkNum--;
        continue;
      }
      console.error(`\nChunk ${chunkNum} HTTP 429`);
      break;
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

  const pct = mapped + unmapped > 0 ? Math.round((mapped * 100) / (mapped + unmapped)) : 0;

  console.log(`\nDone: @${login}`);
  console.log(`  Followers total : ${total}`);
  console.log(`  Mapped          : ${mapped} (${pct}%)`);
  console.log(`  Unmapped        : ${unmapped}`);
  console.log(`  Chunks run      : ${chunkNum}`);
  console.log(`  URL             : ${baseUrl}/${login}/followers`);
  console.log(`\nGeocache is now warm. Visit the URL above in a browser to explore the map.`);
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
