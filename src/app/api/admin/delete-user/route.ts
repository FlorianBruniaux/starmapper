// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// GDPR Art. 17 — Right to Erasure
// Deletes all personal data associated with a GitHub login, logs the deletion for audit.
// Authentication: x-admin-secret header (same pattern as other admin routes).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth, jsonError, logError } from "@/lib/api-helpers";
import { defineRoute } from "@/lib/define-route";
import { adminDeleteUserSchema } from "@/schemas/admin-delete-user";

export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  return defineRoute(adminDeleteUserSchema, async (_req, body) => {
    const { login } = body;

    // Log the deletion request immediately (audit trail)
    let logId: number;
    try {
      const log = await prisma.deletionLog.create({
        data: {
          login,
          status: "pending",
          notes: body.notes ?? null,
        },
      });
      logId = log.id;
    } catch (err) {
      logError("delete-user/log", err);
      return jsonError("internal", 500);
    }

    try {
      // 1. Check whether the user exists
      const user = await prisma.gitHubUser.findUnique({ where: { login } });
      if (!user) {
        await prisma.deletionLog.update({
          where: { id: logId },
          data: { status: "not_found", deletedAt: new Date() },
        });
        return NextResponse.json({ ok: true, status: "not_found", login });
      }

      // 2. Delete star events first (FK constraint)
      const { count: eventsDeleted } = await prisma.starEvent.deleteMany({ where: { login } });

      // 3. Delete the user record
      await prisma.gitHubUser.delete({ where: { login } });

      // 4. Mark deletion as complete in audit log
      await prisma.deletionLog.update({
        where: { id: logId },
        data: { status: "completed", deletedAt: new Date() },
      });

      return NextResponse.json({
        ok: true,
        login,
        eventsDeleted,
        message: `User ${login} and ${eventsDeleted} star event(s) deleted. Confirm via email within 30 days.`,
      });
    } catch (err) {
      logError("delete-user", err);

      // Mark as failed in audit log
      try {
        await prisma.deletionLog.update({
          where: { id: logId },
          data: { status: "failed", notes: err instanceof Error ? err.message.slice(0, 255) : "unknown" },
        });
      } catch { /* swallow — original error takes priority */ }

      return jsonError("internal", 500);
    }
  })(req);
};
