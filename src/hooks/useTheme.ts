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

// Module-level pub/sub — syncs all useTheme instances in the same page.
// Necessary because each hook call has its own React state. Without this,
// ThemeToggle.toggle() updates only its own state, not the map page's state.
const themeListeners = new Set<(theme: Theme, preference: Theme | null) => void>();

const notifyThemeListeners = (theme: Theme, preference: Theme | null) => {
  themeListeners.forEach((fn) => fn(theme, preference));
};

export const useTheme = (): UseThemeResult => {
  const [preference, setPreference] = useState<Theme | null>(() => {
    if (typeof window === "undefined") return null;
    return getStoredTheme();
  });
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = getStoredTheme();
    return stored ?? getSystemTheme();
  });

  // Apply class to <html> + subscribe to cross-instance theme changes
  useEffect(() => {
    const stored = getStoredTheme();
    const resolved = applyTheme(stored);
    setPreference(stored);
    setThemeState(resolved);

    // Receive updates from other useTheme instances (e.g. ThemeToggle → map page)
    const listener = (newTheme: Theme, newPreference: Theme | null) => {
      setThemeState(newTheme);
      setPreference(newPreference);
    };
    themeListeners.add(listener);

    // Watch system preference changes (only affects users with no manual override)
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const mqHandler = () => {
      const current = getStoredTheme();
      if (current === null) {
        const resolved = applyTheme(null);
        setThemeState(resolved);
        notifyThemeListeners(resolved, null);
      }
    };
    mq.addEventListener("change", mqHandler);

    return () => {
      themeListeners.delete(listener);
      mq.removeEventListener("change", mqHandler);
    };
  }, []);

  const setTheme = useCallback((t: Theme | null) => {
    setStoredTheme(t);
    const resolved = applyTheme(t);
    setPreference(t);
    setThemeState(resolved);
    notifyThemeListeners(resolved, t);
  }, []);

  const toggle = useCallback(() => {
    const current = getStoredTheme() ?? getSystemTheme();
    const next: Theme = current === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  return { theme, preference, toggle, setTheme };
};
