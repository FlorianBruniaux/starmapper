// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useMemo } from "react";
import { Star, Network, X, GitCommit } from "lucide-react";
import Link from "next/link";
import type { MappedRepo } from "@/app/api/repos/route";

const PAGE_SIZE = 20;

type SortCol = "totalCount" | "mappedPercent" | "countryCount" | "updatedAt" | "organicScore" | "dependentsCount";
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

const TIER_TEXT: Record<string, string> = {
  healthy:      "text-accent-green",
  moderate:     "text-accent-orange",
  suspicious:   "text-accent-red",
  insufficient: "text-muted",
};

const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => (
  <span aria-hidden="true" className={`ml-1 transition-opacity ${active ? "opacity-100" : "opacity-40"}`}>
    {active && dir === "asc" ? "↑" : "↓"}
  </span>
);

const ColHeader = ({
  label,
  col,
  active,
  dir,
  align = "right",
  tooltip,
  onSort,
}: {
  label: string;
  col: SortCol;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  tooltip?: string;
  onSort: (col: SortCol) => void;
}) => (
  <th
    scope="col"
    className={`py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium cursor-pointer select-none hover:text-muted transition-colors ${align === "right" ? "text-right" : "text-left"}`}
    onClick={() => onSort(col)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort(col); } }}
    tabIndex={0}
    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
  >
    <span className="relative inline-flex items-center gap-1 group/tip">
      {label}
      <SortIcon active={active} dir={dir} />
      {tooltip && (
        <span className="pointer-events-none absolute top-full right-0 mt-2 w-56 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
          {tooltip}
        </span>
      )}
    </span>
  </th>
);

