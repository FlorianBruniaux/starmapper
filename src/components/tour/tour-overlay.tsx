// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TourStep } from "@/lib/tour-steps";
import { TourTooltip } from "@/components/tour/tour-tooltip";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

type Props = {
  step: TourStep;
  currentIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
};

const PAD = 8;

const getRect = (selector: string): Rect | null => {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    right: r.right + PAD,
    bottom: r.bottom + PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
};

const buildClipPath = (rect: Rect): string => {
  const { top, left, right, bottom } = rect;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return `polygon(0px 0px, 0px ${vh}px, ${left}px ${vh}px, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${vh}px, ${vw}px ${vh}px, ${vw}px 0px)`;
};

export const TourOverlay = ({ step, currentIndex, totalSteps, onNext, onPrev, onSkip }: Props) => {
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const updateRect = () => {
    setRect(step.placement === "center" ? null : getRect(step.selector));
  };

  // Scroll element into view, then measure
  useLayoutEffect(() => {
    if (step.placement === "center") { setRect(null); return; }
    const el = document.querySelector(step.selector);
    if (el) {
      const r = el.getBoundingClientRect();
      const inView = r.top >= 0 && r.bottom <= window.innerHeight;
      if (!inView) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Re-measure after scroll settles
        const t = setTimeout(updateRect, 400);
        return () => clearTimeout(t);
      }
    }
    updateRect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.selector, step.placement]);

  // Keep position in sync with scroll and resize
  useEffect(() => {
    const tick = () => {
      updateRect();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => updateRect();
    window.addEventListener("resize", onResize);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      observerRef.current?.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.selector]);

  const clipPath = rect ? buildClipPath(rect) : undefined;

  return (
    <>
      {/* Backdrop with hole cut out via clip-path */}
      <div
        className="fixed inset-0 z-tour-overlay bg-black/60 transition-all duration-200"
        style={clipPath ? { clipPath } : undefined}
        onClick={onSkip}
        aria-hidden="true"
      />

      {/* Highlight ring around the target element */}
      {rect && (
        <div
          className="fixed z-tour-overlay rounded-lg pointer-events-none ring-2 ring-accent-blue/70 transition-all duration-200"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden="true"
        />
      )}

      <TourTooltip
        step={step}
        currentIndex={currentIndex}
        totalSteps={totalSteps}
        targetRect={rect}
        onNext={onNext}
        onPrev={onPrev}
        onSkip={onSkip}
      />
    </>
  );
};
