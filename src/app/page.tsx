"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TokenModal } from "@/components/token-modal";
import { getStoredToken } from "@/components/token-modal";
import { getBookmarks } from "@/lib/bookmarks";
import type { Bookmark } from "@/lib/bookmarks";

export default function HomePage() {
  const [input, setInput] = useState("");
  const [compareInput, setCompareInput] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const [error, setError] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const router = useRouter();

  useEffect(() => { setBookmarks(getBookmarks()); }, []);

  function parseRepo(val: string): { owner: string; repo: string } | null {
    const cleaned = val.trim().replace(/\/$/, "").replace("https://github.com/", "");
    const parts = cleaned.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseRepo(input);
    if (!parsed) { setError("Enter a valid GitHub repo URL or owner/repo"); return; }
    if (compareInput.trim()) {
      const parsed2 = parseRepo(compareInput);
      if (parsed2) {
        router.push(`/${parsed.owner}/${parsed.repo}?compare=${parsed2.owner}/${parsed2.repo}`);
        return;
      }
    }
    router.push(`/${parsed.owner}/${parsed.repo}`);
  }

  const hasToken = typeof window !== "undefined" && !!getStoredToken();

  return (
    <>
      {tokenOpen && <TokenModal onClose={() => setTokenOpen(false)} />}

      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-3 bg-[#0d1117]/80 backdrop-blur-sm border-b border-[#21262d]">
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <span>🌍</span>
          <span>StarMapper</span>
        </div>
        <button
          onClick={() => setTokenOpen(true)}
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            hasToken
              ? "border-[#238636] text-[#3fb950] hover:bg-[#238636]/10"
              : "border-[#30363d] text-[#8b949e] hover:text-[#f0f6fc] hover:border-[#58a6ff]"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
          </svg>
          {hasToken ? "Token set" : "Add access token"}
        </button>
      </header>

      <main className="min-h-screen bg-[#0d1117] flex flex-col items-center justify-center px-4 pt-16">
        <div className="max-w-lg w-full text-center">
          <div className="mb-2 text-4xl">🌍</div>
          <h1 className="text-3xl font-bold text-white mb-2">StarMapper</h1>
          <p className="text-[#8b949e] mb-8 text-sm">
            Visualize where your GitHub stargazers are in the world
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              placeholder="https://github.com/owner/repo"
              className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 text-white placeholder-[#484f58] focus:outline-none focus:border-[#58a6ff] text-sm transition-colors"
              autoFocus
            />
            {showCompare ? (
              <div className="relative">
                <input
                  value={compareInput}
                  onChange={(e) => { setCompareInput(e.target.value); setError(""); }}
                  placeholder="Compare with: owner/repo"
                  autoFocus
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3 text-white placeholder-[#484f58] focus:outline-none focus:border-[#a371f7] text-sm transition-colors"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCompare(true)}
                className="text-xs text-[#484f58] hover:text-[#58a6ff] transition-colors text-left"
              >
                + Compare with another repo
              </button>
            )}
            {error && <p className="text-[#f85149] text-xs text-left">{error}</p>}
            <button
              type="submit"
              className="bg-[#238636] hover:bg-[#2ea043] text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
            >
              Map Stargazers →
            </button>
          </form>

          <div className="mt-8 flex gap-3 justify-center flex-wrap">
            {["FlorianBruniaux/claude-code-ultimate-guide", "rtk-ai/rtk", "torvalds/linux"].map((r) => (
              <button
                key={r}
                onClick={() => { setInput(r); setError(""); }}
                className="text-xs text-[#58a6ff] hover:underline bg-[#161b22] border border-[#30363d] rounded px-2 py-1"
              >
                {r}
              </button>
            ))}
          </div>

          {bookmarks.length > 0 && (
            <div className="mt-6 pt-4 border-t border-[#21262d]">
              <p className="text-[#484f58] text-[10px] mb-2 uppercase tracking-widest">Recently viewed</p>
              <div className="flex gap-2 justify-center flex-wrap">
                {bookmarks.map((b) => (
                  <button
                    key={`${b.owner}/${b.repo}`}
                    onClick={() => router.push(`/${b.owner}/${b.repo}`)}
                    className="text-xs text-[#8b949e] hover:text-[#f0f6fc] bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] rounded px-2 py-1 transition-colors"
                  >
                    {b.owner}/{b.repo}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!hasToken && (
            <p className="mt-3 text-[11px] text-[#8b949e]">
              <span className="text-[#f0883e]">No token:</span> limited to 60 req/hr.{" "}
              <button onClick={() => setTokenOpen(true)} className="text-[#58a6ff] hover:underline">
                Add yours
              </button>{" "}
              for 5,000 req/hr.
            </p>
          )}

          <div className="mt-8 pt-8 border-t border-[#21262d]">
            <p className="text-[#8b949e] text-xs mb-3">
              Not showing up on the map? Your GitHub profile needs a location.
            </p>
            <a
              href="https://github.com/settings/profile"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff] text-[#e6edf3] hover:text-white rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              Set your location on GitHub
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
