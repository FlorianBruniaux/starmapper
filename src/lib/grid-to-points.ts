// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { StargazerPoint } from "@/app/api/chunk/route";
import type { GlobalMapCell } from "@/app/api/explore/global-map/route";

/**
 * Converts grid aggregation cells into synthetic StargazerPoint objects
 * so StargazerMap can render them without modification.
 *
 * The `name` field carries a human-readable label ("42 developers").
 * Callers can detect these synthetic points via `isGridCell: true` embedded
 * in the `bio` field (parsed by the map popup).
 */
export const gridToPoints = (cells: GlobalMapCell[]): StargazerPoint[] =>
  cells.map((c) => ({
    login: c.topLogin,
    name: `${c.count.toLocaleString()} developer${c.count !== 1 ? "s" : ""}`,
    bio: `__grid__:${c.count}:${c.topLogin}`,
    company: null,
    location: null,
    followers: c.totalFollowers,
    avatarUrl: `https://github.com/${c.topLogin}.png`,
    lat: c.lat,
    lng: c.lng,
    starredAt: null,
    linkedinUrl: null,
  }));
