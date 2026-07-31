// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Weighted coverage: raw distinct-login-count / live-star-count overstates what
// actually renders as a dot by roughly 3x, since only ~30% of github_user rows
// carry a geolocation. See docs/ROADMAP.md Phase 2 for the measurement.
const GEOLOCATION_RATE = 0.3;

export const computeCoverage = (knownCount: number, liveStarCount: number): number => {
  if (liveStarCount <= 0) return 0;
  const raw = GEOLOCATION_RATE * (knownCount / liveStarCount) * 100;
  return Math.min(100, Math.round(raw));
};
