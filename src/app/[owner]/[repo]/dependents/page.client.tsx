// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Header } from "@/components/header";
import { DependentsTable } from "@/components/dependents/dependents-table";
import type { DependentsApiResponse } from "@/app/api/dependents/[owner]/[repo]/route";
import type { SortBy } from "@/lib/dependents";

type Props = {
  params: Promise<{ owner: string; repo: string }>;
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "refreshing" }
  | { status: "done"; data: DependentsApiResponse }
  | { status: "no_package" }
  | { status: "error"; message: string };

export default function DependentsPageClient({ params }: Props) {
  const { owner, repo } = use(params);

  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [sortBy, setSortBy] = useState<SortBy>("stars");
  const [page, setPage] = useState(1);

  const loadDependents = useCallback(
    async (sort: SortBy, p: number, triggerRefreshOnMiss = true) => {
      setState((prev) => (prev.status === "done" ? { status: "refreshing" } : { status: "loading" }));
      const ac = new AbortController();

      try {
        const res = await fetch(
          `/api/dependents/${owner}/${repo}?sort=${sort}&page=${p}&per_page=50`,
          { signal: ac.signal },
        );

        if (res.ok) {
          const data = await res.json() as DependentsApiResponse;
          setState({ status: "done", data });
          return;
        }

        if (res.status === 404 && triggerRefreshOnMiss) {
          // Cache miss — trigger a fresh fetch from ecosyste.ms, then reload
          setState({ status: "refreshing" });
          const refreshRes = await fetch(`/api/dependents/${owner}/${repo}/refresh`, {
            method: "POST",
            signal: ac.signal,
          });

          if (!refreshRes.ok) {
            const err = await refreshRes.json() as { error?: string };
            if (err.error === "feature_disabled") {
              setState({ status: "error", message: "feature_disabled" });
              return;
            }
            // No packages found for this repo
            setState({ status: "no_package" });
            return;
          }

          const refreshData = await refreshRes.json() as { totalCount: number };
          if (refreshData.totalCount === 0) {
            setState({ status: "no_package" });
            return;
          }

          // Now reload from cache
          await loadDependents(sort, p, false);
          return;
        }

        setState({ status: "error", message: `HTTP ${res.status}` });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error", message: "network_error" });
      }

      return () => ac.abort();
    },
    [owner, repo],
  );

  useEffect(() => {
    void loadDependents(sortBy, page);
  }, [loadDependents, sortBy, page]);

  const handleSort = (by: SortBy) => {
    setSortBy(by);
    setPage(1);
  };

  const handlePage = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRefresh = () => {
    void loadDependents(sortBy, page, true);
  };

  const isLoading = state.status === "loading" || state.status === "refreshing";
  const showRefreshing = state.status === "refreshing";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header
        sticky
        backLink={`/${owner}/${repo}`}
        afterLogo={
          <span className="text-sm text-muted hidden sm:inline">
            <Link href={`/${owner}/${repo}`} className="hover:text-foreground transition-colors">
              {owner}/{repo}
            </Link>
            <span className="mx-1 text-muted-subtle">/</span>
            <span className="text-foreground">dependents</span>
          </span>
        }
        showNav
      />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Dependent repos
            </h1>
            <p className="text-sm text-muted mt-0.5">
              Open-source projects that use{" "}
              <span className="text-foreground font-mono">{owner}/{repo}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            {state.status === "done" && state.data.truncated && (
              <span className="text-xs text-muted border border-border rounded px-2 py-1">
                top {state.data.dependents.length * state.data.totalPages} shown
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-sm text-muted border border-border rounded-md px-3 py-1.5
                         hover:text-foreground hover:border-accent-blue/50 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`size-3.5 ${showRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Loading */}
        {state.status === "loading" && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 text-muted animate-spin" />
            <span className="ml-2 text-muted text-sm">Loading dependents from ecosyste.ms...</span>
          </div>
        )}

        {/* Refreshing overlay */}
        {state.status === "refreshing" && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 text-muted animate-spin" />
            <span className="ml-2 text-muted text-sm">Fetching from ecosyste.ms, this may take a few seconds...</span>
          </div>
        )}

        {/* No package found */}
        {state.status === "no_package" && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="size-8 text-muted mb-3" />
            <p className="text-foreground font-medium">No package found</p>
            <p className="text-muted text-sm mt-1 max-w-sm">
              This repo doesn&apos;t appear to publish a package tracked by ecosyste.ms.
              Dependents are only available for published libraries.
            </p>
            <Link
              href={`/${owner}/${repo}`}
              className="mt-4 flex items-center gap-1.5 text-sm text-accent-blue hover:underline"
            >
              <ArrowLeft className="size-4" />
              Back to map
            </Link>
          </div>
        )}

        {/* Error */}
        {state.status === "error" && state.message !== "feature_disabled" && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="size-8 text-accent-red mb-3" />
            <p className="text-foreground font-medium">Something went wrong</p>
            <p className="text-muted text-sm mt-1">{state.message}</p>
            <button
              onClick={handleRefresh}
              className="mt-4 text-sm text-accent-blue hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Data table */}
        {state.status === "done" && (
          <DependentsTable
            data={state.data}
            sortBy={sortBy}
            onSort={handleSort}
            onPage={handlePage}
            owner={owner}
            repo={repo}
          />
        )}
      </main>
    </div>
  );
}
