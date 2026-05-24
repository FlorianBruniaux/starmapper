// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { MappedRepo } from "@/app/api/repos/route";
import { fetchReposData } from "@/lib/repos-query";
import { LandingClient } from "./_components/landing-client";

export default async function HomePage() {
  let repos: MappedRepo[] = [];
  let reposTotal = 0;

  try {
    const data = await fetchReposData(12, true);
    repos = data.repos;
    reposTotal = data.total;
  } catch {
    // graceful degradation — community maps section is hidden on fetch failure
  }

  return <LandingClient initialRepos={repos} initialTotal={reposTotal} />;
}
