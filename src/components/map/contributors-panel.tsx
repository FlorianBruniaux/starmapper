// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { X, Search, MapPin } from "lucide-react";
import type { ContributorPoint } from "@/app/api/contributors-chunk/route";

type AnyContributor = {
  login: string;
  contributions: number;
  location: string | null;
  mapped: boolean;
};

type ContributorsPanelProps = {
  open: boolean;
  onClose: () => void;
  points: ContributorPoint[];
  unmapped: { login: string; contributions: number }[];
  setFlyTarget: (target: { lat: number; lng: number; login: string } | null) => void;
};

const ROW_H = 52;
const OVERSCAN = 5;

const formatCommits = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
};

const AVATAR_COLORS = [
  "bg-accent-blue",
  "bg-accent-green",
  "bg-accent-orange",
  "bg-accent-red",
  "bg-accent-purple",
];

const avatarColorFor = (login: string): string => {
  const idx = login.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx] ?? "bg-surface-alt";
};

export const ContributorsPanel = ({
  open,
  onClose,
  points,
  unmapped,
  setFlyTarget,
}: ContributorsPanelProps) => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterState, setFilterState] = useState<"all" | "mapped" | "unmapped">("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [deferredSearch, filterState]);

  const allContributors: AnyContributor[] = useMemo(() => {
    const mapped: AnyContributor[] = points.map((p) => ({
      login: p.login,
      contributions: p.contributions,
      location: p.location,
      mapped: true,
    }));
    const unmappedEntries: AnyContributor[] = unmapped.map((u) => ({
      login: u.login,
      contributions: u.contributions,
      location: null,
      mapped: false,
    }));
    return [...mapped, ...unmappedEntries];
  }, [points, unmapped]);

  const filtered: AnyContributor[] = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    let list = allContributors;
    if (q) {
      list = list.filter(
        (c) =>
          c.login.toLowerCase().includes(q) ||
          (c.location?.toLowerCase().includes(q) ?? false),
      );
    }
    if (filterState === "mapped") list = list.filter((c) => c.mapped);
    if (filterState === "unmapped") list = list.filter((c) => !c.mapped);
    return [...list].sort((a, b) => b.contributions - a.contributions);
  }, [allContributors, deferredSearch, filterState]);

  const totalRows = filtered.length;
  const vStart = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const vEnd = Math.min(totalRows, vStart + Math.ceil(containerH / ROW_H) + OVERSCAN * 2);
  const visible = filtered.slice(vStart, vEnd);
  const padTop = vStart * ROW_H;
  const padBottom = (totalRows - vEnd) * ROW_H;

  const total = allContributors.length;
  const mappedCount = points.length;

  return (
    <aside
      aria-label="Contributors list"
      aria-hidden={!open}
      className={[
        "absolute z-20 flex flex-col bg-surface border-border",
        "md:left-0 md:right-auto md:top-0 md:bottom-0 md:w-72 md:border-r md:rounded-none md:max-h-none",
        "md:transition-transform md:duration-300",
        open ? "md:translate-x-0 md:translate-y-0" : "md:-translate-x-full",
        "left-0 right-0 bottom-0 max-h-[80dvh] rounded-t-2xl border-t",
        "transition-transform duration-300",
        open ? "translate-y-0" : "translate-y-full",
        !open && "pointer-events-none",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-foreground font-semibold text-sm">Contributors</h2>
          <span className="text-muted text-xs tabular-nums">
            {filtered.length !== total
              ? `${filtered.length} / ${total.toLocaleString()}`
              : total.toLocaleString()}
          </span>
          <span className="text-muted-subtle text-xs">
            ({mappedCount.toLocaleString()} mapped)
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close contributors panel"
          className="flex items-center justify-center min-h-11 min-w-11 text-muted hover:text-foreground transition-colors -mr-2"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 pt-2 pb-1 flex-shrink-0" role="radiogroup" aria-label="Filter by location">
        {(["all", "mapped", "unmapped"] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={filterState === v}
            onClick={() => setFilterState(v)}
            className={[
              "px-2.5 py-1 rounded text-xs transition-colors",
              filterState === v
                ? "bg-accent-blue text-white"
                : "bg-surface-alt text-muted hover:text-foreground",
            ].join(" ")}
          >
            {v === "all" ? "All" : v === "mapped" ? "On map" : "No location"}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="px-4 py-2 flex-shrink-0">
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-subtle pointer-events-none"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contributors…"
            aria-label="Search contributors"
            className="w-full bg-background border border-border rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-subtle focus:outline-none focus:border-accent-blue"
          />
        </div>
      </div>

      {/* Virtual list */}
      <div
        ref={listRef}
        className="overflow-y-auto flex-1"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {padTop > 0 && <div style={{ height: padTop }} />}

        {visible.map((c) => {
          const pt = c.mapped ? points.find((p) => p.login === c.login) : undefined;
          return (
            <div
              key={c.login}
              className="group flex items-center gap-2.5 px-4 border-b border-surface-alt hover:bg-background transition-colors"
              style={{ height: ROW_H }}
            >
              {/* Avatar placeholder */}
              <div
                className={`size-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold ${avatarColorFor(c.login)}`}
                aria-hidden="true"
              >
                {c.login[0]?.toUpperCase() ?? "?"}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <a
                  href={`https://github.com/${c.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue text-xs font-medium hover:underline leading-tight block truncate"
                >
                  @{c.login}
                </a>
                {c.location && (
                  <div className="text-muted text-xs truncate leading-tight">{c.location}</div>
                )}
              </div>

              {/* Commits badge */}
              <span className="text-muted-subtle text-xs tabular-nums flex-shrink-0">
                {formatCommits(c.contributions)} commits
              </span>

              {/* Map pin button (mapped) or dot (unmapped) */}
              {c.mapped && pt ? (
                <button
                  onClick={() => {
                    setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login });
                  }}
                  aria-label={`Fly to ${c.login} on map`}
                  className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-muted hover:text-accent-blue transition-all p-1 -mr-1"
                >
                  <MapPin size={14} aria-hidden="true" />
                </button>
              ) : (
                <span
                  role="img"
                  aria-label="No location"
                  className="flex-shrink-0 inline-block size-1.5 rounded-full bg-border"
                />
              )}
            </div>
          );
        })}

        {padBottom > 0 && <div style={{ height: padBottom }} />}

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-subtle text-xs px-4">
            {search
              ? `No results for "${search}"`
              : filterState === "mapped"
                ? "No mapped contributors yet"
                : filterState === "unmapped"
                  ? "All contributors are mapped"
                  : "No contributors yet"}
          </div>
        )}
      </div>
    </aside>
  );
};
