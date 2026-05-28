// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect } from "react";
import { Star, X } from "lucide-react";

const NUDGE_KEY = "starmapper:nudge:star-v1";
const DELAY_MS = 2 * 60 * 1000;
const GH_REPO = "https://github.com/FlorianBruniaux/starmapper";

export const StarNudge = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(NUDGE_KEY)) return;
    } catch {
      return;
    }

    const timer = setTimeout(() => {
      try {
        if (!localStorage.getItem(NUDGE_KEY)) setVisible(true);
      } catch {}
    }, DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(NUDGE_KEY, "1");
    } catch {}
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Star StarMapper on GitHub"
      className="fixed bottom-6 right-6 z-40 w-72 bg-surface border border-border rounded-xl
                 shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-muted-subtle hover:text-foreground transition-colors"
      >
        <X size={14} aria-hidden="true" />
      </button>

      <div className="flex gap-3 items-start pr-4">
        <span className="text-xl leading-none mt-0.5 select-none" aria-hidden="true">⭐</span>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Enjoying StarMapper?</p>
          <p className="text-xs text-muted leading-relaxed">
            A star on GitHub takes 2 seconds and helps more devs find the tool.
          </p>
          <a
            href={GH_REPO}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md
                       bg-accent-green text-white hover:opacity-90 transition-opacity w-fit"
          >
            <Star size={12} aria-hidden="true" />
            Star on GitHub
          </a>
        </div>
      </div>
    </div>
  );
};
