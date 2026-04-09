// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { MappedRepo } from "@/app/api/repos/route";

const PAGE_SIZE = 20;

type SortCol = "totalCount" | "mappedPercent" | "countryCount" | "updatedAt";
type SortDir = "asc" | "desc";

const formatCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => (
  <span className={`ml-1 transition-opacity ${active ? "opacity-100" : "opacity-40"}`}>
    {active && dir === "asc" ? "↑" : "↓"}
  </span>
);

const ColHeader = ({
  label,
  col,
  active,
  dir,
  align = "right",
  onSort,
}: {
  label: string;
  col: SortCol;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onSort: (col: SortCol) => void;
}) => (
  <th
    className={`py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium cursor-pointer select-none hover:text-muted transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    onClick={() => onSort(col)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(col); } }}
    tabIndex={0}
    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
  >
    {label}
    <SortIcon active={active} dir={dir} />
  </th>
);

export const RepoTable = ({ repos }: { repos: MappedRepo[] }) => {
  const [sortCol, setSortCol] = useState<SortCol>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const handleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
    setPage(0);
  };

  const sorted = useMemo(() => {
    return [...repos].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [repos, sortCol, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Community stargazer maps, sortable by column</caption>
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-left">
              Repo
            </th>
            <th className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-left hidden sm:table-cell">
              Main language
            </th>
            <ColHeader label="Stars" col="totalCount" active={sortCol === "totalCount"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Mapped" col="mappedPercent" active={sortCol === "mappedPercent"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Countries" col="countryCount" active={sortCol === "countryCount"} dir={sortDir} onSort={handleSort} />
            <ColHeader label="Last scan" col="updatedAt" active={sortCol === "updatedAt"} dir={sortDir} onSort={handleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr
              key={`${r.owner}/${r.repo}`}
              className="border-b border-border-subtle/50 hover:bg-surface transition-colors group"
            >
              <td className="py-3 px-4">
                <Link
                  href={`/${r.owner}/${r.repo}`}
                  className="inline-flex items-baseline gap-0.5 group/link"
                >
                  <span className="text-xs text-muted-subtle">{r.owner}</span>
                  <span className="text-xs text-muted-subtle">/</span>
                  <span className="text-sm text-foreground font-medium group-hover/link:text-accent-blue transition-colors">
                    {r.repo}
                  </span>
                </Link>
              </td>
              <td className="py-3 px-4 hidden sm:table-cell">
                {r.language ? (
                  <Link
                    href={`/devs/${encodeURIComponent(r.language.toLowerCase())}`}
                    className="text-xs text-muted bg-surface-alt border border-border-subtle rounded px-2 py-0.5 hover:border-accent-blue/40 hover:text-foreground transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.language}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-subtle">—</span>
                )}
              </td>
              <td className="py-3 px-4 text-right tabular-nums">
                <span className="inline-flex items-center justify-end gap-1 text-xs text-muted">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="text-accent-orange/50 shrink-0" aria-hidden="true">
                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
                  </svg>
                  {formatCount(r.totalCount)}
                </span>
              </td>
              <td className="py-3 px-4 text-right tabular-nums">
                <span
                  className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                    r.mappedPercent >= 50
                      ? "text-accent-green bg-accent-green/10"
                      : r.mappedPercent >= 25
                      ? "text-accent-orange bg-accent-orange/10"
                      : "text-muted bg-muted/10"
                  }`}
                >
                  {r.mappedPercent}%
                </span>
              </td>
              <td className="py-3 px-4 text-right text-xs tabular-nums text-muted">
                {r.countryCount}
              </td>
              <td className="py-3 px-4 text-right text-xs whitespace-nowrap text-muted-subtle" title={r.updatedAt}>
                {timeAgo(r.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-xs text-muted-subtle">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="px-2.5 py-1 text-xs rounded border border-border text-muted hover:text-foreground hover:border-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted-subtle px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1 text-xs rounded border border-border text-muted hover:text-foreground hover:border-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
