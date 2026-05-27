// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";

export const GrowthChart = ({ data }: { data: [string, number][] }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(...data.map(([, v]) => v));
  const H = 120;
  const W = 600;
  const barW = Math.max(2, Math.floor((W - data.length) / data.length));
  const gap = Math.max(1, Math.floor(W / data.length) - barW);
  const labelStep = Math.ceil(data.length / 10);
  const total = data.reduce((s, [, v]) => s + v, 0);
  const avg = Math.round(total / data.length);
  const avgY = H - (avg / max) * H;
  const peak = data.reduce((best, cur) => cur[1] > best[1] ? cur : best, data[0]);

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;
  const hoveredX = hoveredIdx !== null ? hoveredIdx * (barW + gap) : 0;
  const tooltipW = 100;
  const tooltipX = Math.min(hoveredX, W - tooltipW - 4);
  const tooltipY = hoveredItem ? H - (hoveredItem[1] / max) * H - 40 : 0;

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-foreground">{total.toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">total stars</div>
        </div>
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-accent-blue">{peak[1].toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">best week</div>
        </div>
        <div className="bg-background rounded-lg px-3 py-2 text-center flex-1">
          <div className="text-lg font-bold text-accent-orange">{avg.toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">avg / week</div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="w-full"
        style={{ height: H + 20 }}
        onMouseLeave={() => setHoveredIdx(null)}
        role="img"
        aria-label={`Star growth chart: ${total.toLocaleString()} total stars, peak week ${peak[1].toLocaleString()} stars on ${peak[0]}, average ${avg.toLocaleString()} per week`}
      >
        <title>Star growth chart</title>
        {/* Average line */}
        <line
          x1={0} y1={avgY} x2={W} y2={avgY}
          stroke="var(--color-accent-orange)" strokeWidth={1} strokeDasharray="5,4" opacity={0.5}
        />
        <text x={W - 2} y={avgY - 3} fontSize={7} fill="var(--color-accent-orange)" textAnchor="end" opacity={0.7}>avg</text>

        {data.map(([date, count], i) => {
          const barH = Math.max(2, (count / max) * H);
          const x = i * (barW + gap);
          const isPeak = date === peak[0];
          const isHovered = i === hoveredIdx;
          return (
            <g key={date}>
              <rect
                x={x} y={H - barH} width={barW} height={barH}
                fill={isPeak ? "var(--color-accent-orange)" : "var(--color-accent-blue)"}
                opacity={isHovered ? 1 : isPeak ? 0.9 : 0.65}
                rx={1}
              />
              {/* Invisible wider hit area for hover */}
              <rect
                x={x - Math.max(1, gap / 2)} y={0} width={barW + Math.max(1, gap)} height={H}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
              />
              {i % labelStep === 0 && (
                <text x={x} y={H + 14} fontSize={8} fill="var(--color-muted-subtle)" textAnchor="middle" dx={barW / 2}>
                  {date.slice(5)}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hoveredItem && (
          <g>
            <rect
              x={tooltipX} y={Math.max(2, tooltipY)} width={tooltipW} height={30}
              rx={4} fill="var(--color-surface-alt)" stroke="var(--color-border)" strokeWidth={1}
            />
            <text x={tooltipX + 8} y={Math.max(14, tooltipY + 12)} fontSize={8} fill="var(--color-muted)">
              {hoveredItem[0].slice(5)}
            </text>
            <text x={tooltipX + 8} y={Math.max(26, tooltipY + 24)} fontSize={9} fill="var(--color-foreground)" fontWeight="bold">
              {hoveredItem[1].toLocaleString()} stars
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
