// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useMemo, useRef, useState, useDeferredValue, startTransition } from "react";
import NextImage from "next/image";
import { Modal } from "@/components/modal";
import { FilterCombobox } from "@/components/filter-combobox";
import { isCountry, normalizeCountry } from "@/lib/countries";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { UserDetail } from "@/app/api/user-details/route";

export type AnyStargazer = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  followers: number;
  location: string | null;
  avatarUrl: string | null;
  mapped: boolean;
  starredAt: string | null;
  email?: string | null;
  blog?: string | null;
  twitter_username?: string | null;
};

type SortKey = "followers" | "login" | "location" | "starredAt" | "company";

type AllStargazersModalProps = {
  open: boolean;
  onClose: () => void;
  allStargazers: AnyStargazer[];
  points: StargazerPoint[];
  filterCountry: string;
  setFilterCountry: React.Dispatch<React.SetStateAction<string>>;
  filterCity: string;
  setFilterCity: React.Dispatch<React.SetStateAction<string>>;
  filterCompany: string;
  setFilterCompany: React.Dispatch<React.SetStateAction<string>>;
  filterFollowers: number;
  setFilterFollowers: React.Dispatch<React.SetStateAction<number>>;
  filterDate: "all" | "30d" | "90d" | "1y";
  setFilterDate: React.Dispatch<React.SetStateAction<"all" | "30d" | "90d" | "1y">>;
  setFlyTarget: React.Dispatch<React.SetStateAction<{ lat: number; lng: number; login: string } | null>>;
  ghHeaders: () => Record<string, string>;
  owner: string;
  repo: string;
};

