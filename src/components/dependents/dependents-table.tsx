// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import Link from "next/link";
import { Star, GitFork, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { DependentsApiResponse } from "@/app/api/dependents/[owner]/[repo]/route";
import type { SortBy } from "@/lib/dependents";

type Props = {
  data: DependentsApiResponse;
  sortBy: SortBy;
  onSort: (by: SortBy) => void;
  onPage: (page: number) => void;
  owner: string;
  repo: string;
};

const formatCount = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

type SortIconProps = {
  col: SortBy;
  current: SortBy;
};

const SortIcon = ({ col, current }: SortIconProps) => {
  if (col !== current) return <ChevronsUpDown className="size-3.5 text-muted-subtle" />;
  return <ChevronDown className="size-3.5 text-accent-blue" />;
};

export const DependentsTable = ({ data, sortBy, onSort, onPage, owner, repo }: Props) => {
  const { dependents, packages, totalCount, page, totalPages, truncated } = data;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted">
          <span className="text-foreground font-medium">{formatCount(totalCount)}</span>
          {" "}dependent repo{totalCount !== 1 ? "s" : ""} found
          {packages.length > 0 && (
            <span className="ml-1.5">
              via{" "}
              {packages.slice(0, 2).map((pkg, i) => (
                <span key={pkg.name}>
                  {i > 0 && ", "}
                  <span className="font-mono text-foreground">{pkg.name}</span>
                  <span className="text-muted-subtle text-xs ml-0.5">({pkg.ecosystem})</span>
                </span>
              ))}
              {packages.length > 2 && <span className="text-muted-subtle"> +{packages.length - 2}</span>}
            </span>
          )}
          {truncated && (
            <span className="ml-1.5 text-xs text-muted-subtle">(top 500 shown)</span>
          )}
        </div>

        <Link
          href={`/${owner}/${repo}`}
          className="text-accent-blue hover:underline text-xs"
        >
          View map
        </Link>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Sort by:</span>
        {(["stars", "forks", "name"] as SortBy[]).map((col) => (
          <button
            key={col}
            onClick={() => onSort(col)}
            className={`flex items-center gap-0.5 px-2 py-1 rounded border transition-colors
              ${sortBy === col
                ? "border-accent-blue/50 text-foreground bg-accent-blue/5"
                : "border-border text-muted hover:text-foreground hover:border-border"
              }`}
          >
            {col === "stars" && <Star className="size-3" />}
            {col === "forks" && <GitFork className="size-3" />}
            {col}
            {sortBy === col && <ChevronDown className="size-3 ml-0.5 text-accent-blue" />}
            {sortBy !== col && <ChevronsUpDown className="size-3 ml-0.5 opacity-40" />}
          </button>
        ))}
      </div>

      {/* Table */}
      {dependents.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">No dependents on this page.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-muted font-medium">
                  <button
                    onClick={() => onSort("name")}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    Repository
                    <SortIcon col="name" current={sortBy} />
                  </button>
                </th>
                <th className="text-left px-4 py-3 text-muted font-medium hidden sm:table-cell">
                  Language
                </th>
                <th className="text-right px-4 py-3 text-muted font-medium">
                  <button
                    onClick={() => onSort("stars")}
                    className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors"
                  >
                    <SortIcon col="stars" current={sortBy} />
                    Stars
                  </button>
                </th>
                <th className="text-right px-4 py-3 text-muted font-medium hidden sm:table-cell">
                  <button
                    onClick={() => onSort("forks")}
                    className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors"
                  >
                    <SortIcon col="forks" current={sortBy} />
                    Forks
                  </button>
                </th>
                <th className="px-4 py-3 hidden md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {dependents.map((dep, i) => (
                <tr
                  key={dep.fullName}
                  className={`border-t border-border hover:bg-surface-alt transition-colors ${
                    i % 2 === 0 ? "bg-background" : "bg-surface/30"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <Link
                        href={`/${dep.owner}/${dep.repo}`}
                        className="font-medium text-foreground hover:text-accent-blue transition-colors truncate max-w-xs"
                        title={dep.fullName}
                      >
                        {dep.owner}/
                        <span className="font-semibold">{dep.repo}</span>
                      </Link>
                      {dep.description && (
                        <span className="text-xs text-muted mt-0.5 truncate max-w-sm hidden sm:block">
                          {dep.description}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {dep.language ? (
                      <span className="text-xs text-muted bg-surface border border-border rounded px-1.5 py-0.5">
                        {dep.language}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-1 text-muted">
                      <Star className="size-3.5 text-yellow-500/80" />
                      <span className="text-foreground font-medium">{formatCount(dep.stars)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    <span className="flex items-center justify-end gap-1 text-muted">
                      <GitFork className="size-3.5" />
                      <span>{formatCount(dep.forks)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <a
                      href={dep.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted hover:text-foreground transition-colors"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted pt-2">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              className="p-1.5 rounded border border-border hover:text-foreground hover:border-accent-blue/50 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="size-4" />
            </button>
            {(() => {
              const MAX = 5;
              let start: number;
              let end: number;
              if (totalPages <= MAX) {
                start = 1;
                end = totalPages;
              } else {
                start = Math.max(1, page - Math.floor(MAX / 2));
                end = Math.min(totalPages, start + MAX - 1);
                start = Math.max(1, end - MAX + 1);
              }
              return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => onPage(pageNum)}
                  className={`min-w-8 px-2 py-1 rounded border transition-colors text-xs
                    ${pageNum === page
                      ? "border-accent-blue/50 bg-accent-blue/10 text-foreground"
                      : "border-border hover:border-accent-blue/30 hover:text-foreground"
                    }`}
                >
                  {pageNum}
                </button>
              ));
            })()}
            <button
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              className="p-1.5 rounded border border-border hover:text-foreground hover:border-accent-blue/50 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Source attribution */}
      <p className="text-xs text-muted-subtle text-right pt-2">
        Data from{" "}
        <a
          href="https://ecosyste.ms"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-muted transition-colors"
        >
          ecosyste.ms
        </a>
        {" "}· updated {new Date(data.fetchedAt).toLocaleDateString()}
      </p>
    </div>
  );
};
