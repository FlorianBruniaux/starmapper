// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Daily stats digest — fetches key metrics from DB and sends via Resend.
// GET  — called by Vercel Cron at 8am Paris time (6am UTC). Auth: CRON_SECRET.
// POST — manual trigger for testing. Auth: x-admin-secret header.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { requireAdminAuth, logError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";

const runDigest = async () => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });

  const digestTo = process.env.DIGEST_EMAIL ?? "florian@bruniaux.com";
  const resend = new Resend(resendKey);

  const since7d = new Date();
  since7d.setDate(since7d.getDate() - 7);
  since7d.setUTCHours(0, 0, 0, 0);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [
    grandTotal,
    todayViews,
    topRepos,
    recentScans,
    geocacheCount,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT SUM(count)::bigint AS total FROM page_view
    `,
    prisma.$queryRaw<Array<{ type: string; total: bigint }>>`
      SELECT type, SUM(count)::bigint AS total
      FROM page_view WHERE date = ${today}
      GROUP BY type
    `,
    prisma.$queryRaw<Array<{ slug: string; total: bigint }>>`
      SELECT slug, SUM(count)::bigint AS total
      FROM page_view WHERE type = 'repo' AND date >= ${since7d}
      GROUP BY slug ORDER BY total DESC LIMIT 10
    `,
    prisma.stargazerCache.findMany({
      select: { owner: true, repo: true, totalCount: true, scannedAt: true, indexedBy: true },
      orderBy: { scannedAt: "desc" },
      take: 10,
    }),
    prisma.geoCache.count(),
  ]);

  const totalViews  = Number(grandTotal[0]?.total ?? BigInt(0));
  const todayRepo   = Number(todayViews.find((r) => r.type === "repo")?.total    ?? BigInt(0));
  const todayProf   = Number(todayViews.find((r) => r.type === "profile")?.total ?? BigInt(0));

  const fmt = (n: number) => n.toLocaleString("fr-FR");
  const dateStr = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const topReposHtml = topRepos.map((r) =>
    `<tr><td style="padding:4px 12px 4px 0;font-family:monospace;color:#58a6ff">${r.slug}</td><td style="padding:4px 0;text-align:right">${fmt(Number(r.total))}</td></tr>`
  ).join("");

  const recentScansHtml = recentScans.map((s) => {
    const d = s.scannedAt.toISOString().slice(0, 10);
    const by = s.indexedBy ? `<span style="color:#58a6ff">@${s.indexedBy}</span>` : `<span style="color:#8b949e">—</span>`;
    return `<tr><td style="padding:4px 12px 4px 0;color:#8b949e;font-size:12px">${d}</td><td style="padding:4px 12px 4px 0;font-family:monospace;color:#f0f6fc">${s.owner}/${s.repo}</td><td style="padding:4px 12px 4px 0;text-align:right">${fmt(s.totalCount)}</td><td style="padding:4px 0">${by}</td></tr>`;
  }).join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d1117;color:#f0f6fc;font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#58a6ff;font-size:20px;margin-bottom:4px">StarMapper, Digest quotidien</h1>
  <p style="color:#8b949e;margin-top:0;margin-bottom:24px">${dateStr}</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr>
      <td style="padding:12px;background:#161b22;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold">${fmt(todayRepo + todayProf)}</div>
        <div style="color:#8b949e;font-size:12px;margin-top:4px">vues aujourd'hui</div>
        <div style="color:#8b949e;font-size:11px">${fmt(todayRepo)} repos · ${fmt(todayProf)} profils</div>
      </td>
      <td style="width:12px"></td>
      <td style="padding:12px;background:#161b22;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold">${fmt(totalViews)}</div>
        <div style="color:#8b949e;font-size:12px;margin-top:4px">vues all-time</div>
      </td>
      <td style="width:12px"></td>
      <td style="padding:12px;background:#161b22;border-radius:8px;text-align:center">
        <div style="font-size:28px;font-weight:bold">${fmt(geocacheCount)}</div>
        <div style="color:#8b949e;font-size:12px;margin-top:4px">entrées geocache</div>
      </td>
    </tr>
  </table>

  <h2 style="font-size:14px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Top repos, 7 derniers jours</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    ${topReposHtml}
  </table>

  <h2 style="font-size:14px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Scans récents</h2>
  <table style="width:100%;border-collapse:collapse">
    ${recentScansHtml}
  </table>
</body>
</html>`;

  const { error } = await resend.emails.send({
    from: process.env.DIGEST_FROM ?? "StarMapper <onboarding@resend.dev>",
    to: digestTo,
    subject: `StarMapper digest, ${new Date().toLocaleDateString("fr-FR")}`,
    html,
  });

  if (error) {
    logError("daily-digest Resend", error);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, to: digestTo });
};

// Vercel Cron — GET with Authorization: Bearer <CRON_SECRET>
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[cron/daily-digest] CRON_SECRET not set — cron auth will always fail");
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    return await runDigest();
  } catch (err) {
    logError("daily-digest GET", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};

// Manual trigger — POST with x-admin-secret header
export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;

  try {
    return await runDigest();
  } catch (err) {
    logError("daily-digest POST", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
