// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// OSS issues & PRs digest across maintained repos.
// GET  — Vercel Cron (Mon + Thu at 6am UTC). Auth: CRON_SECRET.
// POST — manual trigger. Auth: x-admin-secret header.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAdminAuth, logError } from "@/lib/api-helpers";
import { safeEqual } from "@/lib/api-token";

const DEFAULT_REPOS = [
  "FlorianBruniaux/ccboard",
  "FlorianBruniaux/cc-copilot-bridge",
  "FlorianBruniaux/claude-cowork-guide",
  "FlorianBruniaux/cc-sessions",
  "FlorianBruniaux/node-dep-scope",
  "FlorianBruniaux/claude-code-plugins",
  "FlorianBruniaux/ctxharness",
  "FlorianBruniaux/starmapper",
  "FlorianBruniaux/claude-code-ultimate-guide",
];

const DAYS_WINDOW = 4; // covers Mon→Thu and Thu→Mon
const STALE_DAYS  = 3; // issues open 3+ days with 0 comments = needs attention

type GHItem = {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  comments: number;
  user: { login: string } | null;
  pull_request?: unknown;
};

type RepoActivity = {
  slug: string;
  newIssues: GHItem[];
  newPRs: GHItem[];
  stalledIssues: GHItem[];
  openPRCount: number;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ghFetch = async (path: string, token: string): Promise<GHItem[]> => {
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "StarMapper/oss-digest",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return [];
    return (await res.json()) as GHItem[];
  } catch {
    return [];
  }
};

const fetchRepoActivity = async (
  slug: string,
  token: string,
  since: Date,
  staleThreshold: Date,
): Promise<RepoActivity> => {
  const items = await ghFetch(
    `/repos/${slug}/issues?state=open&per_page=100&sort=created&direction=desc`,
    token,
  );

  const issues = items.filter((i) => !i.pull_request);
  const prs    = items.filter((i) => !!i.pull_request);
  const sinceMs = since.getTime();
  const staleMs = staleThreshold.getTime();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return {
    slug,
    newIssues: issues.filter((i) => new Date(i.created_at).getTime() > sinceMs),
    newPRs:    prs.filter((i) => new Date(i.created_at).getTime() > sinceMs),
    stalledIssues: issues.filter((i) => {
      const t = new Date(i.created_at).getTime();
      return i.comments === 0 && t < staleMs && t > thirtyDaysAgo;
    }),
    openPRCount: prs.length,
  };
};

const itemRow = (item: GHItem, color: string) => {
  const date   = new Date(item.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const author = item.user?.login ?? "?";
  return `<tr>
    <td style="padding:3px 10px 3px 0;color:#8b949e;font-size:11px;white-space:nowrap">#${item.number}</td>
    <td style="padding:3px 10px 3px 0"><a href="${item.html_url}" style="color:${color};text-decoration:none;font-size:13px">${esc(item.title)}</a></td>
    <td style="padding:3px 0;color:#8b949e;font-size:11px;white-space:nowrap">@${esc(author)} · ${date}</td>
  </tr>`;
};

const sectionHtml = (label: string, items: GHItem[], color: string) => {
  if (items.length === 0) return "";
  return `
    <p style="color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:16px 0 4px">${label} (${items.length})</p>
    <table style="width:100%;border-collapse:collapse">${items.map((i) => itemRow(i, color)).join("")}</table>`;
};

const buildHtml = (activities: RepoActivity[], repoCount: number) => {
  const active = activities.filter(
    (a) => a.newIssues.length || a.newPRs.length || a.stalledIssues.length,
  );
  const dateStr = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const reposHtml = active.length === 0
    ? `<p style="color:#8b949e;font-style:italic">Rien à signaler — tous les repos sont tranquilles.</p>`
    : active.map((a) => `
      <div style="margin-bottom:28px;padding-bottom:28px;border-bottom:1px solid #21262d">
        <p style="margin:0 0 8px;font-family:monospace;font-size:15px">
          <a href="https://github.com/${a.slug}" style="color:#f0f6fc;text-decoration:none">${a.slug}</a>
          ${a.openPRCount > 0 ? `<span style="margin-left:10px;color:#8b949e;font-size:12px">${a.openPRCount} PR${a.openPRCount > 1 ? "s" : ""} ouvertes</span>` : ""}
        </p>
        ${sectionHtml("Nouvelles issues", a.newIssues, "#58a6ff")}
        ${sectionHtml("Nouvelles PRs", a.newPRs, "#3fb950")}
        ${sectionHtml("Sans réponse", a.stalledIssues, "#ffa657")}
      </div>`
    ).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d1117;color:#f0f6fc;font-family:-apple-system,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h1 style="color:#58a6ff;font-size:20px;margin-bottom:4px">OSS Digest</h1>
  <p style="color:#8b949e;margin-top:0;margin-bottom:28px">${dateStr} · ${repoCount} repos surveillés</p>
  ${reposHtml}
</body>
</html>`;
};

const runOssDigest = async () => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN not set" }, { status: 500 });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });

  const repos = process.env.OSS_REPOS
    ? process.env.OSS_REPOS.split(",").map((r) => r.trim()).filter(Boolean)
    : DEFAULT_REPOS;

  const since          = new Date(Date.now() - DAYS_WINDOW * 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - STALE_DAYS  * 24 * 60 * 60 * 1000);

  const activities = await Promise.all(
    repos.map((slug) => fetchRepoActivity(slug, token, since, staleThreshold)),
  );

  const html      = buildHtml(activities, repos.length);
  const digestTo  = process.env.DIGEST_EMAIL ?? "florian@bruniaux.com";
  const resend    = new Resend(resendKey);

  const { error } = await resend.emails.send({
    from: process.env.DIGEST_FROM ?? "StarMapper <onboarding@resend.dev>",
    to: digestTo,
    subject: `OSS Digest — ${new Date().toLocaleDateString("fr-FR")}`,
    html,
  });

  if (error) {
    logError("oss-digest Resend", error);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }

  const activeCount = activities.filter(
    (a) => a.newIssues.length || a.newPRs.length || a.stalledIssues.length,
  ).length;

  return NextResponse.json({ ok: true, to: digestTo, activeRepos: activeCount, totalRepos: repos.length });
};

// Vercel Cron — GET with Authorization: Bearer <CRON_SECRET>
export const GET = async (req: NextRequest) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const authHeader = req.headers.get("authorization");
  if (!safeEqual(authHeader ?? "", `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    return await runOssDigest();
  } catch (err) {
    logError("oss-digest GET", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};

// Manual trigger — POST with x-admin-secret header
export const POST = async (req: NextRequest) => {
  const authError = requireAdminAuth(req);
  if (authError) return authError;
  try {
    return await runOssDigest();
  } catch (err) {
    logError("oss-digest POST", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
};
