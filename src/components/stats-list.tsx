// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

type StatsListProps = { items: [string, number][]; max: number };

export const StatsList = ({ items, max }: StatsListProps) => (
  <div className="space-y-2">
    {items.map(([name, count]) => (
      <div key={name} className="flex items-center gap-3">
        <div className="text-foreground text-xs w-36 truncate flex-shrink-0">{name}</div>
        <div className="flex-1 bg-surface-alt rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-accent-blue h-full rounded-full"
            style={{ width: `${(count / max) * 100}%` }}
          />
        </div>
        <span className="text-muted text-xs w-8 text-right flex-shrink-0">{count}</span>
      </div>
    ))}
  </div>
);
