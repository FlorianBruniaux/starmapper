// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type LanguageOption = {
  slug: string;
  name: string;
  count: number;
};

type Props = {
  currentSlug: string;
  currentName: string;
  options: LanguageOption[];
  loading: boolean;
  onSelect: (slug: string) => void;
};

export const LanguageSwitcher = ({
  currentSlug,
  currentName,
  options,
  loading,
  onSelect,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, search]);

  const handleSelect = useCallback((slug: string) => {
    onSelect(slug);
    setOpen(false);
    setSearch("");
  }, [onSelect]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setSearch(""); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Focus search input when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Switch language"
        aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex items-center gap-1.5 px-2.5 py-1 rounded text-sm border transition-colors",
          "bg-surface border-border",
          loading
            ? "opacity-60 cursor-not-allowed text-muted"
            : "hover:border-accent-blue/50 text-accent-blue",
        ].join(" ")}
      >
        <span className="font-semibold">{currentName}</span>
        {!loading && (
          <ChevronDown size={9} className="shrink-0 opacity-60" aria-hidden="true" />
        )}
      </button>

      {open && !loading && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-56 rounded-md border border-border bg-surface shadow-xl overflow-hidden">
          {/* Search */}
          <div className="border-b border-border px-2.5 py-1.5">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search language…"
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-subtle outline-none"
            />
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-subtle">
                {options.length === 0 ? "No languages available" : "No results"}
              </div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.slug}
                  type="button"
                  onClick={() => handleSelect(opt.slug)}
                  className={[
                    "w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-3",
                    opt.slug === currentSlug
                      ? "text-accent-blue bg-accent-blue/10"
                      : "text-foreground hover:bg-surface-alt",
                  ].join(" ")}
                >
                  <span className="truncate">{opt.name}</span>
                  <span className="text-muted shrink-0">{opt.count.toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
