// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type WindowEntry = { count: number; windowStart: number };
type Tier = "strict-get" | "moderate-get" | "admin" | "post" | "public" | "exempt";

const ipWindows = new Map<string, WindowEntry>();

// POST route limits (unchanged from original)
const POST_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/chunk":           { max: 100, windowMs: 60_000 }, // sequential loop, 1 req at a time
  "/api/badge-update":    { max: 20,  windowMs: 60_000 },
  "/api/stargazer-cache": { max: 10,  windowMs: 60_000 },
  "/api/user-details":    { max: 30,  windowMs: 60_000 },
};

// Tier limits for GET routes
const TIER_LIMITS: Record<"strict-get" | "moderate-get" | "admin", { max: number; windowMs: number }> = {
  "strict-get":   { max: 30, windowMs: 60_000 }, // data-rich PII endpoints
  "moderate-get": { max: 60, windowMs: 60_000 }, // aggregate / low-PII endpoints
  "admin":        { max: 10, windowMs: 60_000 }, // anti-brute-force on ADMIN_SECRET
};

// Cleanup stale entries every 5 minutes to avoid unbounded Map growth
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60_000;

const cleanup = () => {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of ipWindows.entries()) {
    if (now - entry.windowStart > CLEANUP_INTERVAL_MS) ipWindows.delete(key);
  }
};

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
    if (POST_LIMITS[pathname]) return "post";
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

/** Sliding-window rate limiter — returns 429 response or null if allowed. */
const rateLimit = (
  ip: string,
  key: string,
  limit: { max: number; windowMs: number },
): NextResponse | null => {
  cleanup();
  const now = Date.now();
  const entry = ipWindows.get(key);

  if (!entry || now - entry.windowStart > limit.windowMs) {
    ipWindows.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (entry.count >= limit.max) {
    const retryAfter = Math.ceil((limit.windowMs - (now - entry.windowStart)) / 1000);
    return NextResponse.json(
      { error: "rate_limit" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  entry.count++;
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

export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;
  const method = req.method;
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
    const limit = POST_LIMITS[pathname];
    if (limit) {
      const blocked = rateLimit(ip, `${pathname}:${ip}`, limit);
      if (blocked) return blocked;
    }
    return NextResponse.next();
  }

  // ── Admin routes: rate limit only ─────────────────────────────────────────
  if (tier === "admin") {
    const blocked = rateLimit(ip, `${pathname}:${ip}`, TIER_LIMITS["admin"]);
    if (blocked) return blocked;
    return NextResponse.next();
  }

  // ── Strict GET: referer check + rate limit ────────────────────────────────
  if (tier === "strict-get") {
    if (!checkReferer(req)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const blocked = rateLimit(ip, `${pathname}:${ip}`, TIER_LIMITS["strict-get"]);
    if (blocked) return blocked;
    return NextResponse.next();
  }

  // ── Moderate GET: rate limit only ─────────────────────────────────────────
  const blocked = rateLimit(ip, `${pathname}:${ip}`, TIER_LIMITS["moderate-get"]);
  if (blocked) return blocked;
  return NextResponse.next();
};

export const config = {
  matcher: ["/api/:path*"],
};
