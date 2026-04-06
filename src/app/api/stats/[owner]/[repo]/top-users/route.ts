// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Top users by followers for a given repo.
// Classified as strict-get in middleware — requires sm-token cookie + Referer check.
// Separated from the public /stats endpoint to prevent unauthenticated PII scraping.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeOwnerRepo, OWNER_REPO_RE } from "@/lib/api-validation";
import { jsonError, logError } from "@/lib/api-helpers";

export type TopUser = {
  login: string;
  name: string | null;
  followers: number;
  publicRepos: number;
  location: string | null;
  avatarUrl: string;
  company: string | null;
};

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) => {
  const { owner, repo } = await params;
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return jsonError("invalid_params", 400);
  }

  const key = normalizeOwnerRepo(owner, repo);

  try {
    const rows = await prisma.$queryRaw<{
      login: string; name: string | null; followers: number;
      publicRepos: number; location: string | null; company: string | null;
    }[]>`
      SELECT u.login, u.name, u.followers, u."publicRepos", u.location, u.company
      FROM star_event se
      JOIN github_user u USING (login)
      WHERE se.owner = ${key.owner} AND se.repo = ${key.repo}
      ORDER BY u.followers DESC
      LIMIT 60
    `;

    const topUsers: TopUser[] = rows.map((u) => ({
      ...u,
      avatarUrl: `https://github.com/${u.login}.png`,
    }));

    return NextResponse.json({ topUsers }, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    logError("stats/top-users", err);
    return jsonError("internal", 500);
  }
};
