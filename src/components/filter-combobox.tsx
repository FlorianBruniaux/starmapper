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
          "bg-[#0d1117] border-[#30363d] hover:border-[#58a6ff]/50",
          hasValue
            ? "text-[#58a6ff] border-[#58a6ff]/40"
            : "text-[#8b949e] hover:text-[#e6edf3]",
        ].join(" ")}
      >
        <span className="max-w-[80px] truncate">{label}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="shrink-0 opacity-60">
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-[#30363d] bg-[#161b22] shadow-xl overflow-hidden">
          {/* Search */}
          <div className="border-b border-[#30363d] px-2 py-1.5">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-[11px] text-[#e6edf3] placeholder-[#484f58] outline-none"
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
                  ? "text-[#58a6ff] bg-[#58a6ff]/10"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
              ].join(" ")}
            >
              All
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[#484f58]">No results</div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={[
                    "w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center justify-between gap-2",
                    value === opt
                      ? "text-[#58a6ff] bg-[#58a6ff]/10"
                      : "text-[#e6edf3] hover:bg-[#21262d]",
                  ].join(" ")}
                >
                  <span className="truncate">{opt}</span>
                  {value === opt && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                      <path d="M2 5L4 7L8 3" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
