// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatMonthBucket = (bucket: string): string => {
  const [year, month] = bucket.split("-");
  return `${MONTHS[parseInt(month, 10) - 1]} ${year}`;
};

type Props = {
  monthBuckets: string[];
  currentIndex: number;
  autoPlay: boolean;
  visibleCount: number;
  onIndexChange: (i: number) => void;
  onAutoPlayToggle: () => void;
  onClose: () => void;
};

export const TimelapseBar = ({
  monthBuckets,
  currentIndex,
  autoPlay,
  visibleCount,
  onIndexChange,
  onAutoPlayToggle,
  onClose,
}: Props) => {
  if (monthBuckets.length === 0) return null;

  const currentLabel = formatMonthBucket(monthBuckets[currentIndex] ?? monthBuckets[0]);
  const isLast = currentIndex >= monthBuckets.length - 1;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      <div className="bg-background/95 border border-border rounded-xl px-4 py-3 backdrop-blur-md shadow-lg flex flex-col gap-2 w-72">

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-2xs text-muted-subtle uppercase tracking-widest">Timelapse</span>
          <button
            onClick={onClose}
            aria-label="Close timelapse"
            className="text-muted hover:text-foreground transition-colors p-0.5 rounded"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Month label + star count */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-foreground">{currentLabel}</span>
          <span className="text-xs text-muted tabular-nums">{visibleCount.toLocaleString()} stars</span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min={0}
          max={monthBuckets.length - 1}
          step={1}
          value={currentIndex}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="sm-slider w-full"
          aria-label="Timelapse month"
        />

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-2xs text-muted-subtle">
            <span>{formatMonthBucket(monthBuckets[0])}</span>
            <span className="mx-1">→</span>
            <span>{formatMonthBucket(monthBuckets[monthBuckets.length - 1])}</span>
          </div>
          <button
            onClick={onAutoPlayToggle}
            disabled={isLast && !autoPlay}
            aria-label={autoPlay ? "Pause timelapse" : "Play timelapse"}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
              autoPlay
                ? "bg-accent-blue/15 text-accent-blue"
                : isLast
                  ? "text-muted-subtle cursor-not-allowed"
                  : "text-muted hover:text-foreground hover:bg-surface"
            }`}
          >
            {autoPlay ? (
              <>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 3h2.5v10H4V3zm5.5 0H12v10H9.5V3z" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M3.5 2.5l10 5.5-10 5.5V2.5z" />
                </svg>
                Play
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
