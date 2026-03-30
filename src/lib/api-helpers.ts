// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shared helpers for Next.js Route Handlers.
// Eliminates duplicated error responses, admin auth checks, and token extraction.

import { NextRequest, NextResponse } from "next/server";

/** Standardised JSON error response. */
export const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

/**
 * Returns a 401 response if the request is not authenticated as admin,
 * or `null` if authentication passes (caller may proceed).
 */
export const requireAdminAuth = (req: NextRequest): NextResponse | null => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return jsonError("Unauthorized", 401);
  }
  return null;
};

/**
 * Extracts the GitHub token from the request, falling back to the server env var.
 * Returns `undefined` if neither is present.
 */
export const extractGhToken = (req: NextRequest): string | undefined =>
  req.headers.get("x-gh-token") || process.env.GITHUB_TOKEN || undefined;

/** Strip credentials from error messages before logging. */
export const sanitizeError = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/postgres(ql)?:\/\/[^\s]*/gi, "[db-url-redacted]")
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/g, "Bearer [redacted]")
    .replace(/token=[A-Za-z0-9_\-.]+/gi, "token=[redacted]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[gh-token-redacted]");
};

/** Safe server-side error logger that never leaks secrets. */
export const logError = (tag: string, err: unknown): void => {
  const name = err instanceof Error ? err.constructor.name : "Error";
  console.error(`[${tag}] ${name}: ${sanitizeError(err)}`);
};
