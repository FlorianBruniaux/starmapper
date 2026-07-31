// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { type NextRequest, NextResponse } from "next/server";
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { generateToken, verifyToken, getSmSecrets, COOKIE_NAME, TOKEN_TTL_MS } from "@/lib/api-token";
import { getIP } from "@/lib/api-helpers";
import { UPSTASH_CLIENT_CONFIG } from "@/lib/upstash-resilience";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type Tier =
  | "strict-get"
  | "stargazer-cache-get"
  | "moderate-get"
  | "admin"
  | "post"
  | "public"
  | "mcp-github";

const redis = Redis.fromEnv(UPSTASH_CLIENT_CONFIG);

// Every limiter prefix registered so far, in construction order. Populated by makeLimiter
// as a side effect — see __TEST_ONLY__ at the bottom of this file for why this exists:
// two limiters sharing a prefix with different window sizes silently corrupt each other's
// counters (the exact HI-1 bug), and this is what a uniqueness test checks against.
const registeredPrefixes: string[] = [];

const makeLimiter = (prefix: string, tokens: number, window: Duration): Ratelimit => {
  registeredPrefixes.push(prefix);
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix });
};

// POST/DELETE route limiters — array supports dynamic path matching (regex)
// This replaces the old Record<string, Ratelimit> which only handled exact-match paths.
// Dynamic routes like /api/news/item/[id] or /api/organic-score/[o]/[r]/refresh
// could never match an exact-match record and were silently classified "exempt".
// failClosed defaults to true (Redis down → 503) except for fire-and-forget
// analytics routes, which stay available even when Redis is degraded.
type PostRoute = { match: (p: string) => boolean; limiter: Ratelimit; failClosed?: boolean };

// Redis command budget: chunk/followers-chunk/contributors-chunk/track used to run a
// second, route-local IP limiter on top of the check here — same axis (per-IP), same
// prefix in most cases — doubling the Upstash command cost of the app's highest-traffic
// endpoints for no extra protection. Removed in favor of a single check here (2026-07-27,
// Upstash Free Tier 500k/month exhausted ~16h straight). Per-PAT limiters (different key
// axis) still live in the route files.

const POST_ROUTES: PostRoute[] = [
  // Existing write endpoints (exact match)
  // Limits below match what each route enforced on its own before that check moved
  // here — see "Redis command budget" note below.
  { match: (p) => p === "/api/chunk",              limiter: makeLimiter("rl:chunk", 30, "60 s") },
  { match: (p) => p === "/api/followers-chunk",    limiter: makeLimiter("rl:followers-chunk", 30, "60 s") },
  { match: (p) => p === "/api/contributors-chunk", limiter: makeLimiter("rl:contributors-chunk", 30, "60 s") },
  { match: (p) => p === "/api/badge-update",    limiter: makeLimiter("rl:badge-update", 20, "60 s") },
  { match: (p) => p === "/api/stargazer-cache", limiter: makeLimiter("rl:stargazer-cache", 10, "60 s") },
  { match: (p) => p === "/api/user-details",    limiter: makeLimiter("rl:user-details", 30, "60 s") },

  // News endpoints (PAT-protected, but still rate-limited as defence-in-depth)
  { match: (p) => p === "/api/news",                  limiter: makeLimiter("rl:news-publish", 10, "60 m") },
  { match: (p) => /^\/api\/news\/item\/\d+$/.test(p), limiter: makeLimiter("rl:news-delete", 20, "60 m") },

  // Analytics fire-and-forget — generous limits, just preventing raw DoS.
  // failClosed: false — a Redis blip must not turn into a 503 for a tracking beacon
  // the client already discards on failure; nothing downstream depends on it succeeding.
  { match: (p) => p === "/api/track",   limiter: makeLimiter("rl:track", 60, "60 s"), failClosed: false },
  { match: (p) => p === "/api/vitals",  limiter: makeLimiter("rl:vitals", 60, "60 s"), failClosed: false },

  // Nominatim DoS vector — strict limit (each call triggers a geocoder re-request)
  { match: (p) => p === "/api/recalculate-location", limiter: makeLimiter("rl:recalc-loc", 10, "60 s") },

  // User profile refresh — route has its own 1h internal cooldown, rate limit adds defence-in-depth
  { match: (p) => /^\/api\/profile\/[^/]+\/refresh$/.test(p), limiter: makeLimiter("rl:profile-refresh", 10, "60 m") },

  // Organic score refresh — 3 GitHub API calls per invocation, route has 1h internal cooldown
  { match: (p) => /^\/api\/organic-score\/[^/]+\/[^/]+\/refresh$/.test(p), limiter: makeLimiter("rl:organic-refresh", 10, "60 m") },

  // Dependents refresh — same shape as profile/organic-score refresh, 1h internal cooldown
  { match: (p) => /^\/api\/dependents\/[^/]+\/[^/]+\/refresh$/.test(p), limiter: makeLimiter("rl:dependents-refresh", 10, "60 m") },

  // Contributors badge update — same shape as badge-update (end-of-scan write, not PII)
  { match: (p) => p === "/api/contributors-badge-update", limiter: makeLimiter("rl:contributors-badge-update", 20, "60 s") },

  // Follower cache write — same shape as stargazer-cache
  { match: (p) => p === "/api/follower-cache", limiter: makeLimiter("rl:follower-cache", 10, "60 s") },

  // Roadmap vote — single-row upsert, same budget as follower-cache. Anti-abuse is the
  // upsert-by-ipHash shape itself (src/lib/ip-hash.ts), this limiter is DoS/DB-load
  // protection only, not fraud prevention.
  { match: (p) => p === "/api/roadmap-vote", limiter: makeLimiter("rl:roadmap-vote", 10, "60 s") },
];

