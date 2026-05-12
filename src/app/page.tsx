// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getStoredToken } from "@/lib/token";
import { getBookmarks } from "@/lib/bookmarks";
import { Header } from "@/components/header";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { Footer } from "@/components/footer";
import Link from "next/link";
import { CommandSearch } from "@/components/command-search";
import type { Bookmark } from "@/lib/bookmarks";
import type { MappedRepo } from "@/app/api/repos/route";

// Lazy-load heavy UI components not needed on initial render
const TokenModal = dynamic(
  () => import("@/components/token-modal").then((m) => ({ default: m.TokenModal })),
  { ssr: false },
);
const SponsorsBlock = dynamic(
  () => import("@/components/sponsors-block").then((m) => ({ default: m.SponsorsBlock })),
  { ssr: false },
);

type Suggestion = { owner: string; repo: string };

const EXAMPLES: Suggestion[] = [
  { owner: "FlorianBruniaux", repo: "claude-code-ultimate-guide" },
  { owner: "rtk-ai", repo: "rtk" },
  { owner: "torvalds", repo: "linux" },
];

const VALID_GH_NAME = /^[a-zA-Z0-9._-]{1,100}$/;

const parseRepo = (val: string): { owner: string; repo: string } | null => {
  const cleaned = val.trim().replace(/\/$/, "").replace("https://github.com/", "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const owner = parts[0];
    const repo = parts[1];
    if (!VALID_GH_NAME.test(owner) || !VALID_GH_NAME.test(repo)) return null;
    return { owner, repo };
  }
  return null;
};

