// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Hex color constants for imperative contexts (Canvas 2D, email HTML, OG image JSX)
 * where CSS custom properties are unavailable.
 *
 * Two palettes:
 *   THEME_DARK    — mirrors :root defaults in globals.css. Keep in sync if tokens change.
 *   SHARE_IMAGE   — GitHub-flavored dark palette for Canvas share image export.
 *                   These intentionally differ from THEME_DARK (e.g. #58a6ff vs #7eb8ff).
 */

/** Mirrors globals.css :root dark defaults. */
export const THEME_DARK = {
  background:            "#0d1117",
  surface:               "#161b22",
  surfaceAlt:            "#1c2128",
  foreground:            "#f0f6fc",
  muted:                 "#8b949e",
  mutedSubtle:           "#848d97",
  border:                "#30363d",
  borderSubtle:          "#21262d",
  accentBlue:            "#7eb8ff",
  accentGreen:           "#10D070",
  accentGreenEmphasis:   "#0E9856",
  accentAmber:           "#f0a050",
  accentOrange:          "#f0883e",
  accentRed:             "#f85149",
  accentPurple:          "#a371f7",
  mapBg:                 "#010409",
} as const;

/**
 * GitHub-flavored dark colors for Canvas 2D share image generation.
 * Not 1:1 with THEME_DARK — these match GitHub Primer and produce
 * better contrast on the exported share image.
 */
export const SHARE_IMAGE = {
  surfaceOverlay:      "rgba(13,17,23,0.92)",
  surfaceOverlay80:    "rgba(13,17,23,0.8)",
  surfaceOverlay75:    "rgba(13,17,23,0.75)",
  panelBg:             "rgba(22,27,34,0.9)",
  border:              "#30363d",
  foreground:          "#f0f6fc",
  muted:               "#8b949e",
  mutedSubtle:         "#484f58",
  linkBlue:            "#58a6ff",
  statAmber:           "#ffa657",
  statGreen:           "#3fb950",
} as const;
