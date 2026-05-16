// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

type Props = {
  className?: string;
};

export const ThemeToggle = ({ className = "" }: Props) => {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex items-center justify-center size-8 rounded-lg border border-border
        text-muted hover:text-foreground hover:border-accent-blue
        transition-colors focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-accent-blue/40 ${className}`}
    >
      {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
    </button>
  );
};
