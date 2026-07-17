// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * github-token-pool.ts
 *
 * Shared multi-token rotation for GitHub REST backfills. Reads GITHUB_TOKEN,
 * GITHUB_TOKEN_2, GITHUB_TOKEN_3… from the environment (sourced from .env.local
 * by the Makefile) and always hands out the token with the most remaining
 * capacity. When every token is spent, it waits for the earliest reset.
 *
 * With N tokens the effective ceiling is N × 5000 REST req/hr. The badge_cache
 * backfills (2553 repos × 2 calls ≈ 5106 req) fit in a single run on 4 tokens
 * (~1277 req/token) instead of blowing the 5000/hr limit on token #1.
 *
 * Usage:
 *   const pool = buildTokenPool();
 *   const tok = await acquireToken(pool);
 *   const res = await fetch(url, { headers: makeHeaders(tok) });
 *   syncTokenFromHeaders(tok, res);
 *   if (res.status === 403 || res.status === 429) tok.remaining = 0; // park + rotate
 */

export type TokenState = {
  token: string;
  remaining: number;
  resetAt: number; // unix seconds (from x-ratelimit-reset)
  callCount: number;
};

/**
 * Build the token pool from the environment.
 * @param tokenIndex 1-based index to force a single token; 0 (default) = use all.
 */
export const buildTokenPool = (tokenIndex = 0): TokenState[] => {
  const all: string[] = [];
  const base = process.env.GITHUB_TOKEN;
  if (base) all.push(base);
  let i = 2;
  while (true) {
    const t = process.env[`GITHUB_TOKEN_${i}`];
    if (!t) break;
    all.push(t);
    i++;
  }
  const tokens = tokenIndex > 0 ? all.slice(tokenIndex - 1, tokenIndex) : all;
  if (tokens.length === 0) {
    console.warn("Warning: no GITHUB_TOKEN set — limited to 60 req/hr");
  }
  return tokens.map((token) => ({ token, remaining: 5000, resetAt: 0, callCount: 0 }));
};

const getBestToken = (pool: TokenState[]): TokenState =>
  pool.reduce((best, t) => (t.remaining > best.remaining ? t : best), pool[0]);

/**
 * Return the token with the most remaining capacity. If every token is spent
 * (remaining ≤ 5), wait for the earliest reset then hand it back refreshed.
 * Decrements optimistically so concurrent callers spread across tokens before
 * the response headers land. Throws if the pool is empty.
 */
export const acquireToken = async (pool: TokenState[]): Promise<TokenState> => {
  if (pool.length === 0) throw new Error("Token pool is empty — set GITHUB_TOKEN");

  const best = getBestToken(pool);
  if (best.remaining > 5) {
    best.remaining -= 1; // optimistic; syncTokenFromHeaders overwrites with the real value
    return best;
  }

  const earliest = pool.reduce((min, t) => (t.resetAt < min.resetAt ? t : min), pool[0]);
  const waitMs = Math.max(0, earliest.resetAt * 1000 - Date.now()) + 3000;
  const mins = Math.round(waitMs / 60000);
  console.warn(
    `  [token-pool] All ${pool.length} token(s) exhausted — waiting ${mins}m for ${earliest.token.slice(0, 8)}… to reset`,
  );
  await new Promise<void>((r) => setTimeout(r, waitMs));
  earliest.remaining = 5000;
  earliest.resetAt = 0;
  return earliest;
};

/**
 * Standard GitHub REST headers for a given token. Pass `extra` to override or
 * add fields (e.g. a legacy Accept media type).
 */
export const makeHeaders = (
  tok: TokenState,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "starmapper-backfill/1.0",
  Authorization: `Bearer ${tok.token}`,
  ...extra,
});

/**
 * Sync a token's remaining/resetAt from a GitHub response's rate-limit headers.
 * Call after every fetch so getBestToken rotates on real capacity, not the
 * optimistic estimate.
 */
export const syncTokenFromHeaders = (tok: TokenState, res: Response): void => {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (remaining !== null) tok.remaining = Number(remaining);
  if (reset !== null) tok.resetAt = Number(reset);
  tok.callCount++;
};
