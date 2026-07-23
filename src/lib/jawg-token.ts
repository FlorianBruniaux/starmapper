// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Server-side Jawg token manager with automatic fallback to a secondary account.
 *
 * Mirrors the client-side behaviour in `src/lib/map-style.ts`: when the primary token
 * returns a quota/auth status, the active slot switches to the fallback token and the
 * request is retried once. State is in-memory per Vercel instance, like the circuit
 * breakers in `geocoder.ts`.
 *
 * Two independent pools, because they bill against different Jawg products:
 * - `geocoding` — `starmapper.jawg.io` search, used by the chunk loop (site indexing)
 * - `places`    — `api.jawg.io` autocomplete + reverse, used by /explore
 */

export type JawgPool = "geocoding" | "places";
type Slot = "1" | "2";

/**
 * How each host expects the token. Verified against the live API on 2026-07-23:
 * `api.jawg.io/places/*` rejects `x-api-key` and `Authorization: Bearer` with
 * HTTP 400 NO_ACCESS_TOKEN_PROVIDED, and only accepts the `access-token` query
 * param. The dedicated `starmapper.jawg.io` host is provisioned with a header token.
 */
type AuthMode = "header" | "query";

/** Statuses that mean "this token is done": unauthorized, payment required, forbidden, rate limited. */
export const JAWG_QUOTA_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 429]);

/**
 * How long a pool stays on the fallback before retrying the primary. Jawg quotas are
 * monthly, but a 1h retry costs one wasted request and recovers automatically after a
 * quota reset or a plan upgrade. Aligned with CIRCUIT_RESET_MS in `geocoder.ts`.
 */
const RETRY_PRIMARY_AFTER_MS = 60 * 60 * 1000;

// Env is read lazily on every call so vi.stubEnv works and Vercel env updates apply
// without a cold start.
const POOL_ENV: Record<JawgPool, { primary: string; fallback: string; auth: AuthMode }> = {
  geocoding: { primary: "JAWG_TOKEN_HEADER", fallback: "JAWG_TOKEN_HEADER_2", auth: "header" },
  places: { primary: "JAWGMAP_ACCESS_TOKEN", fallback: "JAWGMAP_ACCESS_TOKEN_2", auth: "query" },
};

type PoolState = { slot: Slot; switchedAt: number | null };

const state: Record<JawgPool, PoolState> = {
  geocoding: { slot: "1", switchedAt: null },
  places: { slot: "1", switchedAt: null },
};

const readEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

/** Reverts to the primary slot once the retry window has elapsed. */
const expireFallback = (pool: JawgPool): void => {
  const s = state[pool];
  if (s.slot === "2" && s.switchedAt !== null && Date.now() - s.switchedAt >= RETRY_PRIMARY_AFTER_MS) {
    s.slot = "1";
    s.switchedAt = null;
  }
};

/** Slot currently in use — exposed for logging and tests. */
export const getJawgSlot = (pool: JawgPool): Slot => {
  expireFallback(pool);
  return state[pool].slot;
};

/**
 * Token for the pool's active slot, or undefined when nothing is configured.
 * Falls back to the primary when slot 2 is active but its token is missing.
 */
export const getJawgToken = (pool: JawgPool): string | undefined => {
  const env = POOL_ENV[pool];
  if (getJawgSlot(pool) === "2") {
    const fallback = readEnv(env.fallback);
    if (fallback) return fallback;
  }
  return readEnv(env.primary) ?? readEnv(env.fallback);
};

/** True when the pool has at least one usable token. */
export const hasJawgToken = (pool: JawgPool): boolean => getJawgToken(pool) !== undefined;

/**
 * Switches the pool to its fallback token. Returns the new token, or undefined when no
 * fallback is configured or the pool is already on slot 2 (nothing left to try).
 */
export const switchJawgToken = (pool: JawgPool): string | undefined => {
  const s = state[pool];
  if (s.slot === "2") return undefined;
  const fallback = readEnv(POOL_ENV[pool].fallback);
  if (!fallback) return undefined;
  s.slot = "2";
  s.switchedAt = Date.now();
  console.warn(`[jawg] pool "${pool}" switched to fallback token (quota or auth error on primary)`);
  return fallback;
};

/** Resets both pools to their primary slot. Test helper. */
export const resetJawgTokens = (): void => {
  state.geocoding = { slot: "1", switchedAt: null };
  state.places = { slot: "1", switchedAt: null };
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Applies the token using the pool's auth mode, returning the URL and init to send. */
const authenticate = (
  pool: JawgPool,
  url: string,
  init: RequestInit | undefined,
  token: string,
): { url: string; init: RequestInit | undefined } => {
  if (POOL_ENV[pool].auth === "header") {
    return {
      url,
      init: {
        ...init,
        headers: { ...(init?.headers as Record<string, string> | undefined), "x-api-key": token },
      },
    };
  }
  const separator = url.includes("?") ? "&" : "?";
  return { url: `${url}${separator}access-token=${encodeURIComponent(token)}`, init };
};

/**
 * Fetches a Jawg endpoint with the pool's active token. On a quota or auth status,
 * switches to the fallback token and retries once.
 *
 * Returns null when the pool has no token configured — callers treat that as
 * "Jawg unavailable" and move down their own fallback chain.
 *
 * @param fetcher Injected so the geocoder can pass its timeout-wrapped fetch.
 */
export const jawgFetch = async (
  pool: JawgPool,
  url: string,
  init?: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<Response | null> => {
  const token = getJawgToken(pool);
  if (!token) return null;

  const first = authenticate(pool, url, init, token);
  const res = await fetcher(first.url, first.init);
  if (!JAWG_QUOTA_STATUSES.has(res.status)) return res;

  const fallback = switchJawgToken(pool);
  if (!fallback) return res;

  const retry = authenticate(pool, url, init, fallback);
  return fetcher(retry.url, retry.init);
};
