// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { isCountry, normalizeCountry } from "@/lib/countries";

export const parseLocation = (location: string | null): { country: string | null; city: string | null } => {
  if (!location) return { country: null, city: null };
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { country: null, city: null };
  const lastSegment = parts[parts.length - 1];
  const country = isCountry(lastSegment) ? normalizeCountry(lastSegment) : null;
  const city = parts.length > 1 ? parts[0] : (country ? null : parts[0]);
  return { country, city };
};
