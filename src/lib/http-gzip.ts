// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Deliberately separate from api-helpers.ts. That module is imported by the OG image
// routes, which run on the edge runtime, and `node:zlib` is not available there: putting
// this in api-helpers.ts fails the production build with "Native module not found:
// node:zlib" while tsc and vitest both stay green. Only Node-runtime route handlers
// import this file.

import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";

/**
 * JSON response, gzip-encoded when the client advertises support.
 *
 * Fast Origin Transfer bills the function-to-edge segment, upstream of the CDN's own
 * client-facing compression, so a large JSON body crosses it uncompressed unless the
 * handler compresses it here. `compress` in next.config is inert on Vercel: the
 * compression middleware is required only by server/lib/router-server.js (the
 * `next start` HTTP server) and ships in neither serverless bundle.
 *
 * Gated on Accept-Encoding rather than unconditional, so a client that asked for
 * identity gets identity. Every browser and undici send gzip, and `fetch()`
 * decompresses transparently, so callers need no change.
 *
 * `Vary: Accept-Encoding` is mandatory, not decorative: these responses carry s-maxage,
 * and without it the CDN could hand a cached gzip body to an identity client, or the
 * reverse.
 */
export const jsonMaybeGzip = (
  // Request, not NextRequest: only the headers are read, and /api/repos hands us a
  // plain Request.
  req: Request,
  value: unknown,
  headers: Record<string, string> = {},
): NextResponse => {
  const body = JSON.stringify(value);
  const base = {
    "Content-Type": "application/json",
    ...headers,
    Vary: "Accept-Encoding",
  };

  if (!req.headers.get("accept-encoding")?.includes("gzip")) {
    return new NextResponse(body, { headers: base });
  }

  return new NextResponse(new Uint8Array(gzipSync(Buffer.from(body, "utf8"))), {
    headers: { ...base, "Content-Encoding": "gzip" },
  });
};
