// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

// ─── Theme management ─────────────────────────────────────────────────────────
// Priority: manual localStorage override > prefers-color-scheme system preference
// Stores "light" | "dark" | null (null = follow system)

// Re-export server-safe types and map URL builders so existing imports still work
export { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/map-style-urls";
export type { Theme, MapProjection } from "@/lib/map-style-urls";

const STORAGE_KEY = "starmapper:theme";

export const getStoredTheme = (): import("@/lib/map-style-urls").Theme | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
    return null;
  } catch {
    return null;
  }
};

export const setStoredTheme = (theme: import("@/lib/map-style-urls").Theme | null): void => {
  try {
    if (theme === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch { /* localStorage unavailable */ }
};

export const getSystemTheme = (): import("@/lib/map-style-urls").Theme => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

// Apply theme class to <html> and return the resolved theme
export const applyTheme = (theme: import("@/lib/map-style-urls").Theme | null): import("@/lib/map-style-urls").Theme => {
  const resolved = theme ?? getSystemTheme();
  const html = document.documentElement;
  if (resolved === "light") {
    html.classList.add("light");
    html.classList.remove("dark");
  } else {
    html.classList.add("dark");
    html.classList.remove("light");
  }
  return resolved;
};

// ─── Map projection preference ──────────────────────────────────────────────
// Persists user's globe ↔ mercator toggle choice across sessions.

const PROJECTION_KEY = "starmapper:projection";

export const getStoredProjection = (): import("@/lib/map-style-urls").MapProjection | null => {
  try {
    const v = localStorage.getItem(PROJECTION_KEY);
    if (v === "globe" || v === "mercator") return v;
    return null;
  } catch {
    return null;
  }
};

export const setStoredProjection = (p: import("@/lib/map-style-urls").MapProjection): void => {
  try {
    localStorage.setItem(PROJECTION_KEY, p);
  } catch { /* localStorage unavailable */ }
};
