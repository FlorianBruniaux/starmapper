// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { X, Search, MapPin } from "lucide-react";
import type { FollowerPoint } from "@/app/api/followers-chunk/route";
import type { UnmappedFollowerEntry } from "@/hooks/useFollowersScanController";

type AnyFollower = {
  login: string;
  name: string | null;
  followers: number;
  avatarUrl: string;
  location: string | null;
  mapped: boolean;
};

type FollowersPanelProps = {
  open: boolean;
  onClose: () => void;
  points: FollowerPoint[];
  unmapped: UnmappedFollowerEntry[];
  setFlyTarget: (target: { lat: number; lng: number; login: string } | null) => void;
};

const ROW_H = 52;
const OVERSCAN = 5;

const formatFollowers = (n: number): string => {
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

export const FollowersPanel = ({
  open,
  onClose,
  points,
  unmapped,
  setFlyTarget,
}: FollowersPanelProps) => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterState, setFilterState] = useState<"all" | "mapped" | "unmapped">("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(400);
  const listRef = useRef<HTMLDivElement>(null);

  // ResizeObserver to track container height
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll when filters change
  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [deferredSearch, filterState]);

  const allFollowers: AnyFollower[] = useMemo(() => {
    const mapped: AnyFollower[] = points.map((p) => ({
      login: p.login,
      name: p.name,
      followers: p.followers,
      avatarUrl: p.avatarUrl,
      location: p.location,
      mapped: true,
    }));
    const unmappedEntries: AnyFollower[] = unmapped.map((u) => ({
      login: u.login,
      name: u.name,
      followers: u.followers,
      avatarUrl: u.avatarUrl,
      location: null,
      mapped: false,
    }));
    return [...mapped, ...unmappedEntries];
  }, [points, unmapped]);

  const filtered: AnyFollower[] = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    let list = allFollowers;
    if (q) {
      list = list.filter(
        (f) =>
          f.login.toLowerCase().includes(q) ||
          (f.name?.toLowerCase().includes(q) ?? false) ||
          (f.location?.toLowerCase().includes(q) ?? false),
      );
    }
    if (filterState === "mapped") list = list.filter((f) => f.mapped);
    if (filterState === "unmapped") list = list.filter((f) => !f.mapped);
    return [...list].sort((a, b) => b.followers - a.followers);
  }, [allFollowers, deferredSearch, filterState]);

  const totalRows = filtered.length;
  const vStart = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const vEnd = Math.min(totalRows, vStart + Math.ceil(containerH / ROW_H) + OVERSCAN * 2);
  const visible = filtered.slice(vStart, vEnd);
  const padTop = vStart * ROW_H;
  const padBottom = (totalRows - vEnd) * ROW_H;

  const total = allFollowers.length;
  const mappedCount = points.length;

  return (
    <aside
      aria-label="Followers list"
      aria-hidden={!open}
      className={[
        "absolute z-20 flex flex-col bg-surface border-border",
        // Desktop: right panel sliding in from right
        "md:right-0 md:top-0 md:bottom-0 md:w-80 md:border-l md:rounded-none",
        "md:transition-transform md:duration-300",
        open ? "md:translate-x-0" : "md:translate-x-full",
        // Mobile: bottom sheet sliding up
        "left-0 right-0 bottom-0 max-h-[80dvh] rounded-t-2xl border-t",
        "transition-transform duration-300",
        open ? "translate-y-0" : "translate-y-full",
        // hide completely when not open (screen readers + pointer events)
        !open && "pointer-events-none",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-foreground font-semibold text-sm">Followers</h2>
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
          aria-label="Close followers panel"
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
            placeholder="Search followers…"
            aria-label="Search followers"
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

        {visible.map((f) => {
          const pt = f.mapped ? points.find((p) => p.login === f.login) : undefined;
          return (
            <div
              key={f.login}
              className="group flex items-center gap-2.5 px-4 border-b border-surface-alt hover:bg-background transition-colors"
              style={{ height: ROW_H }}
            >
              {/* Avatar */}
              {f.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={f.avatarUrl}
                  alt=""
                  className="size-7 rounded-full flex-shrink-0 bg-surface-alt"
                  loading="lazy"
                />
              ) : (
                <div
                  className={`size-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold ${avatarColorFor(f.login)}`}
                  aria-hidden="true"
                >
                  {f.login[0]?.toUpperCase() ?? "?"}
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <a
                  href={`https://github.com/${f.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue text-xs font-medium hover:underline leading-tight block truncate"
                >
                  @{f.login}
                </a>
                {f.name && f.name !== f.login && (
                  <div className="text-muted text-xs truncate leading-tight">{f.name}</div>
                )}
              </div>

              {/* Followers badge (only >= 100) */}
              {f.followers >= 100 && (
                <span className="text-muted-subtle text-xs tabular-nums flex-shrink-0">
                  {formatFollowers(f.followers)}
                </span>
              )}

              {/* Map pin button (mapped) or dot (unmapped) */}
              {f.mapped && pt ? (
                <button
                  onClick={() => {
                    setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login });
                    onClose();
                  }}
                  aria-label={`Fly to ${f.login} on map`}
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
                ? "No mapped followers yet"
                : filterState === "unmapped"
                  ? "All followers are mapped"
                  : "No followers yet"}
          </div>
        )}
      </div>
    </aside>
  );
};