// Fallback rate limiter for POST routes not registered in POST_ROUTES.
// Applied after origin + HMAC checks — ensures every mutating request has a rate limit.
const DEFAULT_POST_LIMITER = makeLimiter("rl:post-default", 5, "60 s");

// Tier limiters for GET routes
const TIER_LIMITERS: Record<
  "strict-get" | "stargazer-cache-get" | "moderate-get" | "admin" | "public" | "mcp-github-anon",
  Ratelimit
> = {
  "strict-get":          makeLimiter("rl:strict-get", 30, "60 s"),
  // Shared by every bulk per-user dump (stargazer-cache, reconstruct, engaged). The key is
  // `${ip}:${routeKey}`, so each route still gets its own 3/60s bucket, not a shared one.
  "stargazer-cache-get": makeLimiter("rl:stargazer-cache-get", 3, "60 s"),
  "moderate-get":        makeLimiter("rl:moderate-get", 60, "60 s"),
  "admin":               makeLimiter("rl:admin", 10, "60 s"),
  // Public embeds (badge/map-image/geo) — generous, per-IP only. Legitimate traffic is many
  // distinct IPs viewing the same README, so this only bites an IP hammering one endpoint.
  "public":              makeLimiter("rl:public", 120, "60 s"),
  // MCP routes with no x-gh-token (falls back to the shared server GITHUB_TOKEN) — tight,
  // since every hit spends from the same 5000/hr budget every other feature shares.
  "mcp-github-anon":     makeLimiter("rl:mcp-github-anon", 10, "60 s"),
};

// Every literal (non-dynamic) path segment used anywhere under src/app/api. Generated by
// listing the route tree; regenerate this set if new route folders are added. Any segment
// NOT in this list is a dynamic param value ([owner], [repo], [login], [language], [country],
// [id]) and gets collapsed to "*" — see routeKey below for why this matters.
const STATIC_ROUTE_SEGMENTS = new Set([
  "api", "admin", "atlas", "autocomplete", "badge", "badge-update", "cache-status", "chunk",
  "cleanup", "clear-geocache", "companies", "contributors", "contributors-badge-update",
  "contributors-chunk", "country-stats", "daily-digest", "delete-user", "dependencies",
  "dependents", "devs", "engaged", "explore", "feed", "follower-cache", "followers-chunk", "geo",
  "geo-velocity", "geocode", "global-map", "growth", "import-geocache", "in", "influential",
  "item", "json", "locations", "map", "map-image", "mcp", "nearby", "news", "organic-score",
  "organic-score-stats", "points", "power", "profile", "recalculate-location", "reconstruct",
  "refresh", "refresh-grid-mv", "refresh-repo-stats", "refresh-trending", "repo-info", "repos",
  "roadmap-vote", "rss", "stargazer-cache", "stats", "top", "top-users", "track", "trending",
  "user-details", "user-repos", "users", "vitals", "watch",
]);

