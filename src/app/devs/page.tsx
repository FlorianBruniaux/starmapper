// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { LanguageListData } from "@/lib/devs-query";
import { fetchLanguageList } from "@/lib/devs-query";
import { DevsClient } from "./_components/devs-client";

export default async function DevsHubPage() {
  let data: LanguageListData | null = null;

  try {
    data = await fetchLanguageList();
  } catch {
    // graceful degradation — grid renders empty on fetch failure
  }

  return <DevsClient initialData={data} />;
}
