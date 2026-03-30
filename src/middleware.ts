// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Rate limit config — per route, POST only
// ---------------------------------------------------------------------------

type WindowEntry = { count: number; windowStart: number };

const ipWindows = new Map<string, WindowEntry>();

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  "/api/chunk":            { max: 100, windowMs: 60_000 }, // sequential loop, 1 req at a time
  "/api/badge-update":     { max: 20,  windowMs: 60_000 },
  "/api/stargazer-cache":  { max: 10,  windowMs: 60_000 },
  "/api/user-details":     { max: 30,  windowMs: 60_000 },
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
  // Strip trailing slash and path — keep scheme + host only
  try {
    const { origin } = new URL(url);
    return origin;
  } catch {
    return url;
  }
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;
  const limit = LIMITS[pathname];

  // Only intercept POST routes we rate-limit
  if (!limit || req.method !== "POST") return NextResponse.next();

  // Layer 1 — Origin check
  // Blocks cross-origin scripts (bots, curl with Origin header, XSS attempts).
  // Legitimate browsers always send Origin on cross-origin POSTs;
  // same-origin requests from the app itself omit it or match.
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = appOrigin();
    const isLocalhost = origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
    // Block if origin is not localhost AND doesn't match the configured app origin.
    // When NEXT_PUBLIC_APP_URL is unset (e.g. CI), only localhost passes — safe default.
    if (!isLocalhost && (!allowed || origin !== allowed)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Layer 2 — Sliding window rate limit per IP
  cleanup();
  const ip = getIP(req);
  const key = `${pathname}:${ip}`;
  const now = Date.now();
  const entry = ipWindows.get(key);

  if (!entry || now - entry.windowStart > limit.windowMs) {
    ipWindows.set(key, { count: 1, windowStart: now });
    return NextResponse.next();
  }

  if (entry.count >= limit.max) {
    const retryAfter = Math.ceil((limit.windowMs - (now - entry.windowStart)) / 1000);
    return NextResponse.json(
      { error: "rate_limit" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  entry.count++;
  return NextResponse.next();
};

export const config = {
  matcher: [
    "/api/chunk",
    "/api/badge-update",
    "/api/stargazer-cache",
    "/api/user-details",
  ],
};