export const AllStargazersModal = ({
  open, onClose, allStargazers, points,
  filterCountry, setFilterCountry, filterCity, setFilterCity,
  filterCompany, setFilterCompany, filterFollowers, setFilterFollowers,
  filterDate, setFilterDate, setFlyTarget, ghHeaders, owner, repo,
}: AllStargazersModalProps) => {
  const csvEnabled = process.env.NEXT_PUBLIC_CSV_EXPORT === "true";
  const [allSearch, setAllSearch] = useState("");
  const deferredSearch = useDeferredValue(allSearch);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableVisibleCount, setTableVisibleCount] = useState(14);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [allSort, setAllSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "followers", dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [filterMapped, setFilterMapped] = useState<"all" | "mapped" | "unmapped">("all");
  const [now] = useState(Date.now);

  const deferredAllStargazers = useDeferredValue(allStargazers);

  const filteredStargazers = useMemo(() => {
    const q = deferredSearch.toLowerCase();
    let list = deferredAllStargazers;
    if (q) list = list.filter((u) =>
      u.login.toLowerCase().includes(q) ||
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.location?.toLowerCase().includes(q) ?? false) ||
      (u.company?.toLowerCase().includes(q) ?? false) ||
      (u.bio?.toLowerCase().includes(q) ?? false)
    );
    if (filterFollowers > 0) list = list.filter((u) => u.followers >= filterFollowers);
    if (filterMapped === "mapped") list = list.filter((u) => u.mapped);
    if (filterMapped === "unmapped") list = list.filter((u) => !u.mapped);
    if (filterDate !== "all") {
      const days = filterDate === "30d" ? 30 : filterDate === "90d" ? 90 : 365;
      const cutoff = now - days * 86400000;
      list = list.filter((u) => u.starredAt && new Date(u.starredAt).getTime() >= cutoff);
    }
    if (filterCompany) list = list.filter((u) => u.company?.toLowerCase().includes(filterCompany.toLowerCase()));
    if (filterCountry) list = list.filter((u) => u.location?.toLowerCase().includes(filterCountry.toLowerCase()));
    if (filterCity) list = list.filter((u) => u.location?.toLowerCase().includes(filterCity.toLowerCase()));
    return [...list].sort((a, b) => {
      if (allSort.key === "followers") return (b.followers - a.followers) * allSort.dir;
      if (allSort.key === "login") return a.login.localeCompare(b.login) * allSort.dir;
      if (allSort.key === "starredAt") {
        const at = a.starredAt ? new Date(a.starredAt).getTime() : 0;
        const bt = b.starredAt ? new Date(b.starredAt).getTime() : 0;
        return (bt - at) * allSort.dir;
      }
      if (allSort.key === "company") return (a.company ?? "").localeCompare(b.company ?? "") * allSort.dir;
      const la = a.location ?? "";
      const lb = b.location ?? "";
      return la.localeCompare(lb) * allSort.dir;
    });
  }, [deferredAllStargazers, deferredSearch, allSort, filterFollowers, filterMapped, filterDate, filterCompany, filterCountry, filterCity, now]);

  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of allStargazers) {
      const raw = u.location?.split(",").pop()?.trim();
      if (raw && isCountry(raw)) {
        const c = normalizeCountry(raw);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([c]) => c);
  }, [allStargazers]);

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of allStargazers) {
      const parts = u.location?.split(",");
      if (parts && parts.length >= 2) {
        const c = parts[0]?.trim();
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([c]) => c);
  }, [allStargazers]);

  // Reset scroll when filtered list changes (sort/filter/search)
  useEffect(() => {
    setTableScrollTop(0);
    if (tableContainerRef.current) tableContainerRef.current.scrollTop = 0;
  }, [filteredStargazers]);

  const TABLE_ROW_H = 40;
  const TABLE_OVERSCAN = 5;

  // Dynamic visible row count based on container height
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTableVisibleCount(Math.max(5, Math.ceil(el.clientHeight / TABLE_ROW_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [TABLE_ROW_H]);

  const tableVStart = Math.max(0, Math.floor(tableScrollTop / TABLE_ROW_H) - TABLE_OVERSCAN);
  const tableVEnd = Math.min(filteredStargazers.length, tableVStart + tableVisibleCount + TABLE_OVERSCAN * 2);
  const tableSlice = filteredStargazers.slice(tableVStart, tableVEnd);
  const tablePadTop = tableVStart * TABLE_ROW_H;
  const tablePadBottom = (filteredStargazers.length - tableVEnd) * TABLE_ROW_H;
  const isSearchPending = allSearch !== deferredSearch;

  const toggleSort = (key: SortKey) =>
    setAllSort((prev) => ({ key, dir: prev.key === key ? (-prev.dir as 1 | -1) : (key === "followers" || key === "starredAt") ? -1 : 1 }));

  const toggleRow = (login: string) =>
    setSelected((prev) => { const s = new Set(prev); if (s.has(login)) { s.delete(login); } else { s.add(login); } return s; });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === filteredStargazers.length
        ? new Set()
        : new Set(filteredStargazers.map((u) => u.login))
    );

  const exportCsv = (rows: Record<string, unknown>[]) => {
    const cols = ["login", "name", "followers", "location", "starredAt", "mapped", "email", "company", "bio", "blog", "twitter_username", "following", "public_repos"] as const;
    const header = cols.join(",");
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map((r) => cols.map((c) => escape(r[c as keyof typeof r])).join(",")).join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `stargazers-${owner}-${repo}.csv`; a.click();
  };

  const fetchAndExport = async () => {
    setFetching(true);
    try {
      const logins = [...selected];
      const base = allStargazers.filter((u) => logins.includes(u.login));
      if (logins.length === 0) { exportCsv(base); return; }
      const res = await fetch("/api/user-details", {
        method: "POST", headers: ghHeaders(),
        body: JSON.stringify({ logins }),
      });
      const data = await res.json();
      const detailMap = new Map((data.users as UserDetail[]).map((u) => [u.login, u]));
      const merged = base.map((u) => ({ ...u, ...detailMap.get(u.login) }));
      exportCsv(merged);
    } finally {
      setFetching(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-5xl" innerClassName="flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle flex-shrink-0">
            <h2 className="text-foreground font-semibold text-sm">
              All Stargazers
              <span className="text-muted font-normal ml-2">
                {filteredStargazers.length !== allStargazers.length
                  ? `${filteredStargazers.length} / ${allStargazers.length.toLocaleString()}`
                  : allStargazers.length.toLocaleString()}
              </span>
            </h2>
            <button onClick={onClose} aria-label="Close all stargazers" className="text-muted hover:text-foreground text-lg leading-none"><span aria-hidden="true">✕</span></button>
          </div>

          {/* Search */}
          <div className="px-5 py-3 border-b border-border-subtle flex-shrink-0">
            <input
              autoFocus
              value={allSearch}
              onChange={(e) => setAllSearch(e.target.value)}
              placeholder="Search by username, name or location…"
              aria-label="Search stargazers"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* Filters */}
          <div className="px-5 py-2.5 border-b border-border-subtle flex-shrink-0 flex flex-wrap items-center gap-3">
            {/* Followers filter */}
            <div className="flex items-center gap-2 min-w-0">
              <span id="filter-followers-label" className="text-2xs text-muted whitespace-nowrap">Min followers</span>
              <div role="radiogroup" aria-labelledby="filter-followers-label" className="flex gap-1">
                {[0, 10, 100, 500, 1000].map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filterFollowers === v}
                    onClick={() => setFilterFollowers(v)}
                    className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                      filterFollowers === v
                        ? "bg-accent-blue text-white"
                        : "bg-surface-alt text-muted hover:text-foreground"
                    }`}
                  >
                    {v === 0 ? "All" : v >= 1000 ? `${v / 1000}k+` : `${v}+`}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-3 w-px bg-border hidden sm:block" />

            {/* Mapped filter */}
            <div className="flex items-center gap-2">
              <span id="filter-location-label" className="text-2xs text-muted whitespace-nowrap">Location</span>
              <div role="radiogroup" aria-labelledby="filter-location-label" className="flex gap-1">
                {(["all", "mapped", "unmapped"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filterMapped === v}
                    onClick={() => setFilterMapped(v)}
                    className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                      filterMapped === v
                        ? "bg-accent-blue text-white"
                        : "bg-surface-alt text-muted hover:text-foreground"
                    }`}
                  >
                    {v === "all" ? "All" : v === "mapped" ? <><span aria-hidden="true">📍</span> On map</> : "No location"}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-3 w-px bg-border hidden sm:block" />

            {/* Date filter */}
            <div className="flex items-center gap-2">
              <span id="filter-starred-label" className="text-2xs text-muted whitespace-nowrap">Starred</span>
              <div role="radiogroup" aria-labelledby="filter-starred-label" className="flex gap-1">
                {(["all", "30d", "90d", "1y"] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={filterDate === v}
                    onClick={() => setFilterDate(v)}
                    className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                      filterDate === v ? "bg-accent-blue text-white" : "bg-surface-alt text-muted hover:text-foreground"
                    }`}
                  >
                    {v === "all" ? "All time" : v === "30d" ? "30d" : v === "90d" ? "90d" : "1y"}
                  </button>
                ))}
              </div>
            </div>

            {/* Company filter */}
            <input
              value={filterCompany}
              onChange={(e) => startTransition(() => setFilterCompany(e.target.value))}
              placeholder="Company…"
              aria-label="Filter by company"
              className="bg-background border border-border rounded px-2 py-0.5 text-2xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue w-24"
            />

            {/* Country filter */}
            <FilterCombobox
              value={filterCountry}
              onChange={(v) => startTransition(() => setFilterCountry(v))}
              options={countryOptions}
              placeholder="Country…"
            />

            {/* City filter */}
            <FilterCombobox
              value={filterCity}
              onChange={(v) => startTransition(() => setFilterCity(v))}
              options={cityOptions}
              placeholder="City…"
            />

            {/* Active filters count + reset */}
            {(filterFollowers > 0 || filterMapped !== "all" || filterDate !== "all" || filterCompany || filterCountry || filterCity) && (
              <button
                onClick={() => { setFilterFollowers(0); setFilterMapped("all"); setFilterDate("all"); setFilterCompany(""); setFilterCountry(""); setFilterCity(""); }}
                className="ml-auto text-2xs text-muted-subtle hover:text-muted transition-colors"
              >
                ✕ Reset filters
              </button>
            )}
          </div>

          {/* Table */}
          <div
            ref={tableContainerRef}
            className="overflow-y-auto flex-1 relative"
            onScroll={(e) => setTableScrollTop((e.currentTarget).scrollTop)}
          >
            {isSearchPending && (
              <div className="sticky top-0 left-0 right-0 z-20 flex items-center justify-center py-1 bg-surface/80 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-2xs text-muted-subtle">
                  <svg className="animate-spin motion-reduce:animate-none w-3 h-3" aria-hidden="true" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Filtering…
                </div>
              </div>
            )}
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border-subtle">
                  {csvEnabled && (
                    <th className="px-3 py-2.5 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all stargazers"
                        checked={selected.size > 0 && selected.size === filteredStargazers.length}
                        ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < filteredStargazers.length; }}
                        onChange={toggleAll}
                        className="accent-accent-blue cursor-pointer"
                      />
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2.5 text-left text-muted font-medium w-6 text-right">#</th>
                  <th scope="col" aria-sort={allSort.key === "login" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium">
                    <button onClick={() => toggleSort("login")} className="flex items-center gap-1 hover:text-foreground">
                      User <span aria-hidden="true">{allSort.key === "login" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                    </button>
                  </th>
                  <th scope="col" aria-sort={allSort.key === "followers" ? (allSort.dir === -1 ? "descending" : "ascending") : "none"} className="px-3 py-2.5 text-right text-muted font-medium">
                    <button onClick={() => toggleSort("followers")} className="flex items-center gap-1 hover:text-foreground ml-auto">
                      <span aria-hidden="true">{allSort.key === "followers" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span> Followers
                    </button>
                  </th>
                  <th scope="col" aria-sort={allSort.key === "location" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden sm:table-cell">
                    <button onClick={() => toggleSort("location")} className="flex items-center gap-1 hover:text-foreground">
                      Location <span aria-hidden="true">{allSort.key === "location" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                    </button>
                  </th>
                  <th scope="col" aria-sort={allSort.key === "starredAt" ? (allSort.dir === -1 ? "descending" : "ascending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden md:table-cell">
                    <button onClick={() => toggleSort("starredAt")} className="flex items-center gap-1 hover:text-foreground">
                      Starred <span aria-hidden="true">{allSort.key === "starredAt" ? (allSort.dir === -1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                    </button>
                  </th>
                  <th scope="col" aria-sort={allSort.key === "company" ? (allSort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 text-left text-muted font-medium hidden lg:table-cell">
                    <button onClick={() => toggleSort("company")} className="flex items-center gap-1 hover:text-foreground">
                      Company <span aria-hidden="true">{allSort.key === "company" ? (allSort.dir === 1 ? "↑" : "↓") : <span className="opacity-30">↕</span>}</span>
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-left text-muted font-medium hidden xl:table-cell">Links</th>
                  <th scope="col" className="px-3 py-2.5 w-8"></th>
                  <th scope="col" className="px-4 py-2.5 text-center text-muted font-medium">Map</th>
                </tr>
              </thead>
              <tbody>
                {tablePadTop > 0 && <tr style={{ height: tablePadTop }}><td colSpan={10} style={{ padding: 0 }} /></tr>}
                {tableSlice.map((u, _i) => {
                  const i = tableVStart + _i;
                  return (
                  <tr
                    key={u.login}
                    onClick={csvEnabled ? () => toggleRow(u.login) : undefined}
                    className={`border-b border-surface transition-colors ${
                      csvEnabled
                        ? selected.has(u.login) ? "bg-surface-alt cursor-pointer" : "hover:bg-background cursor-pointer"
                        : ""
                    }`}
                  >
                    {csvEnabled && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${u.login}`}
                          checked={selected.has(u.login)}
                          onChange={() => toggleRow(u.login)}
                          className="accent-accent-blue cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-muted-subtle text-right">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {u.avatarUrl
                          ? <NextImage src={u.avatarUrl} alt="" width={24} height={24} sizes="24px" className="w-6 h-6 rounded-full flex-shrink-0" />
                          : <div className="w-6 h-6 rounded-full bg-surface-alt flex-shrink-0" />
                        }
                        <div className="min-w-0">
                          <a
                            href={`/profile/${u.login}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-accent-blue font-medium hover:underline"
                          >
                            @{u.login}
                          </a>
                          {u.name && u.name !== u.login && (
                            <div className="text-muted text-2xs truncate max-w-36">{u.name}</div>
                          )}
                          {u.bio && (
                            <div className="text-muted-subtle text-2xs truncate max-w-36" title={u.bio}>{u.bio}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-muted tabular-nums">
                      {u.followers > 0 ? u.followers.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted max-w-40 hidden sm:table-cell">
                      <span className="truncate block">{u.location ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-subtle hidden md:table-cell tabular-nums">
                      {u.starredAt ? new Date(u.starredAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-subtle hidden lg:table-cell">
                      <span className="truncate block max-w-28">{u.company ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {u.email && (
                          <a href={`mailto:${u.email}`} title={u.email} aria-label={`Email ${u.email}`} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25v-8.5A1.75 1.75 0 0 0 14.25 2Zm0 1.5h12.5a.25.25 0 0 1 .25.25v.852l-6.36 3.682a.25.25 0 0 1-.254 0L1.5 4.602V3.75a.25.25 0 0 1 .25-.25Zm-.25 2.68 5.86 3.393a1.75 1.75 0 0 0 1.78 0L15 6.18v6.07a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25Z"/></svg>
                          </a>
                        )}
                        {u.blog && (
                          <a href={u.blog.startsWith("http") ? u.blog : `https://${u.blog}`} title={u.blog} aria-label={`Blog: ${u.blog}`} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/></svg>
                          </a>
                        )}
                        {u.twitter_username && (
                          <a href={`https://x.com/${u.twitter_username}`} title={`@${u.twitter_username}`} aria-label={`Twitter: @${u.twitter_username}`} className="text-muted hover:text-accent-blue transition-colors" target="_blank" rel="noopener noreferrer">
                            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor"><path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z"/></svg>
                          </a>
                        )}
                        {!u.email && !u.blog && !u.twitter_username && (
                          <span className="text-border text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        role="img"
                        aria-label={u.mapped ? "Mapped" : "Not mapped"}
                        className={`inline-block w-1.5 h-1.5 rounded-full ${u.mapped ? "bg-accent-green" : "bg-border"}`}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      {u.mapped && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const pt = points.find((p) => p.login === u.login);
                            if (pt) { setFlyTarget({ lat: pt.lat, lng: pt.lng, login: pt.login }); onClose(); }
                          }}
                          aria-label={`Fly to ${u.login} on map`}
                          className="text-muted-subtle hover:text-accent-blue transition-colors text-xs"
                        >
                          <span aria-hidden="true">🗺</span>
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {tablePadBottom > 0 && <tr style={{ height: tablePadBottom }}><td colSpan={10} style={{ padding: 0 }} /></tr>}
              </tbody>
            </table>
            {filteredStargazers.length === 0 && !isSearchPending && (
              <div className="text-center text-muted-subtle text-xs py-12">No results for &ldquo;{allSearch}&rdquo;</div>
            )}
          </div>

          {/* Selection action bar — only when CSV export is enabled */}
          {csvEnabled && selected.size > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle bg-background rounded-b-2xl flex-shrink-0">
              <span className="text-xs text-muted">
                <strong className="text-foreground">{selected.size}</strong> selected
                <button onClick={() => setSelected(new Set())} className="ml-3 text-muted-subtle hover:text-muted">✕ Clear</button>
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText([...selected].join("\n"))}
                  className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                  Copy logins
                </button>
                <button
                  onClick={() => exportCsv(allStargazers.filter((u) => selected.has(u.login)))}
                  className="bg-surface-alt border border-border rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                  ↓ Export CSV
                </button>
                <button
                  onClick={fetchAndExport}
                  disabled={fetching}
                  className="bg-accent-green-emphasis hover:opacity-90 disabled:opacity-50 rounded-lg px-3 py-1.5 text-xs text-white font-medium transition-opacity"
                >
                  {fetching ? "Fetching…" : `↓ Fetch details + CSV (${selected.size})`}
                </button>
              </div>
            </div>
          )}
    </Modal>
  );
};