const parseUsername = (val: string): string | null => {
  const cleaned = val.trim().replace(/\/$/, "").replace("https://github.com/", "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 1 && /^[a-zA-Z0-9._-]{1,100}$/.test(parts[0])) return parts[0];
  return null;
};

export default function HomePage() {
  const [input, setInput] = useState("");
  const [compareInput, setCompareInput] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const [error, setError] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [repos, setRepos] = useState<MappedRepo[]>([]);
  const [reposTotal, setReposTotal] = useState(0);
  const [reposLoading, setReposLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setBookmarks(getBookmarks());
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    // Fetch 12 diversified repos for the featured section (max 3 per owner, min 100 stars)
    fetch("/api/repos?limit=12&diverse=true")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.repos)) setRepos(data.repos);
        if (typeof data.total === "number") setReposTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setReposLoading(false));
  }, []);

  // Merge bookmarks + examples, deduplicate, bookmarks first — cap at 4
  const suggestions = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>();
    const merged: Suggestion[] = [];
    const all: Suggestion[] = [...bookmarks.map(({ owner, repo }) => ({ owner, repo })), ...EXAMPLES];
    for (const b of all) {
      const key = `${b.owner}/${b.repo}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(b);
      }
    }
    return merged.slice(0, 4);
  }, [bookmarks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepo(input);
    if (parsed) {
      if (compareInput.trim()) {
        const parsed2 = parseRepo(compareInput);
        if (parsed2) {
          router.push(`/${parsed.owner}/${parsed.repo}?compare=${parsed2.owner}/${parsed2.repo}`);
          return;
        }
      }
      router.push(`/${parsed.owner}/${parsed.repo}`);
      return;
    }
    const username = parseUsername(input);
    if (username) {
      router.push(`/profile/${username}`);
      return;
    }
    setError("Enter a GitHub repo (owner/repo) or a username");
  };

  const handleSuggestion = (b: Suggestion) => {
    setInput(`${b.owner}/${b.repo}`);
    setError("");
  };

  const isBookmark = (b: Suggestion) =>
    bookmarks.some((bm) => bm.owner === b.owner && bm.repo === b.repo);

  return (
    <>
      <CommandSearch repos={repos} />

      {tokenOpen && (
        <TokenModal
          onClose={() => {
            setTokenOpen(false);
            setHasToken(!!getStoredToken());
          }}
        />
      )}

      <AnnouncementBanner />
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      <main id="main" className="min-h-screen bg-background flex flex-col">

        {/* ── Hero + Search ── */}
        <section className="relative w-full flex flex-col items-center px-6 pt-16 pb-12 lg:pt-24 lg:pb-16 overflow-hidden">

          {/* Scatter map background — stargazer concentration cloud */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <svg
              viewBox="0 0 800 400"
              className="w-full h-full opacity-[0.04] dark:opacity-[0.07]"
              preserveAspectRatio="xMidYMid slice"
            >
              {/* North America */}
              <circle cx="128" cy="116" r="3.5" fill="currentColor" />{/* SF */}
              <circle cx="128" cy="94" r="2.5" fill="currentColor" />{/* Seattle */}
              <circle cx="126" cy="91" r="2" fill="currentColor" />{/* Vancouver */}
              <circle cx="138" cy="124" r="2.5" fill="currentColor" />{/* LA */}
              <circle cx="236" cy="109" r="3" fill="currentColor" />{/* New York */}
              <circle cx="242" cy="105" r="2" fill="currentColor" />{/* Boston */}
              <circle cx="206" cy="107" r="2.5" fill="currentColor" />{/* Chicago */}
              <circle cx="224" cy="102" r="2" fill="currentColor" />{/* Toronto */}
              <circle cx="182" cy="132" r="2" fill="currentColor" />{/* Austin */}
              <circle cx="180" cy="157" r="1.5" fill="currentColor" />{/* Mexico City */}
              {/* South America */}
              <circle cx="296" cy="252" r="3" fill="currentColor" />{/* São Paulo */}
              <circle cx="271" cy="276" r="2" fill="currentColor" />{/* Buenos Aires */}
              <circle cx="235" cy="190" r="1.5" fill="currentColor" />{/* Bogotá */}
              {/* Europe */}
              <circle cx="400" cy="86" r="3" fill="currentColor" />{/* London */}
              <circle cx="405" cy="91" r="2.5" fill="currentColor" />{/* Paris */}
              <circle cx="430" cy="83" r="2.5" fill="currentColor" />{/* Berlin */}
              <circle cx="411" cy="83" r="2" fill="currentColor" />{/* Amsterdam */}
              <circle cx="440" cy="68" r="1.5" fill="currentColor" />{/* Stockholm */}
              <circle cx="419" cy="94" r="2" fill="currentColor" />{/* Zurich */}
              <circle cx="392" cy="110" r="2" fill="currentColor" />{/* Madrid */}
              <circle cx="380" cy="113" r="1.5" fill="currentColor" />{/* Lisbon */}
              <circle cx="428" cy="107" r="2" fill="currentColor" />{/* Rome */}
              <circle cx="447" cy="84" r="1.5" fill="currentColor" />{/* Warsaw */}
              <circle cx="464" cy="109" r="2" fill="currentColor" />{/* Istanbul */}
              <circle cx="484" cy="76" r="2" fill="currentColor" />{/* Moscow */}
              <circle cx="468" cy="89" r="1.5" fill="currentColor" />{/* Kyiv */}
              {/* Middle East & Africa */}
              <circle cx="477" cy="129" r="1.5" fill="currentColor" />{/* Tel Aviv */}
              <circle cx="469" cy="133" r="1.5" fill="currentColor" />{/* Cairo */}
              <circle cx="520" cy="143" r="1.5" fill="currentColor" />{/* Dubai */}
              <circle cx="408" cy="187" r="1.5" fill="currentColor" />{/* Lagos */}
              <circle cx="482" cy="203" r="1" fill="currentColor" />{/* Nairobi */}
              {/* South & Southeast Asia */}
              <circle cx="572" cy="137" r="2.5" fill="currentColor" />{/* Delhi */}
              <circle cx="562" cy="157" r="3" fill="currentColor" />{/* Mumbai */}
              <circle cx="572" cy="171" r="2.5" fill="currentColor" />{/* Bangalore */}
              <circle cx="578" cy="170" r="1.5" fill="currentColor" />{/* Chennai */}
              <circle cx="631" cy="197" r="2" fill="currentColor" />{/* Singapore */}
              {/* East Asia */}
              <circle cx="678" cy="111" r="2.5" fill="currentColor" />{/* Beijing */}
              <circle cx="691" cy="131" r="3" fill="currentColor" />{/* Shanghai */}
              <circle cx="674" cy="150" r="2" fill="currentColor" />{/* Shenzhen */}
              <circle cx="682" cy="116" r="2" fill="currentColor" />{/* Seoul */}
              <circle cx="710" cy="121" r="2.5" fill="currentColor" />{/* Tokyo */}
              {/* Australia */}
              <circle cx="736" cy="275" r="2" fill="currentColor" />{/* Sydney */}
              <circle cx="722" cy="284" r="1.5" fill="currentColor" />{/* Melbourne */}
              {/* Constellation lines */}
              <line x1="128" y1="116" x2="236" y2="109" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
              <line x1="400" y1="86" x2="430" y2="83" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
              <line x1="562" y1="157" x2="572" y2="171" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
              <line x1="678" y1="111" x2="710" y2="121" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
            </svg>
          </div>

          <div className="relative w-full max-w-xl flex flex-col items-center text-center gap-6">

            <h1 className="text-4xl font-bold text-foreground leading-tight">
              Where in the world does<br />
              your repo shine?
            </h1>

            <p className="text-muted text-base leading-relaxed max-w-sm">
              Paste a GitHub repo URL. Get an interactive world map of every stargazer in seconds.
            </p>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setError("");
                  }}
                  placeholder="owner/repo or just a username"
                  className="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue text-sm transition-colors"
                  autoFocus
                  aria-label="GitHub repository URL or username"
                  aria-invalid={!!error}
                  aria-describedby={error ? "repo-input-error" : undefined}
                />
                <button
                  type="submit"
                  className="sm:shrink-0 bg-accent-green-emphasis hover:opacity-90 hover:shadow-[0_0_20px_rgba(14,152,86,0.4)] text-white font-bold py-3 px-6 rounded-lg transition-[opacity,box-shadow] text-base whitespace-nowrap"
                >
                  Map Stargazers
                </button>
              </div>

              {/* Username hint */}
              <p className="text-xs text-muted-subtle text-left" aria-live="polite" aria-atomic="true">
                {parseUsername(input) && (
                  <>
                    Looks like a username — will scan all repos for{" "}
                    <span className="text-foreground font-medium">{parseUsername(input)}</span>
                  </>
                )}
              </p>

              {/* Compare input */}
              {showCompare && (
                <div className="relative">
                  <input
                    value={compareInput}
                    onChange={(e) => {
                      setCompareInput(e.target.value);
                      setError("");
                    }}
                    placeholder="Compare with: github.com/owner/repo"
                    autoFocus
                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 pr-10 text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-purple text-sm transition-colors"
                    aria-label="Compare with repository"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowCompare(false);
                      setCompareInput("");
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-subtle hover:text-muted transition-colors"
                    aria-label="Remove compare"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </button>
                </div>
              )}

              {error && (
                <p id="repo-input-error" className="text-accent-red text-xs text-left" role="alert">
                  {error}
                </p>
              )}

              {/* Compare text link — power-user feature, not prominent */}
              {!showCompare && (
                <button
                  type="button"
                  onClick={() => setShowCompare(true)}
                  className="text-xs text-muted-subtle hover:text-muted transition-colors self-end"
                >
                  Compare two repos
                </button>
              )}
            </form>

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
              <div className="flex gap-2 flex-wrap justify-center">
                {suggestions.map((b) => {
                  const key = `${b.owner}/${b.repo}`;
                  const recent = isBookmark(b);
                  return (
                    <button
                      key={key}
                      onClick={() => handleSuggestion(b)}
                      className={`text-xs rounded px-3 py-1.5 border transition-colors ${
                        recent
                          ? "bg-surface border-border text-muted hover:text-foreground hover:border-accent-blue"
                          : "bg-transparent border-border-subtle text-muted-subtle hover:text-muted hover:border-border"
                      }`}
                    >
                      {b.repo}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── Social proof strip ── */}
        {reposLoading ? (
          <div className="border-y border-border-subtle" aria-hidden="true">
            <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 flex items-center justify-center gap-8 sm:gap-16 flex-wrap">
              <div className="h-10 w-20 rounded bg-surface-alt animate-pulse" />
              <div className="hidden sm:block h-8 w-px bg-border-subtle" />
              <div className="h-10 w-16 rounded bg-surface-alt animate-pulse" />
              <div className="hidden sm:block h-8 w-px bg-border-subtle" />
              <div className="h-10 w-12 rounded bg-surface-alt animate-pulse" />
            </div>
          </div>
        ) : repos.length > 0 ? (
          <div className="border-y border-border-subtle">
            <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 flex items-center justify-center gap-8 sm:gap-16 flex-wrap">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground tabular-nums">
                  {(reposTotal || repos.length).toLocaleString()}
                </div>
                <div className="text-xs text-muted mt-0.5">repos mapped</div>
              </div>
              <div className="hidden sm:block h-8 w-px bg-border-subtle" />
              <div className="text-center">
                <div className="text-2xl font-bold text-accent-green">Free</div>
                <div className="text-xs text-muted mt-0.5">forever, no account</div>
              </div>
              <div className="hidden sm:block h-8 w-px bg-border-subtle" />
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">30s</div>
                <div className="text-xs text-muted mt-0.5">to first map</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Features ── */}
        <section className="w-full max-w-7xl mx-auto px-4 lg:px-6 py-16">
          <h2 className="text-muted-subtle text-2xs uppercase tracking-widest mb-6 text-center">
            More to explore
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                href: "/explore",
                label: "Explore",
                desc: "Top stargazers by followers, company stats, cross-repo fans.",
                colorClass: "text-accent-blue",
                bgClass: "bg-accent-blue/8",
                icon: <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />,
              },
              {
                href: "/profile/florianbruniaux",
                label: "Developer profiles",
                desc: "Any GitHub username → map, nearby devs, top repos, contact.",
                colorClass: "text-accent-purple",
                bgClass: "bg-accent-purple/8",
                icon: <path d="M10.25 2.0a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0ZM1 14a6 6 0 1 1 12 0H1Z" />,
              },
              {
                href: "/devs",
                label: "Dev Maps",
                desc: "Interactive maps of developers filtered by programming language.",
                colorClass: "text-accent-green",
                bgClass: "bg-accent-green/8",
                icon: <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 0 1 .75-3.054l1.61 1.61A2.999 2.999 0 0 0 3 8c0 .126.007.251.02.374l-1.546.682A6.47 6.47 0 0 1 1.5 8Zm1.23 4.065.886-1.328A2.999 2.999 0 0 0 8 11c.63 0 1.215-.19 1.701-.516l.886 1.328A6.5 6.5 0 0 1 2.73 12.065ZM8 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4.52 2.565.886 1.328A6.5 6.5 0 0 0 14.5 8c0-.318-.026-.63-.074-.935l-1.546.682c.013.123.02.248.02.374a3 3 0 0 1-.38 1.444Z" />,
              },
              {
                href: "/devs/atlas",
                label: "Language Atlas",
                desc: "Which language dominates each country? A choropleth of the dev world.",
                colorClass: "text-accent-orange",
                bgClass: "bg-accent-orange/8",
                icon: <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c.712 0 1.373.333 1.75.88.377-.547 1.038-.88 1.75-.88h4.747a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.747a1 1 0 0 0-1 1v.25a.75.75 0 0 1-1.5 0v-.25a1 1 0 0 0-1-1H.75a.75.75 0 0 1-.75-.75Zm7.5 10.931V3.455c-.32-.274-.717-.455-1.247-.455H1.5v9h3.247c.91 0 1.79.285 2.503.926Zm1.5-7.476v8.476a4.488 4.488 0 0 1 2.503-.926H14.5V3h-3.997c-.53 0-.927.18-1.247.455-.32.274-.506.62-.506 1.206Z" />,
              },
            ].map(({ href, label, desc, colorClass, bgClass, icon }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col gap-3 bg-surface border border-border-subtle rounded-lg p-4 hover:border-accent-blue/40 transition-colors group"
              >
                <div className={`size-7 shrink-0 flex items-center justify-center rounded-md ${bgClass}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={colorClass}>
                    {icon}
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-semibold mb-1 text-foreground group-hover:underline">{label}</div>
                  <div className="text-muted text-xs leading-relaxed">{desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* ── FAQ link ── */}
        <div className="w-full max-w-7xl mx-auto px-4 lg:px-6 pb-8 text-right">
          <Link href="/faq" className="text-xs text-muted-subtle hover:text-muted transition-colors">
            Questions? See FAQ →
          </Link>
        </div>

        {/* ── Community Maps (featured) ── */}
        {reposLoading ? (
          <section className="w-full max-w-7xl mx-auto px-4 lg:px-6 pb-12" aria-hidden="true">
            <div className="flex items-center justify-between mb-4">
              <div className="h-3 w-28 rounded bg-surface-alt animate-pulse" />
              <div className="h-7 w-36 rounded-lg bg-surface-alt animate-pulse" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-surface-alt animate-pulse" />
              ))}
            </div>
          </section>
        ) : repos.length > 0 ? (
          <section className="w-full max-w-7xl mx-auto px-4 lg:px-6 pt-4 pb-16">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-muted-subtle text-2xs uppercase tracking-widest">
                Community maps
              </h2>
              <Link
                href="/repos"
                className="flex items-center gap-1.5 text-xs font-medium text-foreground bg-surface border border-border hover:border-accent-blue hover:text-accent-blue px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z" />
                </svg>
                Browse all {reposTotal > 0 ? reposTotal.toLocaleString() : ""} repos
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {repos.map((repo) => (
                <Link
                  key={`${repo.owner}/${repo.repo}`}
                  href={`/${repo.owner}/${repo.repo}`}
                  className="flex flex-col gap-2 p-4 bg-surface border border-border-subtle rounded-lg hover:border-accent-blue/40 transition-colors group"
                >
                  <div className="text-sm text-foreground font-medium truncate">
                    <span className="text-muted">{repo.owner}/</span>
                    <span className="font-bold group-hover:text-accent-blue transition-colors">
                      {repo.repo}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span
                      className={`font-medium ${
                        repo.mappedPercent >= 50
                          ? "text-accent-green"
                          : repo.mappedPercent >= 25
                          ? "text-accent-orange"
                          : "text-muted"
                      }`}
                    >
                      {repo.mappedPercent}% mapped
                    </span>
                    <span>{repo.countryCount === 1 ? "1 country" : `${repo.countryCount} countries`}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Sponsors ── */}
        <SponsorsBlock />


      </main>

      <Footer />
    </>
  );
}
