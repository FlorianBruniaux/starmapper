"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { MappedRepo } from "@/app/api/repos/route";

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

type CommandSearchProps = {
  repos: MappedRepo[];
};

export const CommandSearch = ({ repos }: CommandSearchProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    if (!query.trim()) return repos.slice(0, 12);
    const q = query.toLowerCase();
    return repos
      .filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [repos, query]);

  const openSearch = useCallback(() => {
    setOpen(true);
    setQuery("");
    setHighlighted(0);
  }, []);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const navigate = useCallback(
    (r: MappedRepo) => {
      router.push(`/${r.owner}/${r.repo}`);
      closeSearch();
    },
    [router, closeSearch],
  );

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open ? closeSearch() : openSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, openSearch, closeSearch]);

  // Dialog keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeSearch();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[highlighted]) navigate(filtered[highlighted]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, highlighted, navigate, closeSearch]);

  // Autofocus input on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset highlight when query changes
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center pt-16 px-4" role="presentation">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeSearch}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search mapped repositories"
        className="relative w-full max-w-2xl bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-subtle">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="shrink-0 text-muted-subtle"
            aria-hidden="true"
          >
            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search mapped repos..."
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-subtle outline-none"
            aria-label="Search repos"
            aria-controls="cs-list"
            aria-activedescendant={filtered[highlighted] ? `cs-item-${highlighted}` : undefined}
            autoComplete="off"
          />
          <kbd className="hidden sm:block text-2xs text-muted-subtle border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        {filtered.length > 0 ? (
          <ul
            id="cs-list"
            role="listbox"
            aria-label="Repository results"
            className="max-h-[520px] overflow-y-auto py-1"
          >
            {filtered.map((r, i) => (
              <li
                key={`${r.owner}/${r.repo}`}
                id={`cs-item-${i}`}
                role="option"
                aria-selected={i === highlighted}
                onClick={() => navigate(r)}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer transition-colors ${
                  i === highlighted ? "bg-accent-blue/10" : "hover:bg-surface-alt"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="shrink-0 text-muted-subtle"
                    aria-hidden="true"
                  >
                    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
                  </svg>
                  <span className="text-sm text-foreground truncate font-mono">
                    <span className="text-muted">{r.owner}/</span>
                    <span className="font-semibold">{r.repo}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="text-accent-orange"
                      aria-hidden="true"
                    >
                      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
                    </svg>
                    {formatCount(r.totalCount)}
                  </span>
                  <span className="text-accent-blue">{r.mappedPercent}%</span>
                  <span className="hidden sm:block text-muted-subtle">{timeAgo(r.updatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-subtle">
            {repos.length === 0 ? "No repos scanned yet." : `No match for "${query}"`}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border-subtle text-2xs text-muted-subtle">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
          <span className="ml-auto">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
};
