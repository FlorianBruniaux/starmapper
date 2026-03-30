// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  getSystemTheme,
  setStoredTheme,
} from "@/lib/theme";
import type { Theme } from "@/lib/theme";

type UseThemeResult = {
  // The resolved theme (never null — always "light" or "dark")
  theme: Theme;
  // null means "follow system"
  preference: Theme | null;
  toggle: () => void;
  setTheme: (t: Theme | null) => void;
};

export const useTheme = (): UseThemeResult => {
  const [preference, setPreference] = useState<Theme | null>(null);
  const [theme, setThemeState] = useState<Theme>("dark");

  // Initialize from localStorage + apply immediately
  useEffect(() => {
    const stored = getStoredTheme();
    const resolved = applyTheme(stored);
    setPreference(stored);
    setThemeState(resolved);

    // Watch system preference changes (only affects users with no manual override)
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const current = getStoredTheme();
      if (current === null) {
        const resolved = applyTheme(null);
        setThemeState(resolved);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((t: Theme | null) => {
    setStoredTheme(t);
    const resolved = applyTheme(t);
    setPreference(t);
    setThemeState(resolved);
  }, []);

  const toggle = useCallback(() => {
    const current = getStoredTheme() ?? getSystemTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  return { theme, preference, toggle, setTheme };
};