// Collapses a concrete pathname to a bounded route template before it's used as part of
// a rate-limit key. Without this, `${ip}:${pathname}` on dynamic routes (/api/profile/[login],
// /api/stats/[owner]/[repo]/...) creates one Redis key per distinct login/repo an IP has ever
// visited — unbounded key growth, and worse, it defeats the limiter's own intent: an IP can
// dodge its 30/60s strict-get quota forever just by varying which profile/repo it requests.
const routeKey = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) => (segment === "" || STATIC_ROUTE_SEGMENTS.has(segment) ? segment : "*"))
    .join("/");

// SM_TOKEN_SECRET: when set, enables HMAC token validation on strict-get and POST endpoints.
// When unset (local dev without env), falls back to Referer check + rate limit only.
const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";
// Verification accepts SM_TOKEN_SECRET_PREV too (rotation) — signing always uses SM_SECRET only.
const SM_SECRETS = getSmSecrets();

if (!SM_SECRET && process.env.NODE_ENV === "production") {
  console.warn("[proxy] SM_TOKEN_SECRET not set in production — HMAC session protection is disabled, falling back to Referer-only checks");
}

const isDev = process.env.NODE_ENV === "development";

// Build a per-request CSP with a unique nonce.
// script-src: nonce-based — eliminates 'unsafe-inline' entirely for scripts.
// style-src split into CSP Level 3 directives:
//   style-src-elem: nonce-required for <style> blocks (blocks arbitrary CSS injection)
//   style-src-attr: 'unsafe-inline' scoped to element style="" attributes only
// style-src itself is absent — the broad 'unsafe-inline' for all style sources is gone.
const buildCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    // Hash covers Next.js's static perf-measurement script injected before the nonce is known:
    // requestAnimationFrame(function(){$RT=performance.now()});
    // Verify hash after Next.js major version bumps.
    `script-src 'self' 'nonce-${nonce}' 'sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='${isDev ? " 'unsafe-eval'" : ""}`,
    "worker-src blob:",
    // <style> elements: only nonce-tagged blocks and self-hosted sheets (no unsafe-inline injection)
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // style="" attributes: unsafe-inline is unavoidable — React dynamic styles (progress bars,
    // computed colors) and MapLibre controls rely on inline style attributes at runtime.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' https://avatars.githubusercontent.com https://github.com data: blob:",
    // geoapify/nominatim removed: both are called server-side only (src/lib/geocoder.ts),
    // the browser never connects to them directly. wss: is a dev-only concession for
    // Turbopack's HMR socket — production has no legitimate WebSocket use.
    `connect-src 'self' https://api.jawg.io https://tile.jawg.io https://*.tile.jawg.io https://api.github.com https://*.tiles.jawg.io${isDev ? " wss:" : ""}`,
    "font-src 'self' data:",
    // Pre-CSP3 fallback: browsers that don't understand style-src-elem/style-src-attr
    // ignore them and fall back to style-src (or default-src if absent), which would
    // otherwise break every inline style in older Safari. CSP3 browsers ignore this
    // line in favor of the granular directives above, so it never widens their policy.
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const appOrigin = (): string => {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  try {
    const { origin } = new URL(url);
    return origin;
  } catch {
    return url;
  }
};

/**
 * Classify a request into a security tier based on method + pathname.
 *
 * Tiers:
 *  - public      : no restrictions (badge/map-image embeds in third-party READMEs)
 *  - exempt      : unlisted POST routes — no current handling
 *  - post        : origin check + per-route rate limit (4 known write endpoints)
 *  - admin       : rate limit only (CLI callers, no referer)
 *  - strict-get  : referer check + rate limit (data-rich PII endpoints)
 *  - moderate-get: rate limit only (aggregate / low-PII endpoints)
 */
