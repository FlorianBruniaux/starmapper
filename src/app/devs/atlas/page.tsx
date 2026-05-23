// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { AtlasDominantData } from "@/app/api/devs/atlas/route";
import { resolveBaseUrl } from "@/lib/base-url";
import { AtlasClient } from "./_components/atlas-client";

export const revalidate = 3600;

export default async function LanguageAtlasPage() {
  let data: AtlasDominantData | null = null;

  try {
    const res = await fetch(`${resolveBaseUrl()}/api/devs/atlas`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      data = (await res.json()) as AtlasDominantData;
    }
  } catch {
    // graceful degradation — atlas renders empty on fetch failure
  }

  return <AtlasClient initialData={data} />;
}
