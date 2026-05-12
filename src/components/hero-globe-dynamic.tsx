// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import dynamic from "next/dynamic";

export const HeroGlobeDynamic = dynamic(
  () => import("@/components/hero-globe").then((m) => m.HeroGlobe),
  { ssr: false }
);
