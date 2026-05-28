// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Small "Map by Jawg Maps" badge rendered as an absolute overlay
 * on top of any MapLibre map container. Appears just above the
 * built-in MapLibre attribution bar (bottom-right).
 *
 * The parent container must have `position: relative` (or `absolute`).
 */
export const JawgBadge = () => (
  <a
    href="https://www.jawg.io/?utm_source=starmapper&utm_medium=map-badge"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Map tiles by Jawg Maps (opens in new tab)"
    className="absolute bottom-9 right-2 z-10 flex items-center gap-1.5 bg-surface border border-border rounded-md px-2.5 py-1 text-2xs text-foreground hover:border-accent-blue/50 transition-colors shadow-sm"
  >
    Map by{" "}
    <strong className="font-semibold text-accent-blue">Jawg Maps</strong>
  </a>
);