export const RepoTable = ({ repos }: { repos: MappedRepo[] }) => {
  const [sortCol, setSortCol] = useState<SortCol>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [filterLanguage, setFilterLanguage] = useState<string | null>(null);
  const [filterHasDeps, setFilterHasDeps] = useState(false);
  const [filterHasScore, setFilterHasScore] = useState(false);

  const topLanguages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang]) => lang);
  }, [repos]);

  const handleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
    setPage(0);
  };

  const handleFilter = (key: "language" | "hasDeps" | "hasScore", value: string | boolean) => {
    if (key === "language") setFilterLanguage(filterLanguage === value ? null : (value as string));
    if (key === "hasDeps") setFilterHasDeps(!filterHasDeps);
    if (key === "hasScore") setFilterHasScore(!filterHasScore);
    setPage(0);
  };

  const filtered = useMemo(() => {
    return repos.filter((r) => {
      if (filterLanguage && r.language !== filterLanguage) return false;
      if (filterHasDeps && !(r.dependentsCount != null && r.dependentsCount > 0)) return false;
      if (filterHasScore && r.organicScore === null) return false;
      return true;
    });
  }, [repos, filterLanguage, filterHasDeps, filterHasScore]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const hasActiveFilters = filterLanguage !== null || filterHasDeps || filterHasScore;
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="w-full space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-subtle uppercase tracking-wider">Filter:</span>
        <button
          onClick={() => handleFilter("hasDeps", true)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            filterHasDeps
              ? "border-accent-blue/60 bg-accent-blue/10 text-accent-blue"
              : "border-border text-muted hover:border-border hover:text-foreground"
          }`}
        >
          Has dependents
        </button>
        <button
          onClick={() => handleFilter("hasScore", true)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            filterHasScore
              ? "border-accent-blue/60 bg-accent-blue/10 text-accent-blue"
              : "border-border text-muted hover:border-border hover:text-foreground"
          }`}
        >
          Has score
        </button>
        <div className="w-px h-4 bg-border-subtle mx-1 hidden sm:block" aria-hidden="true" />
        {topLanguages.map((lang) => (
          <button
            key={lang}
            onClick={() => handleFilter("language", lang)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filterLanguage === lang
                ? "border-accent-blue/60 bg-accent-blue/10 text-accent-blue"
                : "border-border text-muted hover:border-border hover:text-foreground"
            }`}
          >
            {lang}
          </button>
        ))}
        {hasActiveFilters && (
          <button
            onClick={() => { setFilterLanguage(null); setFilterHasDeps(false); setFilterHasScore(false); setPage(0); }}
            className="ml-1 text-xs text-muted-subtle hover:text-foreground flex items-center gap-0.5 transition-colors"
          >
            <X size={12} aria-hidden="true" /> Clear
          </button>
        )}
        {hasActiveFilters && (
          <span className="text-xs text-muted-subtle ml-auto">
            {sorted.length} / {repos.length}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Community stargazer maps, sortable by column</caption>
        <thead>
          <tr className="border-b border-border-subtle">
            <th scope="col" className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-left">
              Repo
            </th>
            <th scope="col" className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-left hidden sm:table-cell">
              Main language
            </th>
            <ColHeader label="Stars" col="totalCount" active={sortCol === "totalCount"} dir={sortDir} onSort={handleSort}
              tooltip="Total GitHub star count at the time of the last scan." />
            <ColHeader label="Mapped" col="mappedPercent" active={sortCol === "mappedPercent"} dir={sortDir} onSort={handleSort}
              tooltip="% of stargazers whose location was resolved to GPS coordinates. Depends on how many users filled in a location on their GitHub profile." />
            <ColHeader label="Countries" col="countryCount" active={sortCol === "countryCount"} dir={sortDir} onSort={handleSort}
              tooltip="Number of distinct countries represented in the stargazer base." />
            <ColHeader label="Score" col="organicScore" active={sortCol === "organicScore"} dir={sortDir} onSort={handleSort}
              tooltip="Organic Score (0–100). Experimental heuristic estimating whether the star count reflects real usage or was inflated. Based on fork ratio, watcher ratio, and % zero-follower accounts. Only computed for repos with 5 000+ stars." />
            <th scope="col" className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-right hidden lg:table-cell cursor-pointer select-none hover:text-muted transition-colors"
              onClick={() => handleSort("dependentsCount")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSort("dependentsCount"); } }}
              tabIndex={0}
              aria-sort={sortCol === "dependentsCount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
            >
              <span className="relative inline-flex items-center gap-1 group/tip justify-end">
                Deps
                <SortIcon active={sortCol === "dependentsCount"} dir={sortDir} />
                <span className="pointer-events-none absolute top-full right-0 mt-2 w-56 rounded-lg bg-surface border border-border px-3 py-2 text-xs text-foreground leading-relaxed shadow-xl opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 whitespace-normal font-normal normal-case tracking-normal">
                  Number of open-source repos depending on this library, tracked by ecosyste.ms. Only shown for published packages.
                </span>
              </span>
            </th>
            <th scope="col" className="py-2.5 px-4 text-xs uppercase tracking-wider text-muted-subtle font-medium text-right hidden md:table-cell">
              Contributors
            </th>
            <ColHeader label="Last scan" col="updatedAt" active={sortCol === "updatedAt"} dir={sortDir} onSort={handleSort}
              tooltip="When StarMapper last fetched and geocoded this repo's stargazers." />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr
              key={`${r.owner}/${r.repo}`}
              className="border-b border-border-subtle/50 hover:bg-surface transition-colors group"
            >
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
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
                </div>
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
                  <Star size={11} className="text-accent-orange/50 shrink-0" aria-hidden="true" />
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
              <td className="py-3 px-4 text-right tabular-nums">
                {r.organicScore !== null && r.organicTier ? (
                  <span className={`text-xs font-semibold ${TIER_TEXT[r.organicTier] ?? "text-muted"}`}>
                    {r.organicScore}
                  </span>
                ) : (
                  <span className="text-xs text-muted-subtle">—</span>
                )}
              </td>
              <td className="py-3 px-4 text-right hidden lg:table-cell">
                {r.dependentsCount != null && r.dependentsCount > 0 ? (
                  <Link
                    href={`/${r.owner}/${r.repo}/dependents`}
                    className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline"
                    onClick={(e) => e.stopPropagation()}
                    title={`${r.dependentsCount} dependent repos`}
                  >
                    <Network size={11} aria-hidden="true" />
                    {formatCount(r.dependentsCount)}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-subtle">—</span>
                )}
              </td>
              <td className="py-3 px-4 text-right hidden md:table-cell">
                <Link
                  href={`/${r.owner}/${r.repo}/contributors`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline"
                  title="Contributors map"
                >
                  <GitCommit size={11} aria-hidden="true" />
                  {r.contributorsCount != null ? formatCount(r.contributorsCount) : "Map"}
                </Link>
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
    </div>
  );
};
