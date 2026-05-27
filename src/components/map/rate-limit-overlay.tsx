// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useRef } from "react";
import type { ScanStatus } from "@/hooks/useScanController";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type Props = {
  status: ScanStatus;
  waitReason: string | null;
  retryIn: number;
  retryTotal: number;
};

export const RateLimitOverlay = ({ status, waitReason, retryIn, retryTotal }: Props) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, status === "waiting");

  if (status !== "waiting") return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/75 backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-wait-title"
        className="bg-surface border border-border rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-center"
      >
        <div className="flex justify-center mb-5" aria-hidden="true">
          <svg className="animate-spin motion-reduce:animate-none w-10 h-10 text-accent-blue" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        </div>
        <h2 id="rate-wait-title" className="text-foreground font-semibold text-base mb-1">
          {waitReason === "github" ? "GitHub quota reached" : "Server busy"}
        </h2>
        <p className="text-muted text-sm mb-5">
          {waitReason === "github"
            ? "GitHub API rate limit hit. Resuming automatically when quota resets in"
            : "Too many scans running at once. Resuming automatically in"}
        </p>
        <div
          className="text-5xl font-bold text-accent-blue tabular-nums mb-5"
          aria-live="polite"
          aria-atomic="true"
        >
          {retryIn}
        </div>
        <div
          role="progressbar"
          aria-valuenow={retryTotal > 0 ? retryTotal - retryIn : 0}
          aria-valuemin={0}
          aria-valuemax={retryTotal}
          aria-label="Time until retry"
          className="w-full bg-surface-alt rounded-full h-1 overflow-hidden"
        >
          <div
            className="bg-accent-blue h-full rounded-full transition-all duration-1000 motion-reduce:transition-none"
            style={{ width: retryTotal > 0 ? `${((retryTotal - retryIn) / retryTotal) * 100}%` : "0%" }}
          />
        </div>
        <p className="text-muted-subtle text-xs mt-4">Your progress is saved. No need to do anything.</p>
      </div>
    </div>
  );
};
