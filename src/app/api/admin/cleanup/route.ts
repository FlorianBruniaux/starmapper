// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// GDPR Art. 5(1)(e) — Storage Limitation
// Purges github_user and star_event records older than 12 months.
// Runs monthly via Vercel Cron (see vercel.json). Also callable manually via admin auth.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError, logError } from "@/lib/api-helpers";

const RETENTION_MONTHS = 12;

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  return runCleanup();
};

// Vercel Cron calls GET with the Authorization header set to the CRON_SECRET env var.
// We validate it to prevent unauthenticated cron execution.
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized", 401);
  }

  return runCleanup();
};

const runCleanup = async () => {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  try {
    // Delete star events for users last fetched before the cutoff
    // (join via subquery — Prisma doesn't support JOIN in deleteMany)
    const staleUsers = await prisma.gitHubUser.findMany({
      where: { fetchedAt: { lt: cutoff } },
      select: { login: true },
    });

    if (staleUsers.length === 0) {
      return NextResponse.json({ ok: true, usersDeleted: 0, eventsDeleted: 0, cutoff });
    }

    const staleLogins = staleUsers.map((u) => u.login);

    const { count: eventsDeleted } = await prisma.starEvent.deleteMany({
      where: { login: { in: staleLogins } },
    });

    const { count: usersDeleted } = await prisma.gitHubUser.deleteMany({
      where: { login: { in: staleLogins } },
    });

    return NextResponse.json({ ok: true, usersDeleted, eventsDeleted, cutoff, retentionMonths: RETENTION_MONTHS });
  } catch (err) {
    logError("cleanup", err);
    return jsonError("internal", 500);
  }
};
