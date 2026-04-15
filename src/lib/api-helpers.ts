// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shared helpers for Next.js Route Handlers.
// Eliminates duplicated error responses, admin auth checks, and token extraction.

import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/api-token";

/** Standardised JSON error response. */
export const jsonError = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

/** Extract the real client IP — Vercel injects cf-connecting-ip on production. */
const getIP = (req: NextRequest): string =>
  req.headers.get("cf-connecting-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

/**
 * Returns a 401/403 response if the request is not authenticated as admin,
 * or `null` if authentication passes (caller may proceed).
 *
 * Two layers of protection:
 *  1. IP allowlist — ADMIN_ALLOWED_IPS env var (comma-separated). When set,
 *     any IP not in the list is blocked before the secret is even checked.
 *  2. x-admin-secret header — must match ADMIN_SECRET env var.
 *
 * Set ADMIN_ALLOWED_IPS to your home/VPN IP in the Vercel dashboard.
 * Leave unset in local dev (IP check is skipped when the var is absent).
 */
export const requireAdminAuth = (req: NextRequest): NextResponse | null => {
  const allowedIPs = process.env.ADMIN_ALLOWED_IPS;
  if (allowedIPs) {
    const ip = getIP(req);
    const allowed = allowedIPs.split(",").map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(ip)) {
      logAdminAudit(req, "denied_ip");
      return jsonError("Forbidden", 403);
    }
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-admin-secret") ?? "", secret)) {
    logAdminAudit(req, "denied_secret");
    return jsonError("Unauthorized", 401);
  }

  logAdminAudit(req, "allowed");
  return null;
};

/** Structured audit log for admin endpoint access — captured by Vercel Logs. */
const logAdminAudit = (req: NextRequest, action: "allowed" | "denied_ip" | "denied_secret"): void => {
  const ip = getIP(req);
  const path = new URL(req.url).pathname;
  console.log(`[ADMIN_AUDIT] ts=${new Date().toISOString()} ip=${ip} path=${path} action=${action}`);
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
    .replace(/ghp_[A-Za-z0-9]+/g, "[gh-token-redacted]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[gh-token-redacted]")
    .replace(/gho_[A-Za-z0-9]+/g, "[gh-token-redacted]")
    .replace(/ghs_[A-Za-z0-9]+/g, "[gh-token-redacted]");
};

/** Safe server-side error logger that never leaks secrets. */
export const logError = (tag: string, err: unknown): void => {
  const name = err instanceof Error ? err.constructor.name : "Error";
  console.error(`[${tag}] ${name}: ${sanitizeError(err)}`);
};