const classifyRoute = (method: string, pathname: string): Tier => {
  // Public embeddables — cross-origin by design, no restrictions
  if (
    pathname.startsWith("/api/badge/") ||
    pathname.startsWith("/api/map-image/") ||
    pathname.startsWith("/api/geo/")
  ) {
    return "public";
  }

  // Admin routes — rate limit only (called from CLI/scripts, no referer)
  if (pathname.startsWith("/api/admin/")) return "admin";

  // POST/mutating methods — fail-closed: every unknown route gets the default POST tier
  // (origin check + HMAC + default rate limit) rather than bypassing middleware silently.
  if (method !== "GET" && method !== "HEAD") return "post";

  // Bulk per-user dumps — one request returns login/name/company/location/followers/coords
  // for every user of a repo. /api/reconstruct and /api/engaged serve the same class of data
  // as /api/stargazer-cache and must not sit on a looser tier than it.
  if (
    pathname.startsWith("/api/stargazer-cache/") ||
    pathname.startsWith("/api/reconstruct/") ||
    pathname.startsWith("/api/engaged/")
  ) {
    return "stargazer-cache-get";
  }

  // Strict GET — data-rich endpoints with per-user PII (logins, locations, coordinates)
  // Note: /api/repos is intentionally excluded — it only returns aggregate badge stats,
  // no per-user data. moderate-get (rate limit only) is sufficient.
  // Note: /api/stats/[owner]/[repo] (without /top-users suffix) serves only aggregate data
  // (country counts, companies, mapping rate) — no individual profiles. moderate-get is fine.
  if (
    pathname.match(/^\/api\/stats\/[^/]+\/[^/]+\/top-users$/) ||
    pathname === "/api/explore/top" ||
    pathname === "/api/explore/power" ||
    pathname === "/api/explore/user-repos" ||
    pathname === "/api/explore/global-map" ||
    pathname === "/api/explore/autocomplete" ||
    pathname === "/api/explore/geocode" ||
    pathname.startsWith("/api/profile/") ||
    // Burns the shared server GITHUB_TOKEN on every hit (no PAT requirement of its own) —
    // strict-get requires the sm-token session cookie + Referer, closing anonymous access.
    pathname.match(/^\/api\/watch\/[^/]+\/[^/]+$/)
  ) {
    return "strict-get";
  }

  // Requires an x-gh-token to avoid burning the shared server GITHUB_TOKEN on GraphQL calls —
  // anonymous callers (no PAT) get a much tighter budget via mcpAnonymousLimit().
  if (
    pathname.match(/^\/api\/mcp\/contributors\/[^/]+\/[^/]+$/) ||
    pathname.match(/^\/api\/mcp\/dependencies\/[^/]+\/[^/]+$/) ||
    pathname.match(/^\/api\/mcp\/followers\/[^/]+$/)
  ) {
    return "mcp-github";
  }

  // Everything else: moderate GET
  return "moderate-get";
};

// In-process, per-instance cache of buckets that were just rejected. A fully-rejected
// burst hitting this instance repeatedly would otherwise spend one Upstash command per
// request even though the outcome (429) is already known — this makes that cost near-zero
// by answering from memory for the next few seconds instead of round-tripping to Redis.
// Bounded to avoid unbounded memory growth under a many-identifier attack; capped TTL means
// worst case is one extra Redis round trip every SHORT_CIRCUIT_TTL_MS even under sustained load.
const SHORT_CIRCUIT_MAX_ENTRIES = 5000;
const SHORT_CIRCUIT_TTL_MS = 10_000;
const recentlyRejected = new Map<string, number>();

/**
 * Distributed sliding-window rate limiter via Upstash Redis.
 * failClosed=true (POST routes): Redis down → 503, never silently open.
 * failClosed=false (GET routes): Redis down → pass through, preserve availability.
 * bucket defaults to `ip` — pass an explicit value when several distinct limiters share
 * the same identifier (e.g. POST_ROUTES all key by bare IP), so short-circuiting one
 * route's burst doesn't bleed into another route's quota.
 */
