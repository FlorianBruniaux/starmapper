// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TourStep } from "@/lib/tour-steps";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

type Props = {
  step: TourStep;
  currentIndex: number;
  totalSteps: number;
  targetRect: Rect | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
};

const TOOLTIP_W = 288;
const TOOLTIP_H_APPROX = 210;
const GAP = 12;

const computePosition = (
  rect: Rect | null,
  placement: TourStep["placement"],
): { top: number; left: number } => {
  if (!rect || placement === "center") {
    return {
      top: (window.innerHeight - TOOLTIP_H_APPROX) / 2,
      left: (window.innerWidth - TOOLTIP_W) / 2,
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;

  if (placement === "bottom") {
    top = rect.bottom + GAP;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else if (placement === "top") {
    top = rect.top - TOOLTIP_H_APPROX - GAP;
    left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else if (placement === "right") {
    top = rect.top + rect.height / 2 - TOOLTIP_H_APPROX / 2;
    left = rect.right + GAP;
    // Element near viewport bottom: anchor tooltip bottom to element bottom
    if (top + TOOLTIP_H_APPROX > vh - 8) {
      top = rect.bottom - TOOLTIP_H_APPROX;
    }
  } else {
    top = rect.top + rect.height / 2 - TOOLTIP_H_APPROX / 2;
    left = rect.left - TOOLTIP_W - GAP;
    if (top + TOOLTIP_H_APPROX > vh - 8) {
      top = rect.bottom - TOOLTIP_H_APPROX;
    }
  }

  // Clamp to viewport
  left = Math.max(8, Math.min(left, vw - TOOLTIP_W - 8));
  top = Math.max(8, Math.min(top, vh - TOOLTIP_H_APPROX - 8));

  return { top, left };
};

export const TourTooltip = ({ step, currentIndex, totalSteps, targetRect, onNext, onPrev, onSkip }: Props) => {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalSteps - 1;
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstFocusRef.current?.focus();
  }, [currentIndex]);

  const { top, left } = computePosition(targetRect, step.placement);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${currentIndex + 1} of ${totalSteps}: ${step.title}`}
      className="fixed z-[61] w-72 bg-surface border border-border rounded-xl shadow-2xl
                 animate-in fade-in zoom-in-95 duration-150"
      style={{ top, left }}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-0 gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-2xs text-muted-subtle tabular-nums">
            {currentIndex + 1} of {totalSteps}
          </span>
          <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
        </div>
        <button
          onClick={onSkip}
          aria-label="Close tour"
          className="text-muted-subtle hover:text-foreground transition-colors shrink-0 mt-0.5 p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <p className="text-xs text-muted leading-relaxed px-4 pt-2 pb-3">{step.description}</p>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="h-0.5 bg-surface-alt rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-blue rounded-full transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-4 gap-2">
        <button
          onClick={onPrev}
          disabled={isFirst}
          className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors
                     disabled:opacity-0 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 rounded"
          aria-label="Previous step"
        >
          <ChevronLeft size={12} aria-hidden="true" />
          Back
        </button>
        <button
          ref={firstFocusRef}
          onClick={onNext}
          className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40 ${
            isLast
              ? "bg-accent-green text-white hover:opacity-90"
              : "bg-accent-blue text-white hover:opacity-90"
          }`}
          aria-label={isLast ? "Finish tour" : "Next step"}
        >
          {isLast ? "Done" : (
            <>
              Next
              <ChevronRight size={12} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
