// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Maps normalizeCountry() output → world-atlas countries-110m.json feature names.
 * Only overrides that differ are listed here; identical names need no entry.
 */
export const STARMAPPER_TO_GEO: Record<string, string> = {
  "United States":                   "United States of America",
  "Democratic Republic of the Congo": "Dem. Rep. Congo",
  "Bosnia and Herzegovina":           "Bosnia and Herz.",
  "Ivory Coast":                      "Côte d'Ivoire",
  "Central African Republic":         "Central African Rep.",
  "Dominican Republic":               "Dominican Rep.",
  "Equatorial Guinea":                "Eq. Guinea",
  "North Macedonia":                  "Macedonia",
  "South Sudan":                      "S. Sudan",
  "Solomon Islands":                  "Solomon Is.",
  "Falkland Islands":                 "Falkland Is.",
};

/** Converts a starmapper country name to the geo feature name for world-atlas lookup. */
export const toGeoName = (country: string): string =>
  STARMAPPER_TO_GEO[country] ?? country;
