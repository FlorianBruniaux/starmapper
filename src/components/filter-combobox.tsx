// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

type FilterComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
};

export const FilterCombobox = ({ value, onChange, options, placeholder }: FilterComboboxProps) => {
  const uid = useId();
  const listboxId = `combobox-list-${uid}`;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const safe = options ?? [];
    if (!search) return safe;
    const q = search.toLowerCase();
    return safe.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  // All options including the synthetic "All" entry at index 0
  const allOptions = useMemo(() => ["", ...filtered], [filtered]);

  const activeOptionId = activeIndex >= 0 ? `combobox-opt-${uid}-${activeIndex}` : undefined;

  const handleSelect = useCallback((opt: string) => {
    onChange(opt);
    setOpen(false);
    setSearch("");
    setActiveIndex(-1);
    // Return focus to trigger
    triggerRef.current?.focus();
  }, [onChange]);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setSearch("");
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on focusout (keyboard tab away)
  useEffect(() => {
    if (!open) return;
    const handler = (e: FocusEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
        setOpen(false);
        setSearch("");
        setActiveIndex(-1);
      }
    };
    containerRef.current?.addEventListener("focusout", handler);
    const ref = containerRef.current;
    return () => ref?.removeEventListener("focusout", handler);
  }, [open]);

  // Focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  // Keyboard navigation in the search input
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeDropdown();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allOptions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(allOptions.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0) {
          handleSelect(allOptions[activeIndex]);
        } else if (filtered.length === 1) {
          handleSelect(filtered[0]);
        }
        break;
    }
  }, [open, allOptions, activeIndex, filtered, handleSelect, closeDropdown]);

  const hasValue = Boolean(value);
  const label = value || placeholder;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={`${placeholder} filter${hasValue ? `: ${value}` : ""}`}
        className={[
          "flex items-center gap-1 px-2 py-0.5 rounded text-2xs border transition-colors",
          "bg-background border-border hover:border-accent-blue/50",
          hasValue
            ? "text-accent-blue border-accent-blue/40"
            : "text-muted hover:text-foreground",
        ].join(" ")}
      >
        <span className="max-w-[80px] truncate" aria-hidden="true">{label}</span>
        <ChevronDown size={8} className="shrink-0 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-border bg-surface shadow-xl overflow-hidden">
          {/* Search */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={searchRef}
              role="combobox"
              aria-label={`Search ${placeholder} options`}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1); }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search…"
              className="w-full bg-transparent text-xs text-foreground placeholder-muted-subtle outline-none focus-visible:outline-none"
            />
          </div>

          {/* Options listbox */}
          <ul
            id={listboxId}
            role="listbox"
            aria-label={placeholder}
            className="max-h-48 overflow-y-auto"
          >
            {/* "All" / clear option */}
            <li
              id={`combobox-opt-${uid}-0`}
              role="option"
              aria-selected={!hasValue}
              onClick={handleSelect.bind(null, "")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(""); } }}
              tabIndex={-1}
              className={[
                "w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer",
                activeIndex === 0 ? "bg-surface-alt outline-2 outline-accent-blue outline-offset-[-2px]" : "",
                !hasValue
                  ? "text-accent-blue bg-accent-blue/10"
                  : "text-muted hover:bg-surface-alt hover:text-foreground",
              ].join(" ")}
            >
              All
            </li>

            {filtered.length === 0 ? (
              <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-2 text-xs text-muted-subtle">
                No results
              </li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt}
                  id={`combobox-opt-${uid}-${idx + 1}`}
                  role="option"
                  aria-selected={value === opt}
                  onClick={handleSelect.bind(null, opt)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect(opt); } }}
                  tabIndex={-1}
                  className={[
                    "w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer flex items-center justify-between gap-2",
                    activeIndex === idx + 1 ? "bg-surface-alt outline-2 outline-accent-blue outline-offset-[-2px]" : "",
                    value === opt
                      ? "text-accent-blue bg-accent-blue/10"
                      : "text-foreground hover:bg-surface-alt",
                  ].join(" ")}
                >
                  <span className="truncate">{opt}</span>
                  {value === opt && (
                    <Check size={10} className="shrink-0 text-accent-blue" aria-hidden="true" />
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
