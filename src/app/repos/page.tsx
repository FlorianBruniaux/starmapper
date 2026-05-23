// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { MappedRepo } from "@/app/api/repos/route";
import { resolveBaseUrl } from "@/lib/base-url";
import { ReposClient } from "./_components/repos-client";

export const revalidate = 300;

export default async function ReposPage() {
  let repos: MappedRepo[] = [];
  let total = 0;

  try {
    const res = await fetch(`${resolveBaseUrl()}/api/repos?limit=5000`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const data = (await res.json()) as { repos: MappedRepo[]; total: number };
      repos = data.repos;
      total = data.total;
    }
  } catch {
    // graceful degradation — table renders empty on fetch failure
  }

  return <ReposClient initialRepos={repos} initialTotal={total} />;
}
