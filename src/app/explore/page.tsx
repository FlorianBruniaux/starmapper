"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Footer } from "@/components/footer";
import { StatsList } from "@/components/stats-list";
import type { ExploreData } from "@/app/api/explore/route";

type Tab = "top" | "power" | "companies" | "countries" | "cities";

export default function ExplorePage() {
  const [data, setData] = useState<ExploreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("top");

  useEffect(() => {
    fetch("/api/explore")
      .then((r) => r.ok ? r.json() : null)
      .then((d: ExploreData | null) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border-subtle bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-accent-blue flex-shrink-0">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
              <ellipse cx="10" cy="10" rx="4" ry="8" stroke="currentColor" strokeWidth="1.25"/>
              <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.25"/>
              <path d="M3.5 6.5 Q10 5 16.5 6.5" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M3.5 13.5 Q10 15 16.5 13.5" stroke="currentColor" strokeWidth="1" fill="none"/>
              <path d="M10 5.5 L10.6 7.4 L12.6 7.4 L11.0 8.6 L11.6 10.5 L10 9.3 L8.4 10.5 L9.0 8.6 L7.4 7.4 L9.4 7.4 Z" fill="currentColor"/>
            </svg>
            <a href="/" className="hover:text-accent-blue transition-colors">StarMapper</a>
          </div>
          <nav className="flex items-center">
            <span className="text-sm text-foreground font-medium" aria-current="page">Leaderboard</span>
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Stargazer Intelligence</h1>
          <p className="text-muted text-sm mt-1">Global leaderboards across all tracked repos</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Developers", value: loading ? "…" : (data?.totalUsers ?? 0).toLocaleString(), accent: "text-foreground" },
            { label: "Tracked repos", value: loading ? "…" : (data?.totalTrackedRepos ?? 0).toLocaleString(), accent: "text-foreground" },
            { label: "Star events", value: loading ? "…" : data ? (data.totalStarEvents >= 1000 ? `${(data.totalStarEvents / 1000).toFixed(1)}k` : data.totalStarEvents.toString()) : "…", accent: "text-accent-orange" },
            { label: "Countries", value: loading ? "…" : (data?.totalCountries ?? 0).toLocaleString(), accent: "text-accent-green" },
          ].map(({ label, value, accent }) => (
            <div key={label} className="bg-surface border border-border rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${accent}`}>{value}</div>
              <div className="text-xs text-muted uppercase tracking-wide mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex border-b border-border-subtle">
            {(["top", "power", "companies", "countries", "cities"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-3 text-xs font-medium transition-colors ${
                  tab === t
                    ? "text-accent-blue border-b-2 border-accent-blue -mb-px bg-accent-blue/5"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t === "top" ? "Top Stars" : t === "power" ? "⚡ Power" : t === "companies" ? "Companies" : t === "countries" ? "Countries" : "Cities"}
              </button>
            ))}
          </div>

          <div className="p-5">
            {loading && (
              <div className="text-center text-muted-subtle text-sm py-12">Loading…</div>
            )}

            {!loading && !data && (
              <div className="text-center text-muted-subtle text-sm py-12">No data available yet.</div>
            )}

            {!loading && data && (
              <>
                {tab === "top" && (
                  <div className="space-y-3">
                    {data.topUsers.map((u, i) => (
                      <div key={u.login} className="flex items-center gap-3">
                        <span className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">{i + 1}</span>
                        <img src={u.avatarUrl} alt="" className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={`https://github.com/${u.login}`}
                              target="_blank"
                              className="text-accent-blue text-sm font-medium hover:underline"
                            >
                              @{u.login}
                            </a>
                            {u.company && (
                              <span className="text-2xs text-muted bg-surface-alt border border-border-subtle rounded px-1.5 py-px truncate max-w-28">
                                {u.company.replace(/^@/, "")}
                              </span>
                            )}
                          </div>
                          {u.name && u.name !== u.login && (
                            <div className="text-muted-subtle text-xs truncate">{u.name}</div>
                          )}
                        </div>
                        <span className="text-muted text-xs flex-shrink-0 tabular-nums">
                          {u.followers.toLocaleString()} flw
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "power" && (
                  <div className="space-y-3">
                    {data.powerStargazers.length === 0 && (
                      <div className="text-center text-muted-subtle text-sm py-12">
                        <div className="text-3xl mb-2">⚡</div>
                        No power stargazers yet. Appears after multiple repos are scanned.
                      </div>
                    )}
                    {data.powerStargazers.map((u, i) => (
                      <div key={u.login} className="flex items-center gap-3">
                        <span className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">{i + 1}</span>
                        <img src={u.avatarUrl} alt="" className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border" />
                        <div className="flex-1 min-w-0">
                          <a
                            href={`https://github.com/${u.login}`}
                            target="_blank"
                            className="text-accent-blue text-sm font-medium hover:underline"
                          >
                            @{u.login}
                          </a>
                          {u.name && u.name !== u.login && (
                            <div className="text-muted-subtle text-xs truncate">{u.name}</div>
                          )}
                        </div>
                        <span className="text-accent-orange text-xs flex-shrink-0 tabular-nums font-medium">
                          {u.trackedRepos} repos
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "companies" && (
                  <div className="space-y-2">
                    {data.topCompanies.length === 0 && (
                      <div className="text-center text-muted-subtle text-sm py-12">No company data yet.</div>
                    )}
                    {data.topCompanies.map(([company, count], idx) => (
                      <div key={company} className="flex items-center gap-3">
                        <div className="text-muted-subtle text-xs w-6 text-right flex-shrink-0">{idx + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-foreground text-xs truncate">{company}</span>
                            <span className="text-muted text-xs ml-2 flex-shrink-0">{count}</span>
                          </div>
                          <div className="h-1 bg-surface-alt rounded-full">
                            <div className="h-1 bg-accent-blue rounded-full" style={{ width: `${(count / (data.topCompanies[0]?.[1] ?? 1)) * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "countries" && (
                  <StatsList
                    items={data.topCountries}
                    max={data.topCountries[0]?.[1] ?? 1}
                  />
                )}

                {tab === "cities" && (
                  <StatsList
                    items={data.topCities}
                    max={data.topCities[0]?.[1] ?? 1}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
