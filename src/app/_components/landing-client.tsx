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
import { HeroGlobeDynamic } from "@/components/hero-globe-dynamic";
import { LandingTourAutoStart } from "@/components/tour/tour-provider";
import { TourTrigger } from "@/components/tour/tour-trigger";
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

type Props = { initialRepos: MappedRepo[]; initialTotal: number };

export const LandingClient = ({ initialRepos, initialTotal }: Props) => {
  const [input, setInput] = useState("");
  const [compareInput, setCompareInput] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const [error, setError] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setBookmarks(getBookmarks());
    setHasToken(!!getStoredToken());
  }, []);

  // Merge bookmarks + examples, deduplicate, bookmarks first (cap at 4)
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

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
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
      <CommandSearch repos={initialRepos} />

      {tokenOpen && (
        <TokenModal
          onClose={() => {
            setTokenOpen(false);
            setHasToken(!!getStoredToken());
          }}
        />
      )}

      <LandingTourAutoStart />
      <AnnouncementBanner />
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        rightAccessory={<TourTrigger tourId="landing" label="Tour" />}
      />

      <main id="main" className="min-h-screen bg-background flex flex-col">

        {/* ── Hero + Search ── */}
        <section className="w-full px-6 pt-16 pb-12 lg:pt-24 lg:pb-20">
          <div className="w-full max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">

              {/* Left: headline + form */}
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-widest">
                    GitHub Stargazers Map
                  </p>
                  <h1 className="text-4xl lg:text-5xl font-bold text-foreground leading-tight">
                    Where in the world does your repo shine?
                  </h1>

                  <p className="text-muted text-lg leading-relaxed max-w-lg">
                    Know where your stargazers live, who the influential
                    ones are, and whether the count is real.
                  </p>
                </div>

                {/* Value props: 3 lines, each with concrete benefit */}
                <ul className="flex flex-col gap-2.5" aria-label="Key features">
                  <li className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 size-4 shrink-0 rounded-full
                      bg-accent-orange/15 flex items-center justify-center">
                      <span className="size-1.5 rounded-full bg-accent-orange" />
                    </span>
                    <span className="text-muted">
                      <span className="text-foreground font-medium">
                        Organic Score
                      </span>
                      {" "}flags fake stars before investors or users trust the count
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 size-4 shrink-0 rounded-full
                      bg-accent-blue/15 flex items-center justify-center">
                      <span className="size-1.5 rounded-full bg-accent-blue" />
                    </span>
                    <span className="text-muted">
                      <span className="text-foreground font-medium">
                        Influential stargazers
                      </span>
                      {" "}filter by follower count to find the 10k-reach devs in your audience
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 size-4 shrink-0 rounded-full
                      bg-accent-green/15 flex items-center justify-center">
                      <span className="size-1.5 rounded-full bg-accent-green" />
                    </span>
                    <span className="text-muted">
                      <span className="text-foreground font-medium">
                        Dependent repos
                      </span>
                      {" "}shows every open-source project using your library, across npm, PyPI, Go, and more
                    </span>
                  </li>
                </ul>

                <form data-tour="landing-search" onSubmit={handleSubmit} className="flex flex-col gap-3">
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
                      className="sm:shrink-0 bg-accent-green-emphasis hover:opacity-90 hover:shadow-glow-green-cta text-white font-bold py-3 px-6 rounded-lg transition-[opacity,box-shadow] text-base whitespace-nowrap"
                    >
                      Map Stargazers
                    </button>
                  </div>

                  {/* Username hint */}
                  <p className="text-xs text-muted-subtle" aria-live="polite" aria-atomic="true">
                    {parseUsername(input) && (
                      <>
                        Looks like a username. Will scan all repos for{" "}
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
                    <p id="repo-input-error" className="text-accent-red text-xs" role="alert">
                      {error}
                    </p>
                  )}

                  {!showCompare && (
                    <button
                      data-tour="landing-compare"
                      type="button"
                      onClick={() => setShowCompare(true)}
                      className="text-xs text-muted-subtle hover:text-muted transition-colors self-start"
                    >
                      Compare two repos
                    </button>
                  )}
                </form>

                {/* Suggestion chips + social proof */}
                <div className="flex flex-col gap-3">
                  {suggestions.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {suggestions.map((b) => {
                        const key = `${b.owner}/${b.repo}`;
                        const recent = isBookmark(b);
                        return (
                          <button
                            key={key}
                            onClick={() => handleSuggestion(b)}
                            className={`text-xs rounded px-3 py-1.5 border
                              transition-colors ${
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
                  {initialTotal > 0 && (
                    <p className="text-xs text-muted-subtle">
                      {initialTotal.toLocaleString()}+ repos mapped by the
                      community so far
                    </p>
                  )}
                  <p className="text-2xs text-muted-subtle flex items-center gap-1.5">
                    <span>1. Paste a repo</span>
                    <span className="text-border" aria-hidden="true">·</span>
                    <span>2. We scan GitHub</span>
                    <span className="text-border" aria-hidden="true">·</span>
                    <span>3. Everyone sees the map</span>
                  </p>
                </div>
              </div>

              {/* Right: rotating globe */}
              <div className="hidden lg:flex lg:items-center lg:justify-center" aria-hidden="true">
                <div className="relative w-full aspect-square max-w-md">
                  <HeroGlobeDynamic />
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── Features, framed between borders ── */}
        <div className="border-y border-border-subtle">
        <section data-tour="landing-features" className="w-full max-w-7xl mx-auto px-4 lg:px-6 py-10">
          <h2 className="text-muted-subtle text-2xs uppercase tracking-widest mb-6 text-center">
            More to explore
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              {
                href: "/explore",
                label: "Explore",
                desc: "Find your most influential stargazers. Filter by reach, see company distribution, spot cross-repo fans.",
                colorClass: "text-accent-blue",
                bgClass: "bg-accent-blue/8",
                icon: <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />,
              },
              {
                href: "/profile/FlorianBruniaux",
                label: "Developer profiles",
                desc: "Any GitHub username becomes a profile: map, nearby developers, top repos, and a contact point for maintainers.",
                colorClass: "text-accent-purple",
                bgClass: "bg-accent-purple/8",
                icon: <path d="M10.25 2.0a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0ZM1 14a6 6 0 1 1 12 0H1Z" />,
              },
              {
                href: "/devs",
                label: "Dev Maps",
                desc: "Where are the Rust developers, the Go community? Global developer density filtered by language.",
                colorClass: "text-accent-green",
                bgClass: "bg-accent-green/8",
                icon: <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 0 1 .75-3.054l1.61 1.61A2.999 2.999 0 0 0 3 8c0 .126.007.251.02.374l-1.546.682A6.47 6.47 0 0 1 1.5 8Zm1.23 4.065.886-1.328A2.999 2.999 0 0 0 8 11c.63 0 1.215-.19 1.701-.516l.886 1.328A6.5 6.5 0 0 1 2.73 12.065ZM8 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4.52 2.565.886 1.328A6.5 6.5 0 0 0 14.5 8c0-.318-.026-.63-.074-.935l-1.546.682c.013.123.02.248.02.374a3 3 0 0 1-.38 1.444Z" />,
              },
              {
                href: "/devs/atlas",
                label: "Language Atlas",
                desc: "Which language dominates each country, across 180+ countries in a single choropleth. Click any country for the full breakdown.",
                colorClass: "text-accent-orange",
                bgClass: "bg-accent-orange/8",
                icon: <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c.712 0 1.373.333 1.75.88.377-.547 1.038-.88 1.75-.88h4.747a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.747a1 1 0 0 0-1 1v.25a.75.75 0 0 1-1.5 0v-.25a1 1 0 0 0-1-1H.75a.75.75 0 0 1-.75-.75Zm7.5 10.931V3.455c-.32-.274-.717-.455-1.247-.455H1.5v9h3.247c.91 0 1.79.285 2.503.926Zm1.5-7.476v8.476a4.488 4.488 0 0 1 2.503-.926H14.5V3h-3.997c-.53 0-.927.18-1.247.455-.32.274-.506.62-.506 1.206Z" />,
              },
              {
                href: "/trending",
                label: "Trending",
                desc: "Repos gaining stars the fastest right now, with the map of their audience.",
                colorClass: "text-accent-red",
                bgClass: "bg-accent-red/8",
                icon: <path d="M1.5 2.5h2.5v11H1.5Zm4.5 4h2.5v7H6Zm4.5-2.5H13v9.5h-2.5Z" />,
              },
              {
                href: "/FlorianBruniaux/followers",
                label: "Followers map",
                desc: "See where your GitHub followers live. Map any user's followers: who follows you, and where in the world they are.",
                colorClass: "text-accent-blue",
                bgClass: "bg-accent-blue/8",
                icon: <path d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.628.75.75 0 0 1-.514-.637 3.499 3.499 0 0 0-6.651-.609.75.75 0 1 1-1.443-.389A5.011 5.011 0 0 1 8.9 8.92 3.001 3.001 0 0 1 11 4ZM5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
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
            <Link
              href="/vercel/next.js/dependents"
              className="flex flex-col gap-3 bg-surface border border-border-subtle rounded-lg p-4 hover:border-accent-blue/40 transition-colors group"
            >
              <div className="size-7 shrink-0 flex items-center justify-center rounded-md bg-accent-green/8">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-accent-green">
                  <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 8.75 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs font-semibold text-foreground group-hover:underline">Dependents Explorer</div>
                  <span className="text-2xs font-semibold bg-accent-green/15 text-accent-green px-1.5 py-0.5 rounded uppercase tracking-wide">New</span>
                </div>
                <div className="text-muted text-xs leading-relaxed">
                  See every repo that depends on a library, sorted by stars or forks, with ecosystem badges (npm, PyPI, Go, Maven, Cargo, and more).
                </div>
              </div>
            </Link>
            <Link
              href="/rtk-ai/rtk/contributors"
              className="flex flex-col gap-3 bg-surface border border-border-subtle rounded-lg p-4 hover:border-accent-blue/40 transition-colors group"
            >
              <div className="size-7 shrink-0 flex items-center justify-center rounded-md bg-accent-blue/8">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-accent-blue">
                  <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs font-semibold text-foreground group-hover:underline">Contributors Map</div>
                  <span className="text-2xs font-semibold bg-accent-blue/15 text-accent-blue px-1.5 py-0.5 rounded uppercase tracking-wide">New</span>
                </div>
                <div className="text-muted text-xs leading-relaxed">
                  Who built this? Map the contributors of any repo, see commit distribution across countries, and explore builder profiles.
                </div>
              </div>
            </Link>
            <a
              href="https://www.npmjs.com/package/starmapper-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-3 bg-surface border border-border-subtle rounded-lg p-4 hover:border-accent-blue/40 transition-colors group"
            >
              <div className="size-7 shrink-0 flex items-center justify-center rounded-md bg-accent-purple/8">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="text-accent-purple">
                  <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Zm2.97 3.22a.75.75 0 0 1 1.06 0L7.53 7.47l-1.75 1.75a.75.75 0 1 1-1.06-1.06l1.22-1.22-1.22-1.22a.75.75 0 0 1 0-1.06Zm4.28 4.28a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 0 1.5h-2Z" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs font-semibold text-foreground group-hover:underline">MCP Server</div>
                  <span className="text-2xs font-semibold bg-accent-purple/15 text-accent-purple px-1.5 py-0.5 rounded uppercase tracking-wide">New</span>
                </div>
                <div className="text-muted text-xs leading-relaxed">
                  Query any repo&apos;s audience data from Claude Code or any AI assistant. Install with{" "}
                  <code className="font-mono bg-surface-alt px-1 rounded text-foreground">npx starmapper-mcp</code>.
                </div>
              </div>
            </a>
          </div>
        </section>
        </div>{/* end border-y wrapper */}

        {/* ── FAQ + comparison links ── */}
        <div className="w-full max-w-7xl mx-auto px-4 lg:px-6 pb-8 flex items-center justify-between">
          <Link href="/vs/star-history" className="text-xs text-muted-subtle hover:text-muted transition-colors">
            How does StarMapper compare to star-history.com? →
          </Link>
          <Link href="/faq" className="text-xs text-muted-subtle hover:text-muted transition-colors">
            Questions? See FAQ →
          </Link>
        </div>

        {/* ── Community Maps (featured) ── */}
        {initialRepos.length > 0 && (
          <section data-tour="landing-community" className="w-full max-w-7xl mx-auto px-4 lg:px-6 pt-4 pb-16">
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
                Browse all {initialTotal > 0 ? initialTotal.toLocaleString() : ""} repos
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {initialRepos.map((repo) => (
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
        )}

        {/* ── Sponsors ── */}
        <SponsorsBlock />

      </main>

      <Footer />
    </>
  );
};
