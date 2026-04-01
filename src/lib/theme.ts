// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

// ─── Theme management ─────────────────────────────────────────────────────────
// Priority: manual localStorage override > prefers-color-scheme system preference
// Stores "light" | "dark" | null (null = follow system)

export type Theme = "light" | "dark";

const STORAGE_KEY = "starmapper:theme";

export const getStoredTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
    return null;
  } catch {
    return null;
  }
};

export const setStoredTheme = (theme: Theme | null): void => {
  try {
    if (theme === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch { /* localStorage unavailable */ }
};

export const getSystemTheme = (): Theme => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

// Apply theme class to <html> and return the resolved theme
export const applyTheme = (theme: Theme | null): Theme => {
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

// Map tile URLs — swapped based on resolved theme
export const MAP_STYLE_DARK = (token: string) =>
  `https://api.jawg.io/styles/jawg-dark.json?access-token=${token}&lang=en`;

export const MAP_STYLE_LIGHT = (token: string) =>
  `https://api.jawg.io/styles/jawg-light.json?access-token=${token}&lang=en`;
