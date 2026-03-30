"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { getBookmarks } from "@/lib/bookmarks";
import { RepoTable } from "@/components/repo-table";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { CommandSearch } from "@/components/command-search";
import type { Bookmark } from "@/lib/bookmarks";
import type { MappedRepo } from "@/app/api/repos/route";

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

// Returns username if input is a bare username or github.com/username (no repo)
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
  const router = useRouter();

  useEffect(() => {
    setBookmarks(getBookmarks());
    setHasToken(!!getStoredToken());
  }, []);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.repos)) setRepos(data.repos);
      })
      .catch(() => {});
  }, []);

  // Merge bookmarks + examples, deduplicate, bookmarks first
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
    return merged.slice(0, 6);
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
    // Bare username → batch scan page
    const username = parseUsername(input);
    if (username) {
      router.push(`/${username}`);
      return;
    }
    setError("Enter a GitHub repo (owner/repo) or a username to scan all repos");
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

      {/* Header */}
      <Header
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      {/* Main */}
      <main id="main" className="min-h-screen bg-background flex flex-col lg:flex-row pt-14">

        {/* Left column — hero + form + how it works */}
        <div className="lg:w-[480px] lg:shrink-0 flex flex-col justify-start px-8 py-12 lg:py-16 lg:border-r lg:border-border-subtle">
        <div className="w-full max-w-sm mx-auto lg:mx-0">

          {/* Hero */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span
                className="inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-widest
                           text-accent-blue bg-accent-blue/10 border border-accent-blue/20 rounded-full px-3 py-1"
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
                </svg>
                GitHub Stargazer Analytics
              </span>
            </div>
            <h1 className="text-3xl font-bold text-foreground leading-tight mb-3">
              Where in the world does<br />
              your repo{" "}
              <span className="bg-gradient-to-r from-accent-blue to-accent-purple bg-clip-text text-transparent">
                shine?
              </span>
            </h1>
            <p className="text-muted text-sm leading-relaxed">
              Drop a GitHub repo URL and get an interactive world map of every stargazer,
              geocoded in real time.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            {/* Primary input */}
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError("");
              }}
              placeholder="owner/repo or just a username"
              className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue text-sm transition-colors"
              autoFocus
              aria-label="GitHub repository URL or username"
            />

            {/* Username hint — shown when input looks like a bare username */}
            {parseUsername(input) && (
              <p className="text-xs text-muted-subtle px-1">
                Looks like a username —{" "}
                <span className="text-accent-blue">Map Stargazers</span> will scan all repos for{" "}
                <span className="text-foreground font-medium">{parseUsername(input)}</span>
              </p>
            )}

            {/* Compare input — shown inline when toggled */}
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
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-accent-red text-xs px-1" role="alert">
                {error}
              </p>
            )}

            {/* Actions row: CTA + compare toggle */}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-accent-green-emphasis hover:opacity-90 hover:shadow-[0_0_20px_rgba(35,134,54,0.4)] text-white font-bold py-3 px-6 rounded-lg transition-[opacity,box-shadow] text-base"
              >
                Map Stargazers
              </button>
              {!showCompare && (
                <button
                  type="button"
                  onClick={() => setShowCompare(true)}
                  className="flex items-center gap-1.5 px-3 py-3 bg-surface border border-border hover:border-accent-blue text-muted hover:text-accent-blue rounded-lg transition-colors text-xs whitespace-nowrap"
                  title="Compare with another repo"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M9.573.677A1 1 0 0 0 8.455.032L4.03 1.323a1 1 0 0 0-.614 1.33l.48 1.197a6.003 6.003 0 0 0-2.798 6.969C1.703 12.415 3.388 14 5.374 14c1.013 0 1.96-.38 2.685-1.004A6.005 6.005 0 0 0 14 8c0-2.167-1.147-4.063-2.867-5.123L9.574.677ZM10.5 8a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                  </svg>
                  Compare
                </button>
              )}
            </div>

            {/* Token nudge */}
            {!hasToken && (
              <div className="flex items-center justify-center gap-1.5 bg-accent-orange/10 border border-accent-orange/25 rounded-lg px-3 py-2 mt-1">
                <span className="text-accent-orange text-xs">⚠</span>
                <p className="text-xs text-muted">
                  <span className="text-accent-orange font-medium">No token:</span> limited to 60 req/hr.{" "}
                  <button
                    type="button"
                    onClick={() => setTokenOpen(true)}
                    className="text-accent-blue hover:underline font-medium"
                  >
                    Add yours
                  </button>{" "}
                  for 5,000/hr.
                </p>
              </div>
            )}
          </form>

          {/* Not on the map callout — below CTA */}
          <a
            href="https://github.com/settings/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-3 px-4 py-3 bg-surface border border-border-subtle rounded-lg hover:border-accent-blue/40 transition-colors group"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-accent-blue/60 group-hover:text-accent-blue transition-colors" aria-hidden="true">
              <path d="m12.596 11.596-3.535 3.536a1.5 1.5 0 0 1-2.122 0l-3.535-3.536a6.5 6.5 0 1 1 9.192 0Zm-1.06-1.06a5 5 0 1 0-7.072 0L8 14.07l3.536-3.534ZM8 9a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 9Z" />
            </svg>
            <span className="text-xs text-muted-subtle group-hover:text-muted transition-colors">
              Not on the map? <span className="text-accent-blue">Add a location to your GitHub profile</span>
            </span>
          </a>

          {/* Suggestions — unified: bookmarks first, then examples to fill */}
          {suggestions.length > 0 && (
            <div className="mt-6">
              <p className="text-muted-subtle text-2xs uppercase tracking-widest mb-2.5">
                {bookmarks.length > 0 ? "Recent & examples" : "Try these"}
              </p>
              <div className="flex gap-2 flex-wrap">
                {suggestions.map((b) => {
                  const key = `${b.owner}/${b.repo}`;
                  const recent = isBookmark(b);
                  return (
                    <button
                      key={key}
                      onClick={() => handleSuggestion(b)}
                      className={`text-xs rounded px-2.5 py-1 border transition-colors ${
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
            </div>
          )}
        </div>

        {/* How it works — vertical list in left column */}
        <div className="w-full max-w-sm mx-auto lg:mx-0 mt-10">
          <p className="text-muted-subtle text-2xs uppercase tracking-widest mb-3">How it works</p>
          <div className="flex flex-col gap-2">
            {[
              { colorClass: "text-accent-blue", bgClass: "bg-accent-blue/8", label: "Interactive map", desc: "Stargazers geocoded and plotted in real time as they load.", icon: <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.94-2.06a.75.75 0 0 1 1.06 0l1.5 1.5 3-3a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-2-2a.75.75 0 0 1 0-1.06Z" /> },
              { colorClass: "text-accent-green", bgClass: "bg-accent-green/8", label: "Stats & export", desc: "Top countries, cities, companies, followers. Export image, Markdown or LinkedIn.", icon: <path d="M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm14.28 2.53-5.25 5.25a.75.75 0 0 1-1.06 0L7 7.06 4.28 9.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.25-3.25a.75.75 0 0 1 1.06 0L9 7.94l4.72-4.72a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z" /> },
              { colorClass: "text-accent-orange", bgClass: "bg-accent-orange/8", label: "Shared cache", desc: "First scan populates a global cache — next visitor loads instantly.", icon: <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" /> },
            ].map(({ colorClass, bgClass, label, desc, icon }) => (
              <div key={label} className="flex items-start gap-3 bg-surface border border-border-subtle rounded-lg px-4 py-3">
                <div className={`mt-0.5 size-7 shrink-0 flex items-center justify-center rounded-md ${bgClass}`}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={colorClass}>{icon}</svg>
                </div>
                <div>
                  <div className={`text-xs font-semibold mb-0.5 ${colorClass}`}>{label}</div>
                  <div className="text-muted text-xs leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ — visible for users + indexed by AI crawlers */}
        <div className="w-full max-w-sm mx-auto lg:mx-0 mt-10">
          <p className="text-muted-subtle text-2xs uppercase tracking-widest mb-3">FAQ</p>
          <div className="flex flex-col divide-y divide-border-subtle border border-border-subtle rounded-lg overflow-hidden">
            {[
              {
                q: "Is StarMapper free?",
                a: "Yes — no account, no login, no credit card. Paste a repo URL and click Map It.",
              },
              {
                q: "How accurate is the location data?",
                a: "Accuracy depends on what GitHub users enter in their profile. On average 60–80% of stargazers have a geocodable location. Users without a location appear in the Unmapped list.",
              },
              {
                q: "Does it work with private repos?",
                a: "No. StarMapper only works with public repositories — the GitHub API does not expose stargazer data for private repos.",
              },
              {
                q: "Can I embed a badge in my README?",
                a: "Yes. After scanning a repo, StarMapper generates an embeddable SVG badge with the star count and number of mapped countries. Copy the Markdown snippet directly from the map page.",
              },
            ].map(({ q, a }) => (
              <details key={q} className="group bg-surface">
                <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none text-xs font-medium text-foreground hover:text-accent-blue transition-colors select-none">
                  {q}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="shrink-0 text-muted group-open:rotate-180 transition-transform"
                    aria-hidden="true"
                  >
                    <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z" />
                  </svg>
                </summary>
                <p className="px-4 pb-3 text-xs text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>

        </div>{/* end left column */}

        {/* Right column — repos table */}
        {repos.length > 0 && (
          <div className="flex-1 flex flex-col px-8 py-12 lg:py-16 overflow-auto">
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-muted-subtle text-2xs uppercase tracking-widest">Community maps</p>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="size-1.5 rounded-full bg-accent-blue/70 animate-pulse inline-block" />
                  Live data
                </span>
              </div>
              {/* Fake search bar — clicks trigger Cmd+K CommandSearch */}
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", { metaKey: true, key: "k", bubbles: true }),
                  )
                }
                className="w-full flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2.5 text-left hover:border-accent-blue/40 transition-colors group"
                aria-label="Search mapped repos"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="shrink-0 text-muted-subtle group-hover:text-accent-blue transition-colors"
                  aria-hidden="true"
                >
                  <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
                </svg>
                <span className="flex-1 text-sm text-muted-subtle">
                  Search {repos.length} mapped repos...
                </span>
                <kbd className="hidden sm:block text-2xs text-muted-subtle bg-surface-alt border border-border rounded px-1.5 py-0.5">
                  ⌘K
                </kbd>
              </button>
            </div>
            <RepoTable repos={repos} />
          </div>
        )}

      </main>

      <Footer />

    </>
  );
}
