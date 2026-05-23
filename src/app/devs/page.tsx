// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { LanguageListData } from "@/app/api/devs/route";
import { resolveBaseUrl } from "@/lib/base-url";
import { DevsClient } from "./_components/devs-client";

export const revalidate = 3600;

export default async function DevsHubPage() {
  let data: LanguageListData | null = null;

  try {
    const res = await fetch(`${resolveBaseUrl()}/api/devs`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      data = (await res.json()) as LanguageListData;
    }
  } catch {
    // graceful degradation — grid renders empty on fetch failure
  }

  return <DevsClient initialData={data} />;
}
