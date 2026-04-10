// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import dynamic from "next/dynamic";

export const LanguageChoroplethDynamic = dynamic(
  () => import("./language-choropleth").then((m) => ({ default: m.LanguageChoropleth })),
  { ssr: false, loading: () => <div className="w-full h-full bg-background" /> },
);
