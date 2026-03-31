// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { generateToken, verifyToken, COOKIE_NAME, TOKEN_TTL_MS } from "@/lib/api-token";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type Tier = "strict-get" | "moderate-get" | "admin" | "post" | "public" | "exempt";

const redis = Redis.fromEnv();

// POST route limiters — one instance per route, prefix avoids key collisions
const POST_LIMITERS: Record<string, Ratelimit> = {
  "/api/chunk":           new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, "60 s"), prefix: "rl:chunk" }),
  "/api/badge-update":    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20,  "60 s"), prefix: "rl:badge-update" }),
  "/api/stargazer-cache": new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10,  "60 s"), prefix: "rl:stargazer-cache" }),
  "/api/user-details":    new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30,  "60 s"), prefix: "rl:user-details" }),
};

// Tier limiters for GET routes
const TIER_LIMITERS: Record<"strict-get" | "moderate-get" | "admin", Ratelimit> = {
  "strict-get":   new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "60 s"), prefix: "rl:strict-get" }),
  "moderate-get": new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "60 s"), prefix: "rl:moderate-get" }),
  "admin":        new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "rl:admin" }),
};

// SM_TOKEN_SECRET: when set, enables HMAC token validation on strict-get endpoints.
// When unset (local dev without env), falls back to Referer check + rate limit only.
const SM_SECRET = process.env.SM_TOKEN_SECRET ?? "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getIP = (req: NextRequest): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

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
  if (pathname.startsWith("/api/badge/") || pathname.startsWith("/api/map-image/")) {
    return "public";
  }

  // Admin routes — rate limit only (called from CLI/scripts, no referer)
  if (pathname.startsWith("/api/admin/")) return "admin";

  // POST/mutating methods
  if (method !== "GET" && method !== "HEAD") {
    if (POST_LIMITERS[pathname]) return "post";
    return "exempt";
  }

  // Strict GET — data-rich endpoints with per-user PII (logins, locations, coordinates)
  if (
    pathname.startsWith("/api/stargazer-cache/") ||
    pathname.startsWith("/api/stats/") ||
    pathname === "/api/explore/top" ||
    pathname === "/api/explore/power" ||
    pathname === "/api/explore/user-repos" ||
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

export const middleware = async (req: NextRequest): Promise<NextResponse> => {
  const { pathname } = req.nextUrl;
  const method = req.method;

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
  if (tier === "public" || tier === "exempt") return NextResponse.next();

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
    const limiter = POST_LIMITERS[pathname];
    if (limiter) {
      const blocked = await rateLimit(limiter, ip);
      if (blocked) return blocked;
    }
    return NextResponse.next();
  }

  // ── Admin routes: rate limit only ─────────────────────────────────────────
  if (tier === "admin") {
    const blocked = await rateLimit(TIER_LIMITERS["admin"], ip);
    if (blocked) return blocked;
    return NextResponse.next();
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
    return NextResponse.next();
  }

  // ── Moderate GET: rate limit only ─────────────────────────────────────────
  const blocked = await rateLimit(TIER_LIMITERS["moderate-get"], ip);
  if (blocked) return blocked;
  return NextResponse.next();
};

export const config = {
  matcher: [
    // All routes except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};
