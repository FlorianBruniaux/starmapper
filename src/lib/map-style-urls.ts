// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Server-safe map tile URL builders and types — no browser APIs, no "use client".
// Import MAP_STYLE_DARK / MAP_STYLE_LIGHT from here in server components
// or any context where you need the URLs without pulling in the theme localStorage logic.

export type Theme = "light" | "dark";
export type MapProjection = "globe" | "mercator";

export const MAP_STYLE_DARK = (token: string) =>
  `https://api.jawg.io/styles/jawg-dark.json?access-token=${token}`;

export const MAP_STYLE_LIGHT = (token: string) =>
  `https://api.jawg.io/styles/jawg-light.json?access-token=${token}`;
