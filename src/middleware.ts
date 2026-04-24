// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { generateToken, verifyToken, COOKIE_NAME, TOKEN_TTL_MS } from "@/lib/api-token";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type Tier = "strict-get" | "stargazer-cache-get" | "moderate-get" | "admin" | "post" | "public" | "exempt";

const redis = Redis.fromEnv();

// POST/DELETE route limiters — array supports dynamic path matching (regex)
// This replaces the old Record<string, Ratelimit> which only handled exact-match paths.
// Dynamic routes like /api/news/item/[id] or /api/organic-score/[o]/[r]/refresh
// could never match an exact-match record and were silently classified "exempt".
type PostRoute = { match: (p: string) => boolean; limiter: Ratelimit };

const POST_ROUTES: PostRoute[] = [
  // Existing write endpoints (exact match)
  { match: (p) => p === "/api/chunk",           limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, "60 s"),  prefix: "rl:chunk" }) },
  { match: (p) => p === "/api/badge-update",    limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  "60 s"),  prefix: "rl:badge-update" }) },
  { match: (p) => p === "/api/stargazer-cache", limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  "60 s"),  prefix: "rl:stargazer-cache" }) },
  { match: (p) => p === "/api/user-details",    limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  "60 s"),  prefix: "rl:user-details" }) },

  // News endpoints (PAT-protected, but still rate-limited as defence-in-depth)
  { match: (p) => p === "/api/news",                         limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  "60 m"), prefix: "rl:news-publish" }) },
  { match: (p) => /^\/api\/news\/item\/\d+$/.test(p),        limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  "60 m"), prefix: "rl:news-delete" }) },

  // Analytics fire-and-forget — generous limits, just preventing raw DoS
  { match: (p) => p === "/api/track",   limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, "60 s"), prefix: "rl:track" }) },
  { match: (p) => p === "/api/vitals",  limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60,  "60 s"), prefix: "rl:vitals" }) },

  // Nominatim DoS vector — strict limit (each call triggers a geocoder re-request)
  { match: (p) => p === "/api/recalculate-location", limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "rl:recalc-loc" }) },

  // User profile refresh — route has its own 1h internal cooldown, rate limit adds defence-in-depth
  { match: (p) => /^\/api\/profile\/[^/]+\/refresh$/.test(p), limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 m"), prefix: "rl:profile-refresh" }) },

  // Organic score refresh — 3 GitHub API calls per invocation, route has 1h internal cooldown
  { match: (p) => /^\/api\/organic-score\/[^/]+\/[^/]+\/refresh$/.test(p), limiter: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 m"), prefix: "rl:organic-refresh" }) },
];

// Tier limiters for GET routes
const TIER_LIMITERS: Record<"strict-get" | "stargazer-cache-get" | "moderate-get" | "admin", Ratelimit> = {
  "strict-get":          new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "60 s"), prefix: "rl:strict-get" }),
  "stargazer-cache-get": new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3,  "60 s"), prefix: "rl:stargazer-cache-get" }),
  "moderate-get":        new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:moderate-get" }),
  "admin":               new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "rl:admin" }),
};

// SM_TOKEN_SECRET: when set, enables HMAC token validation on strict-get endpoints.
// When unset (local dev without env), falls back to Referer check + rate limit only.
const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getIP = (req: NextRequest): string =>
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

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

  // POST/mutating methods
  if (method !== "GET" && method !== "HEAD") {
    if (POST_ROUTES.some((r) => r.match(pathname))) return "post";
    return "exempt";
  }

  // Stargazer-cache GET — returns up to 50k users in one shot, dedicated tight limiter
  if (pathname.startsWith("/api/stargazer-cache/")) return "stargazer-cache-get";

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
    pathname.startsWith("/api/profile/")
  ) {
    return "strict-get";
  }

  // Everything else: moderate GET
  return "moderate-get";
};

/**
 * Distributed sliding-window rate limiter via Upstash Redis.
 * Fails open on Redis errors — never blocks legitimate traffic due to infra issues.
 */
const rateLimit = async (
  limiter: Ratelimit,
  ip: string,
): Promise<NextResponse | null> => {
  try {
    const { success, limit, remaining, reset } = await limiter.limit(ip);
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
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
  } catch {
    // Redis unavailable — fail open, never block legitimate traffic
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
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gh-token, x-admin-secret");
  if (!isPublic) res.headers.set("Access-Control-Max-Age", "86400");
  return res;
};

export const middleware = async (req: NextRequest): Promise<NextResponse> => {
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

  // ── Non-API page requests: issue / refresh HMAC session cookie ────────────
  // The cookie is HttpOnly + SameSite=Strict — auto-sent with all same-origin
  // fetch() calls from the browser. Enables token validation on strict-get routes.
  if (!pathname.startsWith("/api/")) {
    if (SM_SECRET) {
      const existing = req.cookies.get(COOKIE_NAME)?.value;
      const valid = existing ? await verifyToken(existing, SM_SECRET) : false;
      if (!valid) {
        const res = NextResponse.next();
        res.cookies.set(COOKIE_NAME, await generateToken(SM_SECRET), {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          maxAge: TOKEN_TTL_MS / 1000,
          path: "/",
        });
        return res;
      }
    }
    return NextResponse.next();
  }

  const tier = classifyRoute(method, pathname);

  // ── Public / exempt ───────────────────────────────────────────────────────
  if (tier === "public" || tier === "exempt") return withCors(NextResponse.next(), tier === "public");

  const ip = getIP(req);

  // ── POST routes: origin check + per-route rate limit ─────────────────────
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
    const route = POST_ROUTES.find((r) => r.match(pathname));
    if (route) {
      const blocked = await rateLimit(route.limiter, ip);
      if (blocked) return blocked;
    }
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
      if (!await verifyToken(token, SM_SECRET)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    if (!checkReferer(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const blocked = await rateLimit(TIER_LIMITERS["stargazer-cache-get"], ip);
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
      if (!await verifyToken(token, SM_SECRET)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    // Referer check — defense-in-depth even when token is valid
    if (!checkReferer(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const blocked = await rateLimit(TIER_LIMITERS["strict-get"], ip);
    if (blocked) return blocked;
    return withCors(NextResponse.next(), false);
  }

  // ── Moderate GET: rate limit only ─────────────────────────────────────────
  const blocked = await rateLimit(TIER_LIMITERS["moderate-get"], ip);
  if (blocked) return blocked;
  return withCors(NextResponse.next(), false);
};

export const config = {
  matcher: [
    // All routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
