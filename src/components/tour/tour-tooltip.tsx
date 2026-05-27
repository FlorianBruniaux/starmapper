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
// Minimum safe margin from viewport edges
const EDGE = 8;

/**
 * Picks the best placement based on available space around the target.
 *
 * Priority on mobile (vw < 640): below > above (never left/right — too narrow).
 * Priority on desktop: honours the step's declared placement, but falls back
 * to whichever vertical side has more room when the preferred side would clip.
 *
 * Returns absolute {top, left} coordinates for a position:fixed element,
 * guaranteed to stay within the safe viewport area.
 */
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
  const isMobile = vw < 640;

  // Available space in each direction (pixels between element edge and viewport edge)
  const spaceBelow = vh - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;
  const spaceRight = vw - rect.right - GAP;
  const spaceLeft = rect.left - GAP;

  // Horizontal center of the target, used for top/bottom placement
  const centerX = rect.left + rect.width / 2;
  // Vertical center of the target, used for left/right placement
  const centerY = rect.top + rect.height / 2;

  // Whether the tooltip fits in each direction without clipping
  const fitsBelow = spaceBelow >= TOOLTIP_H_APPROX;
  const fitsAbove = spaceAbove >= TOOLTIP_H_APPROX;
  const fitsRight = !isMobile && spaceRight >= TOOLTIP_W;
  const fitsLeft = !isMobile && spaceLeft >= TOOLTIP_W;

  // Resolve the effective side. On mobile we only allow top/bottom.
  // If the preferred side doesn't fit, pick the side with more room.
  let side: "top" | "bottom" | "left" | "right";

  if (isMobile) {
    // Mobile: prefer below, fall back to above regardless of declared placement
    side = fitsBelow ? "bottom" : "top";
  } else if (placement === "bottom") {
    side = fitsBelow ? "bottom" : (spaceAbove >= spaceBelow ? "top" : "bottom");
  } else if (placement === "top") {
    side = fitsAbove ? "top" : (spaceBelow >= spaceAbove ? "bottom" : "top");
  } else if (placement === "right") {
    if (fitsRight) {
      side = "right";
    } else if (fitsLeft) {
      side = "left";
    } else {
      // Fall back to whichever vertical side has more room
      side = spaceBelow >= spaceAbove ? "bottom" : "top";
    }
  } else {
    // placement === "left"
    if (fitsLeft) {
      side = "left";
    } else if (fitsRight) {
      side = "right";
    } else {
      side = spaceBelow >= spaceAbove ? "bottom" : "top";
    }
  }

  let top = 0;
  let left = 0;

  if (side === "bottom") {
    top = rect.bottom + GAP;
    left = centerX - TOOLTIP_W / 2;
  } else if (side === "top") {
    top = rect.top - TOOLTIP_H_APPROX - GAP;
    left = centerX - TOOLTIP_W / 2;
  } else if (side === "right") {
    top = centerY - TOOLTIP_H_APPROX / 2;
    left = rect.right + GAP;
  } else {
    // left
    top = centerY - TOOLTIP_H_APPROX / 2;
    left = rect.left - TOOLTIP_W - GAP;
  }

  // Clamp to safe viewport bounds — ensures the tooltip never clips any edge
  left = Math.max(EDGE, Math.min(left, vw - TOOLTIP_W - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - TOOLTIP_H_APPROX - EDGE));

  // Final guard: if the clamped top position still overlaps the target element,
  // force it to whichever side of the element leaves more room.
  const overlapsTarget =
    top < rect.bottom && top + TOOLTIP_H_APPROX > rect.top;

  if (overlapsTarget) {
    if (spaceBelow >= spaceAbove) {
      top = Math.min(rect.bottom + GAP, vh - TOOLTIP_H_APPROX - EDGE);
    } else {
      top = Math.max(rect.top - TOOLTIP_H_APPROX - GAP, EDGE);
    }
    // Re-clamp after adjustment
    top = Math.max(EDGE, Math.min(top, vh - TOOLTIP_H_APPROX - EDGE));
  }

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