const rateLimit = async (
  limiter: Ratelimit,
  ip: string,
  failClosed = false,
  bucket: string = ip,
): Promise<NextResponse | null> => {
  const now = Date.now();
  const until = recentlyRejected.get(bucket);
  if (until !== undefined) {
    if (until > now) {
      return NextResponse.json(
        { error: "rate_limit" },
        { status: 429, headers: { "Retry-After": String(Math.ceil((until - now) / 1000)) } },
      );
    }
    recentlyRejected.delete(bucket);
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(ip);
    if (!success) {
      const retryAfter = Math.ceil((reset - now) / 1000);
      if (recentlyRejected.size >= SHORT_CIRCUIT_MAX_ENTRIES) {
        const oldestKey = recentlyRejected.keys().next().value;
        if (oldestKey !== undefined) recentlyRejected.delete(oldestKey);
      }
      recentlyRejected.set(bucket, now + Math.min(reset - now, SHORT_CIRCUIT_TTL_MS));
      return NextResponse.json(
        { error: "rate_limit" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(remaining),
          },
        },
      );
    }
  } catch (err) {
    console.warn(`[rl] Upstash error ip=${ip}: ${err instanceof Error ? err.message : String(err)}`);
    if (failClosed) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }
  }
  return null;
};

/**
 * Referer check for strict-GET endpoints.
 * Browsers always send Referer on same-origin requests when the page uses
 * strict-origin-when-cross-origin policy (set in next.config.ts headers).
 * Absent or mismatched Referer → the request is not coming from our frontend.
 */
