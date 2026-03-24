"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { getBookmarks } from "@/lib/bookmarks";
import type { Bookmark } from "@/lib/bookmarks";

type Suggestion = { owner: string; repo: string };

const EXAMPLES: Suggestion[] = [
  { owner: "FlorianBruniaux", repo: "claude-code-ultimate-guide" },
  { owner: "rtk-ai", repo: "rtk" },
  { owner: "torvalds", repo: "linux" },
];

const parseRepo = (val: string): { owner: string; repo: string } | null => {
  const cleaned = val.trim().replace(/\/$/, "").replace("https://github.com/", "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
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
  const router = useRouter();

  useEffect(() => {
    setBookmarks(getBookmarks());
    setHasToken(!!getStoredToken());
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
    if (!parsed) {
      setError("Enter a valid GitHub repo URL or owner/repo");
      return;
    }
    if (compareInput.trim()) {
      const parsed2 = parseRepo(compareInput);
      if (parsed2) {
        router.push(`/${parsed.owner}/${parsed.repo}?compare=${parsed2.owner}/${parsed2.repo}`);
        return;
      }
    }
    router.push(`/${parsed.owner}/${parsed.repo}`);
  };

  const handleSuggestion = (b: Suggestion) => {
    setInput(`${b.owner}/${b.repo}`);
    setError("");
  };

  const isBookmark = (b: Suggestion) =>
    bookmarks.some((bm) => bm.owner === b.owner && bm.repo === b.repo);

  return (
    <>
      {tokenOpen && (
        <TokenModal
          onClose={() => {
            setTokenOpen(false);
            setHasToken(!!getStoredToken());
          }}
        />
      )}

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-3 bg-[#0d1117]/80 backdrop-blur-sm border-b border-[#21262d]">
        <div className="flex items-center gap-2 text-[#f0f6fc] font-semibold text-sm">
          <span aria-hidden="true">🌍</span>
          <span>StarMapper</span>
        </div>
        <button
          onClick={() => setTokenOpen(true)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            hasToken
              ? "border-[#238636] text-[#3fb950] hover:bg-[#238636]/10"
              : "border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#58a6ff]"
          }`}
        >
          {hasToken ? (
            <>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
              Token set
            </>
          ) : (
            <>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z" />
              </svg>
              Add token
            </>
          )}
        </button>
      </header>

      {/* Main */}
      <main className="min-h-screen bg-[#0d1117] flex flex-col items-center justify-center px-4 pt-16 pb-16">
        <div className="max-w-md w-full">

          {/* Hero — minimal, text-left to align with form */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-[#f0f6fc] mb-1">
              Map your stargazers
            </h1>
            <p className="text-[#8b949e] text-sm">
              See where in the world your GitHub repo is loved.
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
              placeholder="github.com/owner/repo"
              className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 text-[#f0f6fc] placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] text-sm transition-colors"
              autoFocus
              aria-label="GitHub repository URL"
            />

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
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 pr-10 text-[#f0f6fc] placeholder-[#484f58] focus:outline-none focus:border-[#a371f7] text-sm transition-colors"
                  aria-label="Compare with repository"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowCompare(false);
                    setCompareInput("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#484f58] hover:text-[#8b949e] transition-colors"
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
              <p className="text-[#f85149] text-xs px-1" role="alert">
                {error}
              </p>
            )}

            {/* Actions row: CTA + compare toggle */}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-[#238636] hover:bg-[#2ea043] text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
              >
                Map Stargazers
              </button>
              {!showCompare && (
                <button
                  type="button"
                  onClick={() => setShowCompare(true)}
                  className="flex items-center gap-1.5 px-3 py-3 bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] text-[#8b949e] hover:text-[#58a6ff] rounded-lg transition-colors text-xs whitespace-nowrap"
                  title="Compare with another repo"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M9.573.677A1 1 0 0 0 8.455.032L4.03 1.323a1 1 0 0 0-.614 1.33l.48 1.197a6.003 6.003 0 0 0-2.798 6.969C1.703 12.415 3.388 14 5.374 14c1.013 0 1.96-.38 2.685-1.004A6.005 6.005 0 0 0 14 8c0-2.167-1.147-4.063-2.867-5.123L9.574.677ZM10.5 8a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                  </svg>
                  Compare
                </button>
              )}
            </div>

            {/* Token nudge — inline, low weight */}
            {!hasToken && (
              <p className="text-[11px] text-[#484f58] text-center pt-0.5">
                <span className="text-[#f0883e]">No token:</span> 60 req/hr limit.{" "}
                <button
                  type="button"
                  onClick={() => setTokenOpen(true)}
                  className="text-[#58a6ff] hover:underline"
                >
                  Add yours
                </button>{" "}
                for 5,000/hr.
              </p>
            )}
          </form>

          {/* Suggestions — unified: bookmarks first, then examples to fill */}
          {suggestions.length > 0 && (
            <div className="mt-6">
              <p className="text-[#484f58] text-[10px] uppercase tracking-widest mb-2.5">
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
                          ? "bg-[#161b22] border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#58a6ff]"
                          : "bg-transparent border-[#21262d] text-[#484f58] hover:text-[#8b949e] hover:border-[#30363d]"
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
      </main>

      {/* Minimal footer — context link, not in the main flow */}
      <footer className="fixed bottom-0 left-0 right-0 flex items-center justify-center px-6 py-3 bg-[#0d1117]/70 backdrop-blur-sm border-t border-[#21262d]">
        <p className="text-[#484f58] text-[11px]">
          Not on the map?{" "}
          <a
            href="https://github.com/settings/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8b949e] hover:text-[#58a6ff] transition-colors"
          >
            Add a location to your GitHub profile
          </a>
        </p>
      </footer>
    </>
  );
}
