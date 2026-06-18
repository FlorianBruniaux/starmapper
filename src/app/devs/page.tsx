// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { LanguageListData, CountryListData } from "@/lib/devs-query";
import { fetchLanguageList, fetchTopCountries } from "@/lib/devs-query";
import { DevsClient } from "./_components/devs-client";

export default async function DevsHubPage() {
  let languages: LanguageListData | null = null;
  let countries: CountryListData | null = null;

  try {
    [languages, countries] = await Promise.all([
      fetchLanguageList(),
      fetchTopCountries(),
    ]);
  } catch {
    // graceful degradation — grids render empty on fetch failure
  }

  return <DevsClient initialLanguages={languages} initialCountries={countries} />;
}
