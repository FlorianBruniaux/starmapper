// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { MappedRepo } from "@/app/api/repos/route";
import { LandingClient } from "./_components/landing-client";

// Revalidate every 5 minutes — repos list changes slowly
export const revalidate = 300;

const resolveBaseUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export default async function HomePage() {
  let repos: MappedRepo[] = [];
  let reposTotal = 0;

  try {
    const res = await fetch(`${resolveBaseUrl()}/api/repos?limit=12&diverse=true`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const data = (await res.json()) as { repos: MappedRepo[]; total: number };
      repos = data.repos;
      reposTotal = data.total;
    }
  } catch {
    // graceful degradation — community maps section is hidden on fetch failure
  }

  return <LandingClient initialRepos={repos} initialTotal={reposTotal} />;
}
