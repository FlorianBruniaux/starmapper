// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { Header } from "@/components/header";
import { CommandSearch } from "@/components/command-search";
import { Footer } from "@/components/footer";
import { isCountry, normalizeCountry } from "@/lib/countries";
import type { UserInfo, UserRepo } from "@/app/api/user-repos/route";
import type { StargazerPoint, ChunkResponse } from "@/app/api/chunk/route";
import type { MappedRepo } from "@/app/api/repos/route";
import { compressToBase64 } from "@/lib/compress-client";

const MAX_BATCH = 3;
const RETRY_DELAY = 8_000;

type Step = "loading" | "load-error" | "selecting" | "scanning" | "done";

type QueueItem = {
  name: string;
  stars: number;
  status: "pending" | "scanning" | "rate-limited" | "done" | "error";
  processed: number;
  total: number;
  mapped: number;
  countries: number;
  err?: string;
};

class RateLimitError extends Error {}


const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function UserPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = use(params);

  const [step, setStep] = useState<Step>("loading");
  const [loadErr, setLoadErr] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [repos, setRepos] = useState<UserRepo[]>([]);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [minStars, setMinStars] = useState(10);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoSort, setRepoSort] = useState<"stars_desc" | "stars_asc" | "name_asc" | "name_desc">("stars_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [paused, setPaused] = useState(false);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  useEffect(() => { setHasToken(!!getStoredToken()); }, []);

  // Load user info + repos
  useEffect(() => {
    const token = getStoredToken();
    const headers: Record<string, string> = token ? { "x-gh-token": token } : {};
    fetch(`/api/user-repos?username=${owner}`, { headers })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) { setLoadErr(data.error ?? "Failed to load repos"); setStep("load-error"); return; }
        setUserInfo(data.user as UserInfo);
        setRepos(data.repos as UserRepo[]);
        setStep("selecting");
      })
      .catch(() => { setLoadErr("Network error"); setStep("load-error"); });
  }, [owner]);

  // Cross-reference with DB cache
  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data: { repos: MappedRepo[] }) => {
        const ownerLower = owner.toLowerCase();
        setCached(new Set(
          data.repos
            .filter((r) => r.owner.toLowerCase() === ownerLower)
            .map((r) => r.repo.toLowerCase()),
        ));
      })
      .catch(() => {});
  }, [owner]);

  const filtered = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    const list = repos.filter((r) =>
      r.stars >= minStars && (!q || r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)),
    );
    if (repoSort === "stars_desc") list.sort((a, b) => b.stars - a.stars);
    else if (repoSort === "stars_asc") list.sort((a, b) => a.stars - b.stars);
    else if (repoSort === "name_asc") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [repos, minStars, repoSearch, repoSort]);

  const toggleRepo = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) { next.delete(name); }
      else if (next.size < MAX_BATCH) { next.add(name); }
      return next;
    });
  };

  const patchQueue = useCallback((name: string, patch: Partial<QueueItem>) => {
    setQueue((q) => q.map((item) => item.name === name ? { ...item, ...patch } : item));
  }, []);

  const handleStart = useCallback(async () => {
    const toScan = repos.filter((r) => selected.has(r.name));
    if (!toScan.length) return;

    const initialQueue: QueueItem[] = toScan.map((r) => ({
      name: r.name, stars: r.stars, status: "pending",
      processed: 0, total: r.stars, mapped: 0, countries: 0,
    }));
    setQueue(initialQueue);
    setStep("scanning");
    abortRef.current = false;
    pauseRef.current = false;
    setPaused(false);

    const token = getStoredToken();
    const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (token) reqHeaders["x-gh-token"] = token;

    for (const repo of toScan) {
      if (abortRef.current) { patchQueue(repo.name, { status: "error", err: "Cancelled" }); continue; }

      while (pauseRef.current && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (abortRef.current) { patchQueue(repo.name, { status: "error", err: "Cancelled" }); continue; }

      patchQueue(repo.name, { status: "scanning" });

      try {
        let cursor: string | null = null;
        let allPoints: StargazerPoint[] = [];
        let allUnmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[] = [];

        outer: while (true) {
          while (pauseRef.current && !abortRef.current) {
            await new Promise((r) => setTimeout(r, 500));
          }
          if (abortRef.current) throw new Error("aborted");

          while (true) {
            try {
              const res = await fetch("/api/chunk", {
                method: "POST",
                headers: reqHeaders,
                body: JSON.stringify({ owner, repo: repo.name, cursor }),
              });
              if (res.status === 429) throw new RateLimitError();
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const chunk = (await res.json()) as ChunkResponse;

              allPoints = [...allPoints, ...chunk.points];
              allUnmapped = [...allUnmapped, ...chunk.unmapped];
              patchQueue(repo.name, {
                processed: allPoints.length + allUnmapped.length,
                total: chunk.totalCount,
              });

              if (!chunk.nextCursor) break outer;
              cursor = chunk.nextCursor;
              break;
            } catch (e) {
              if (e instanceof RateLimitError) {
                patchQueue(repo.name, { status: "rate-limited" });
                await new Promise((r) => setTimeout(r, RETRY_DELAY));
                patchQueue(repo.name, { status: "scanning" });
              } else {
                throw e;
              }
            }
          }
        }

        const totalCount = allPoints.length + allUnmapped.length;
        const countrySet = new Set(
          allPoints
            .map((p) => { const s = p.location?.split(",").pop()?.trim(); return s && isCountry(s) ? normalizeCountry(s) : null; })
            .filter(Boolean),
        );
        const mappedCount = allPoints.length;
        const countryCount = countrySet.size;

        // Write to DB cache (fire-and-forget)
        if (totalCount > 0) {
          (async () => {
            try {
              type SlimPoint = Omit<StargazerPoint, "bio" | "avatarUrl">;
              const slim: SlimPoint[] = allPoints.map(({ bio: _b, avatarUrl: _av, ...rest }) => rest);
              const [pointsGz, unmappedGz] = await Promise.all([compressToBase64(slim), compressToBase64(allUnmapped)]);
              await fetch("/api/stargazer-cache", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ owner, repo: repo.name, pointsGz, unmappedGz, totalCount }),
              });
            } catch { /* non-critical */ }
          })();
        }

        fetch("/api/badge-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo: repo.name, mappedCount, countryCount, totalCount }),
        }).catch(() => {});

        patchQueue(repo.name, {
          status: "done", processed: totalCount, total: totalCount,
          mapped: mappedCount, countries: countryCount,
        });
      } catch (e) {
        const msg = e instanceof Error && e.message !== "aborted" ? e.message : "Cancelled";
        patchQueue(repo.name, { status: "error", err: msg });
      }
    }

    setStep("done");
  }, [owner, repos, selected, patchQueue]);

  const totalMapped = queue.reduce((s, q) => s + (q.status === "done" ? q.mapped : 0), 0);
  const totalCountries = queue.reduce((s, q) => s + (q.status === "done" ? q.countries : 0), 0);
  const doneCount = queue.filter((q) => q.status === "done").length;

  return (
    <>
      <CommandSearch />
      {tokenOpen && (
        <TokenModal onClose={() => { setTokenOpen(false); setHasToken(!!getStoredToken()); }} />
      )}

      {/* Header */}
      <Header
        backLink="/"
        afterLogo={step !== "loading" && step !== "load-error" ? (
          <span className="text-muted text-sm">/ {owner}</span>
        ) : null}
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      <main id="main" className="min-h-screen bg-background pt-14">
        <div className="max-w-5xl mx-auto px-6 py-10">

          {/* Loading */}
          {step === "loading" && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="size-8 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
              <p className="text-muted text-sm">Loading repos for {owner}…</p>
            </div>
          )}

          {/* Load error */}
          {step === "load-error" && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <p className="text-accent-red text-sm font-medium">{loadErr}</p>
              {!hasToken && (
                <p className="text-muted text-xs text-center max-w-xs">
                  No token set. GitHub limits unauthenticated requests to 60/hr.{" "}
                  <button onClick={() => setTokenOpen(true)} className="text-accent-blue hover:underline">Add a token</button>{" "}
                  and try again.
                </p>
              )}
              <Link href="/" className="text-xs text-muted hover:text-foreground transition-colors">← Back to home</Link>
            </div>
          )}

          {/* Selecting */}
          {step === "selecting" && userInfo && (
            <>
              {/* User header */}
              <div className="flex items-center gap-4 mb-8">
                <Image src={userInfo.avatar} alt="" width={56} height={56} className="size-14 rounded-full border border-border" />
                <div>
                  <h1 className="text-foreground font-semibold text-lg">{userInfo.name ?? userInfo.login}</h1>
                  <p className="text-muted text-sm">{userInfo.publicRepos} public repos</p>
                </div>
              </div>

              {/* Token nudge */}
              {!hasToken && (
                <div className="flex items-center gap-2 bg-accent-orange/10 border border-accent-orange/25 rounded-lg px-4 py-2.5 mb-6">
                  <span className="text-accent-orange text-xs">⚠</span>
                  <p className="text-xs text-muted">
                    <span className="text-accent-orange font-medium">No token:</span> batch scan will hit rate limits fast.{" "}
                    <button onClick={() => setTokenOpen(true)} className="text-accent-blue hover:underline font-medium">Add token</button>{" "}
                    for 5,000 req/hr.
                  </p>
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-col gap-2 mb-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor="min-stars" className="text-muted text-xs shrink-0">Min stars</label>
                    <input
                      id="min-stars"
                      type="number"
                      min={0}
                      value={minStars}
                      onChange={(e) => { setMinStars(Math.max(0, parseInt(e.target.value) || 0)); setSelected(new Set()); }}
                      className="w-20 bg-surface border border-border rounded-md px-2 py-1 text-foreground text-xs focus:outline-none focus:border-accent-blue transition-colors"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {(["stars_desc", "stars_asc", "name_asc", "name_desc"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setRepoSort(s)}
                        className={`px-2 py-1 rounded text-2xs transition-colors border ${
                          repoSort === s
                            ? "bg-accent-blue/20 text-accent-blue border-accent-blue/40"
                            : "text-muted border-border hover:text-foreground"
                        }`}
                      >
                        {s === "stars_desc" ? "★ desc" : s === "stars_asc" ? "★ asc" : s === "name_asc" ? "A→Z" : "Z→A"}
                      </button>
                    ))}
                  </div>
                  <p className="text-muted-subtle text-xs shrink-0">
                    {filtered.length} repos match · select up to {MAX_BATCH}
                  </p>
                </div>
                <div className="relative">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                    <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search repos…"
                    aria-label="Search repos"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="w-full bg-surface border border-border rounded-md pl-8 pr-3 py-1.5 text-foreground text-xs focus:outline-none focus:border-accent-blue transition-colors placeholder:text-muted-subtle"
                  />
                </div>
              </div>

              {/* Repo list */}
              <div className="border border-border rounded-lg overflow-hidden mb-6">
                {filtered.length === 0 ? (
                  <p className="text-muted text-sm text-center py-8">No repos with {minStars}+ stars</p>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {filtered.map((r) => {
                      const isSelected = selected.has(r.name);
                      const isCached = cached.has(r.name.toLowerCase());
                      const isDisabled = !isSelected && selected.size >= MAX_BATCH;
                      return (
                        <label
                          key={r.name}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                            isDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-alt"
                          } ${isSelected ? "bg-accent-blue/5" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDisabled}
                            onChange={() => toggleRepo(r.name)}
                            className="accent-accent-blue"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-foreground text-sm font-medium truncate">{r.name}</span>
                              {r.fork && (
                                <span className="text-2xs text-muted border border-border rounded px-1.5 py-0.5 shrink-0">Fork</span>
                              )}
                              {isCached && (
                                <span className="text-2xs text-accent-green border border-accent-green/30 rounded px-1.5 py-0.5 shrink-0">Cached</span>
                              )}
                            </div>
                            {r.description && (
                              <p className="text-muted-subtle text-xs truncate mt-0.5">{r.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0 text-xs text-muted">
                            {r.language && <span>{r.language}</span>}
                            <span className="flex items-center gap-1">
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-accent-orange/70">
                                <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
                              </svg>
                              {fmt(r.stars)}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CTA */}
              <div className="flex items-center justify-between">
                <p className="text-muted text-xs">
                  {selected.size} / {MAX_BATCH} repos selected
                  {selected.size === MAX_BATCH && (
                    <span className="text-muted-subtle"> (max reached)</span>
                  )}
                </p>
                <button
                  onClick={handleStart}
                  disabled={selected.size === 0}
                  className="flex items-center gap-2 bg-accent-green-emphasis hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-opacity"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
                  </svg>
                  Start Batch Scan ({selected.size})
                </button>
              </div>
            </>
          )}

          {/* Scanning + Done */}
          {(step === "scanning" || step === "done") && (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-foreground font-semibold text-base">
                    {step === "done" ? "Batch complete" : "Scanning repos…"}
                  </h1>
                  <p className="text-muted text-xs mt-0.5">
                    {doneCount} / {queue.length} repos · {fmt(totalMapped)} mapped
                    {totalCountries > 0 && ` · ${totalCountries} countries`}
                  </p>
                </div>
                {step === "scanning" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { pauseRef.current = !paused; setPaused(!paused); }}
                      className="text-xs px-3 py-1.5 border border-border rounded-lg text-muted hover:text-foreground hover:border-accent-blue transition-colors"
                    >
                      {paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      onClick={() => { abortRef.current = true; pauseRef.current = false; setPaused(false); }}
                      className="text-xs px-3 py-1.5 border border-accent-red/30 rounded-lg text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Queue list */}
              <div className="border border-border rounded-lg overflow-hidden mb-6">
                <div className="divide-y divide-border-subtle">
                  {queue.map((item) => {
                    const pct = item.total > 0 ? Math.round((item.processed / item.total) * 100) : 0;
                    return (
                      <div key={item.name} className="flex items-center gap-3 px-4 py-3">
                        {/* Status icon */}
                        <div className="shrink-0 size-5 flex items-center justify-center">
                          {item.status === "done" && (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-green">
                              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                            </svg>
                          )}
                          {item.status === "error" && (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-accent-red">
                              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                            </svg>
                          )}
                          {item.status === "scanning" && (
                            <div className="size-4 border-2 border-border border-t-accent-blue rounded-full animate-spin" />
                          )}
                          {item.status === "rate-limited" && (
                            <div className="size-4 border-2 border-accent-orange/50 border-t-accent-orange rounded-full animate-spin" />
                          )}
                          {item.status === "pending" && (
                            <div className="size-3 rounded-full border border-border-subtle" />
                          )}
                        </div>

                        {/* Name + progress */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground text-sm font-medium truncate">{item.name}</span>
                            {item.status === "rate-limited" && (
                              <span className="text-2xs text-accent-orange shrink-0">Rate limited, retrying…</span>
                            )}
                            {item.status === "error" && item.err && (
                              <span className="text-2xs text-accent-red truncate">{item.err}</span>
                            )}
                          </div>
                          {(item.status === "scanning" || item.status === "rate-limited") && item.total > 0 && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="flex-1 h-1 bg-surface-alt rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-accent-blue rounded-full transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-2xs text-muted-subtle shrink-0">{fmt(item.processed)} / {fmt(item.total)}</span>
                            </div>
                          )}
                          {item.status === "done" && (
                            <p className="text-muted-subtle text-xs mt-0.5">
                              {fmt(item.mapped)} mapped · {item.countries} countries
                            </p>
                          )}
                        </div>

                        {/* View map link */}
                        {item.status === "done" && (
                          <Link
                            href={`/${owner}/${item.name}`}
                            className="shrink-0 text-xs text-accent-blue hover:underline"
                          >
                            View map →
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {step === "done" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => { setSelected(new Set()); setQueue([]); setStep("selecting"); }}
                    className="flex-1 text-sm border border-border text-muted hover:text-foreground hover:border-accent-blue py-2.5 rounded-lg transition-colors"
                  >
                    Scan more repos
                  </button>
                  <Link
                    href="/"
                    className="flex-1 text-center text-sm bg-accent-green-emphasis hover:opacity-90 text-white font-medium py-2.5 rounded-lg transition-opacity"
                  >
                    Back to home
                  </Link>
                </div>
              )}
            </>
          )}

        </div>
      </main>
      <Footer />
    </>
  );
}
