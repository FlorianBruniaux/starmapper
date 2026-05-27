// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useTour } from "@/components/tour/use-tour";
import { resetTour } from "@/lib/tour-storage";
import type { TourId } from "@/lib/tour-storage";

type Props = {
  tourId: TourId;
  label?: string;
  className?: string;
};

export const TourTrigger = ({ tourId, label = "Tour", className }: Props) => {
  const { startTour } = useTour();

  const handleClick = () => {
    resetTour(tourId);
    startTour(tourId);
  };

  return (
    <button
      onClick={handleClick}
      aria-label={`Start ${tourId} tour`}
      className={
        className ??
        "flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
      }
    >
      <span className="text-base leading-none select-none" aria-hidden="true">?</span>
      <span>{label}</span>
    </button>
  );
};
