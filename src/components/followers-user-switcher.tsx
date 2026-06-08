// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, Loader2, Users } from "lucide-react";
import type { UserAutocompleteItem } from "@/app/api/users/autocomplete/route";

// ---------- Trigger button shown in the header ----------

type TriggerProps = {
  currentOwner: string;
  onClick: () => void;
};

export const FollowersUserSwitcherTrigger = ({ currentOwner, onClick }: TriggerProps) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-2 bg-surface-alt border border-border rounded-lg
               px-3 py-1.5 text-sm text-muted hover:text-foreground hover:border-accent-blue
               transition-colors shadow-sm"
    aria-label="Search for another GitHub user"
    style={{ minWidth: "160px", maxWidth: "260px" }}
  >
    <Search size={13} className="shrink-0 text-muted-subtle" aria-hidden="true" />
    <span className="truncate flex-1 text-left">@{currentOwner}</span>
    <kbd className="hidden sm:block text-2xs text-muted-subtle border border-border rounded px-1 py-0.5 shrink-0">
      /
    </kbd>
  </button>
);

// ---------- Modal ----------

type ModalProps = {
  currentOwner: string;
  onClose: () => void;
};

const FollowersUserSwitcherModal = ({ currentOwner, onClose }: ModalProps) => {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UserAutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Autofocus on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  // Fetch on query change
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(
          `/api/users/autocomplete?q=${encodeURIComponent(q)}`,
          { signal: abortRef.current.signal },
        );
        if (!res.ok) throw new Error("fetch failed");
        const items: UserAutocompleteItem[] = await res.json();
        setSuggestions(items);
        setActiveIndex(0);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const navigateTo = useCallback(
    (login: string) => {
      onClose();
      router.push(`/${login}/followers`);
    },
    [router, onClose],
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = suggestions[activeIndex];
        if (target) {
          navigateTo(target.login);
        } else {
          const trimmed = query.trim();
          if (trimmed) navigateTo(trimmed);
        }
      } else if (e.key === "/" && e.target === document.body) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [suggestions, activeIndex, query, navigateTo, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" role="presentation">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search GitHub users"
        className="relative w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border-subtle">
          {loading ? (
            <Loader2 size={15} className="shrink-0 text-accent-blue animate-spin" aria-hidden="true" />
          ) : (
            <Search size={15} className="shrink-0 text-muted-subtle" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder={`Search GitHub users (currently @${currentOwner})`}
            className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-subtle outline-none"
            aria-label="Search GitHub users"
            aria-controls="fus-list"
            aria-activedescendant={suggestions[activeIndex] ? `fus-item-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:block text-2xs text-muted-subtle border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        {suggestions.length > 0 && (
          <ul
            id="fus-list"
            role="listbox"
            aria-label="User results"
            className="max-h-80 overflow-y-auto py-1"
          >
            {suggestions.map((item, i) => (
              <li
                key={item.login}
                id={`fus-item-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => navigateTo(item.login)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
                  i === activeIndex ? "bg-accent-blue/10" : "hover:bg-surface-alt"
                }`}
              >
                <Image
                  src={item.avatarUrl || `https://avatars.githubusercontent.com/${item.login}`}
                  alt=""
                  width={28}
                  height={28}
                  className="rounded-full shrink-0"
                  unoptimized
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm text-foreground font-medium truncate">{item.login}</span>
                  {item.name && (
                    <span className="text-xs text-muted truncate">{item.name}</span>
                  )}
                </div>
                <Users size={12} className="ml-auto shrink-0 text-muted-subtle" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}

        {/* Empty state — only shown when user has typed something */}
        {query.trim().length >= 2 && !loading && suggestions.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-subtle">
            No GitHub users found for &ldquo;{query}&rdquo;
          </div>
        )}

        {/* Hint when field is empty */}
        {query.trim().length < 2 && (
          <div className="px-5 py-6 text-center text-sm text-muted-subtle">
            Type a GitHub username or name
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 px-5 py-2.5 border-t border-border-subtle text-2xs text-muted-subtle">
          <span>↑↓ Navigate</span>
          <span>↵ View followers</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
};

// ---------- Root export — trigger + modal wired together ----------

type Props = {
  currentOwner: string;
};

export const FollowersUserSwitcher = ({ currentOwner }: Props) => {
  const [open, setOpen] = useState(false);

  // Open on "/" keypress (when not in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <FollowersUserSwitcherTrigger currentOwner={currentOwner} onClick={() => setOpen(true)} />
      {open && (
        <FollowersUserSwitcherModal
          currentOwner={currentOwner}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};
