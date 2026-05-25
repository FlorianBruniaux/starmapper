// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Suspense } from "react";
import type { MappedRepo } from "@/app/api/repos/route";
import { fetchReposData } from "@/lib/repos-query";
import { ReposClient } from "./_components/repos-client";

export default async function ReposPage() {
  let repos: MappedRepo[] = [];
  let total = 0;

  try {
    const data = await fetchReposData(5000, false);
    repos = data.repos;
    total = data.total;
  } catch {
    // graceful degradation — table renders empty on fetch failure
  }

  return (
    <Suspense fallback={null}>
      <ReposClient initialRepos={repos} initialTotal={total} />
    </Suspense>
  );
}
