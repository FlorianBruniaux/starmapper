// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import dynamic from "next/dynamic";
export const CountryChoroplethDynamic = dynamic(
  () => import("./country-choropleth").then((m) => ({ default: m.CountryChoropleth })),
  { ssr: false, loading: () => <div role="status" className="w-full h-full bg-background"><span className="sr-only">Loading map…</span></div> },
);
