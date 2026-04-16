// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// weekBucket = YYYY-MM-DD of the Monday of that week
const formatWeekBucket = (bucket: string): string => {
  const d = new Date(bucket + "T00:00:00Z");
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export const TIMELAPSE_SPEEDS = [
  { label: "Slow", ms: 1200 },
  { label: "Normal", ms: 800 },
  { label: "Fast", ms: 300 },
] as const;

export type TimelapseSpeed = (typeof TIMELAPSE_SPEEDS)[number]["ms"];

type Props = {
  weekBuckets: string[];   // YYYY-MM-DD (Monday of each week with at least 1 star)
  currentIndex: number;
  autoPlay: boolean;
  speed: TimelapseSpeed;
  visibleCount: number;
  onIndexChange: (i: number) => void;
  onAutoPlayToggle: () => void;
  onSpeedChange: (ms: TimelapseSpeed) => void;
  onClose: () => void;
};

export const TimelapseBar = ({
  weekBuckets,
  currentIndex,
  autoPlay,
  speed,
  visibleCount,
  onIndexChange,
  onAutoPlayToggle,
  onSpeedChange,
  onClose,
}: Props) => {
  if (weekBuckets.length === 0) return null;

  const currentLabel = formatWeekBucket(weekBuckets[currentIndex] ?? weekBuckets[0]);
  const isLast = currentIndex >= weekBuckets.length - 1;

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
      <div className="bg-background/95 border border-border rounded-xl px-4 py-3 backdrop-blur-md shadow-lg flex flex-col gap-2 w-80">

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

        {/* Week label + star count */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-foreground">{currentLabel}</span>
          <span className="text-xs text-muted tabular-nums">{visibleCount.toLocaleString()} stars</span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min={0}
          max={weekBuckets.length - 1}
          step={1}
          value={currentIndex}
          onChange={(e) => onIndexChange(Number(e.target.value))}
          className="sm-slider w-full"
          aria-label="Timelapse week"
        />

        {/* Controls row */}
        <div className="flex items-center justify-between gap-2">
          {/* Date range */}
          <div className="flex items-center gap-1 text-2xs text-muted-subtle min-w-0 truncate">
            <span>{formatWeekBucket(weekBuckets[0])}</span>
            <span>→</span>
            <span>{formatWeekBucket(weekBuckets[weekBuckets.length - 1])}</span>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Speed selector */}
            <div className="flex rounded-md border border-border overflow-hidden">
              {TIMELAPSE_SPEEDS.map(({ label, ms }) => (
                <button
                  key={ms}
                  onClick={() => onSpeedChange(ms)}
                  className={`text-2xs px-1.5 py-0.5 transition-colors ${
                    speed === ms
                      ? "bg-surface-alt text-foreground"
                      : "text-muted-subtle hover:text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Play / Pause */}
            <button
              onClick={onAutoPlayToggle}
              disabled={isLast && !autoPlay}
              aria-label={autoPlay ? "Pause timelapse" : "Play timelapse"}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md transition-colors ${
                autoPlay
                  ? "bg-accent-blue/15 text-accent-blue"
                  : isLast
                    ? "text-muted-subtle cursor-not-allowed"
                    : "text-muted hover:text-foreground hover:bg-surface"
              }`}
            >
              {autoPlay ? (
                <>
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M4 3h2.5v10H4V3zm5.5 0H12v10H9.5V3z" />
                  </svg>
                  Pause
                </>
              ) : (
                <>
                  <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M3.5 2.5l10 5.5-10 5.5V2.5z" />
                  </svg>
                  Play
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
