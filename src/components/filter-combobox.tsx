"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FilterComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
};

export const FilterCombobox = ({ value, onChange, options, placeholder }: FilterComboboxProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const handleSelect = useCallback((opt: string) => {
    onChange(opt);
    setOpen(false);
    setSearch("");
  }, [onChange]);

  const handleClear = useCallback(() => {
    onChange("");
    setOpen(false);
    setSearch("");
  }, [onChange]);

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

  // Focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  const label = value || placeholder;
  const hasValue = Boolean(value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors",
          "bg-background border-border hover:border-accent-blue/50",
          hasValue
            ? "text-accent-blue border-accent-blue/40"
            : "text-muted hover:text-foreground",
        ].join(" ")}
      >
        <span className="max-w-[80px] truncate">{label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="shrink-0 opacity-60">
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-border bg-surface shadow-xl overflow-hidden">
          {/* Search */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-[11px] text-foreground placeholder-muted-subtle outline-none"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto">
            {/* "All" / clear option */}
            <button
              type="button"
              onClick={handleClear}
              className={[
                "w-full text-left px-3 py-1.5 text-[11px] transition-colors",
                !hasValue
                  ? "text-accent-blue bg-accent-blue/10"
                  : "text-muted hover:bg-surface-alt hover:text-foreground",
              ].join(" ")}
            >
              All
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-subtle">No results</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={[
                    "w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-2",
                    value === opt
                      ? "text-accent-blue bg-accent-blue/10"
                      : "text-foreground hover:bg-surface-alt",
                  ].join(" ")}
                >
                  <span className="truncate">{opt}</span>
                  {value === opt && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-accent-blue">
                      <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