const checkReferer = (req: NextRequest): boolean => {
  const referer = req.headers.get("referer");
  if (!referer) return false;
  try {
    const refUrl = new URL(referer);
    if (refUrl.hostname === "localhost" || refUrl.hostname === "127.0.0.1") return true;
    const allowed = appOrigin();
    return Boolean(allowed && refUrl.origin === allowed);
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/**
 * Add CORS headers to a response.
 *  - Public endpoints (badge, map-image): Allow all origins — they're embedded in third-party READMEs.
 *  - All other API endpoints: Restrict to the app origin only.
 */
const withCors = (res: NextResponse, isPublic: boolean): NextResponse => {
  const origin = isPublic ? "*" : (appOrigin() || "");
  if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gh-token, x-admin-secret");
  if (!isPublic) res.headers.set("Access-Control-Max-Age", "86400");
  return res;
};

export const proxy = async (req: NextRequest): Promise<NextResponse> => {
  const { pathname } = req.nextUrl;
  const method = req.method;

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (method === "OPTIONS" && pathname.startsWith("/api/")) {
    const isPublic =
      pathname.startsWith("/api/badge/") ||
      pathname.startsWith("/api/map-image/") ||
      pathname.startsWith("/api/geo/");
    return withCors(new NextResponse(null, { status: 204 }), isPublic);
  }

  // ── Non-API page requests: nonce + CSP + HMAC session cookie ────────────
  // Per-request nonce replaces 'unsafe-inline' in script-src (CSP hardening).
  // The HMAC cookie is HttpOnly + SameSite=Strict — auto-sent with same-origin
  // fetch() calls, enabling token validation on strict-get and POST routes.
  if (!pathname.startsWith("/api/")) {
    const nonce = btoa(crypto.randomUUID());
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set("x-nonce", nonce);
    const res = NextResponse.next({ request: { headers: reqHeaders } });
    res.headers.set("Content-Security-Policy", buildCsp(nonce));

    if (SM_SECRET) {
      const existing = req.cookies.get(COOKIE_NAME)?.value;
      const valid = existing ? await verifyToken(existing, SM_SECRETS) : false;
      if (!valid) {
        res.cookies.set(COOKIE_NAME, await generateToken(SM_SECRET), {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          maxAge: TOKEN_TTL_MS / 1000,
          path: "/",
        });
      }
    }
    return res;
  }

  const tier = classifyRoute(method, pathname);
  const ip = getIP(req);

  // ── Public: badge/map-image/geo embeds — no session/referer check (embedded
  // in third-party READMEs), just a generous per-IP ceiling against single-IP abuse ──
  if (tier === "public") {
    const blocked = await rateLimit(TIER_LIMITERS["public"], ip);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), true);
  }

  // ── MCP routes without a client PAT: fall back to the shared server GITHUB_TOKEN,
  // so anonymous callers get a much tighter budget than PAT-bearing ones ─────────
  if (tier === "mcp-github") {
    if (!req.headers.get("x-gh-token")) {
      const blocked = await rateLimit(TIER_LIMITERS["mcp-github-anon"], `${ip}:${routeKey(pathname)}`);
      if (blocked) return blocked;
    } else {
      const blocked = await rateLimit(TIER_LIMITERS["moderate-get"], `${ip}:${routeKey(pathname)}`);
      if (blocked) return blocked;
    }
    return withCors(NextResponse.next(), false);
  }

  // ── POST routes: origin check + HMAC cookie + fail-closed rate limit ────
  if (tier === "post") {
    const origin = req.headers.get("origin");
    if (origin) {
      const allowed = appOrigin();
      const isLocalhost =
        origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
      if (!isLocalhost && (!allowed || origin !== allowed)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    // HMAC session cookie — blocks server-side/curl calls when SM_TOKEN_SECRET is set.
    // Browser fetch() automatically sends the HttpOnly cookie issued on page load.
    if (SM_SECRET) {
      const token = req.cookies.get(COOKIE_NAME)?.value;
      if (!await verifyToken(token, SM_SECRETS)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    const route = POST_ROUTES.find((r) => r.match(pathname));
    const postLimiter = route?.limiter ?? DEFAULT_POST_LIMITER;
    // Per-route failClosed (default true) — see the "Analytics fire-and-forget" routes above
    // for the one deliberate exception. Unregistered routes fail closed like everything else.
    const blocked = await rateLimit(postLimiter, ip, route?.failClosed ?? true, `post:${routeKey(pathname)}:${ip}`);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), false);
  }

  // ── Admin routes: rate limit only ─────────────────────────────────────────
  if (tier === "admin") {
    const blocked = await rateLimit(TIER_LIMITERS["admin"], ip);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), false);
  }

  // ── Stargazer-cache GET: same checks as strict-get, tighter rate limit ───
  if (tier === "stargazer-cache-get") {
    if (SM_SECRET) {
      const token = req.cookies.get(COOKIE_NAME)?.value;
      if (!await verifyToken(token, SM_SECRETS)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    if (!checkReferer(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Per-endpoint key: prevents a single endpoint from exhausting the shared tier quota.
    const blocked = await rateLimit(TIER_LIMITERS["stargazer-cache-get"], `${ip}:${routeKey(pathname)}`);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), false);
  }

  // ── Strict GET: token check + referer check + rate limit ─────────────────
  if (tier === "strict-get") {
    // HMAC token — only enforced when SM_TOKEN_SECRET is configured.
    // Token is set as HttpOnly cookie on every page load, auto-sent by the browser.
    // An attacker without a server-issued token gets 403 even with a forged Referer.
    if (SM_SECRET) {
      const token = req.cookies.get(COOKIE_NAME)?.value;
      if (!await verifyToken(token, SM_SECRETS)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    // Referer check — defense-in-depth even when token is valid
    if (!checkReferer(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    // Per-endpoint key: each strict-get route gets its own 30/min quota per IP.
    const blocked = await rateLimit(TIER_LIMITERS["strict-get"], `${ip}:${routeKey(pathname)}`);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), false);
  }

  // ── Moderate GET: rate limit only ─────────────────────────────────────────
  // Per-endpoint key: browsing multiple pages doesn't exhaust a shared quota.
  const blocked = await rateLimit(TIER_LIMITERS["moderate-get"], `${ip}:${routeKey(pathname)}`);
  if (blocked) return blocked;
  return withCors(NextResponse.next(), false);
};

export const config = {
  matcher: [
    // All routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};

// Test-only surface — not used by the runtime. Exported so proxy.test.ts can pin the
// invariants that matter here (distinct limiter prefixes, routeKey bounding, CSP shape)
// without duplicating the module's internal tables by hand.
export const __TEST_ONLY__ = {
  registeredPrefixes,
  routeKey,
  classifyRoute,
  buildCsp,
};
