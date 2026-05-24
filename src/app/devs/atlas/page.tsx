// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { AtlasDominantData } from "@/lib/devs-query";
import { fetchAtlasData } from "@/lib/devs-query";
import { AtlasClient } from "./_components/atlas-client";

export default async function LanguageAtlasPage() {
  let data: AtlasDominantData | null = null;

  try {
    data = await fetchAtlasData();
  } catch {
    // graceful degradation — atlas renders empty on fetch failure
  }

  return <AtlasClient initialData={data} />;
}
