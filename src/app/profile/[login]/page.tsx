// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { LANGUAGE_COLORS } from "@/lib/language-colors";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { useTheme } from "@/hooks/useTheme";
import type { ProfileResponse, ProfileRepo } from "@/app/api/profile/[login]/route";
import type { NearbyResponse } from "@/app/api/explore/nearby/route";
import { Tabs } from "@/components/ui/tabs";
import type { StargazerPoint } from "@/app/api/chunk/route";
import type { UserRepo, UserReposResponse } from "@/app/api/explore/user-repos/route";
import type { UserRepo as GhRepo } from "@/app/api/user-repos/route";
import { Modal } from "@/components/modal";
import { NewsTimeline } from "@/components/news-timeline";
import { TourTrigger } from "@/components/tour/tour-trigger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const obfuscateEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

const formatCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
    ? `${(n / 1000).toFixed(1)}k`
    : String(n);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const RepoCard = ({ repo }: { repo: ProfileRepo }) => {
  const mappedPct = Math.round((repo.mappedCount / Math.max(repo.totalCount, 1)) * 100);
  return (
    <Link
      href={`/${repo.owner}/${repo.repo}`}
      className="flex flex-col gap-1.5 p-3 rounded-lg border border-border bg-surface
                 hover:border-accent-blue/50 hover:bg-surface-alt transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-foreground text-sm font-medium group-hover:text-accent-blue
                         transition-colors truncate leading-snug">
          {repo.owner}/{repo.repo}
        </span>
        {repo.language && (
          <span
            className="shrink-0 text-2xs font-medium px-1.5 py-0.5 rounded-full border"
            style={{
              color: LANGUAGE_COLORS[repo.language] ?? "#8b949e",
              borderColor: `${LANGUAGE_COLORS[repo.language] ?? "#8b949e"}40`,
              backgroundColor: `${LANGUAGE_COLORS[repo.language] ?? "#8b949e"}14`,
            }}
          >
            {repo.language}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>
          </svg>
          {formatCount(repo.totalCount)}
        </span>
        {/* mapped % as visual progress bar */}
        <span className="flex items-center gap-1.5">
          <span className="relative w-14 h-1.5 rounded-full bg-surface-alt overflow-hidden"
                role="presentation" aria-hidden="true">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent-green"
              style={{ width: `${mappedPct}%` }}
            />
          </span>
          <span className="tabular-nums text-muted-subtle">{mappedPct}%</span>
        </span>
        {repo.starredAt && (
          <span className="ml-auto text-muted-subtle">starred {timeAgo(repo.starredAt)}</span>
        )}
      </div>
    </Link>
  );
};

const SectionHeader = ({
  title, count, id, noBorder = false, sticky = false,
}: {
  title: string; count?: number; id?: string; noBorder?: boolean; sticky?: boolean;
}) => (
  <div className={[
    "flex items-center gap-2 mb-3",
    noBorder ? "" : "pt-6 border-t border-border-subtle",
    sticky ? "sticky top-14 z-10 bg-background/90 backdrop-blur -mx-4 sm:-mx-5 px-4 sm:px-5 pb-2" : "",
  ].join(" ")}>
    <h2 id={id} className="text-foreground text-sm font-semibold">{title}</h2>
    {count !== undefined && (
      <span className="text-muted-subtle text-xs bg-surface border border-border px-1.5 py-0.5 rounded-full tabular-nums">
        {count.toLocaleString()}
      </span>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Props = {
  params: Promise<{ login: string }>;
};

export default function ProfilePage({ params }: Props) {
  const [login, setLogin] = useState("");
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "fetching-live" | "not-found" | "error" | "loaded">("loading");
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  const [showAllOwned, setShowAllOwned] = useState(false);
  const [showAllStarred, setShowAllStarred] = useState(false);
  const [refreshState, setRefreshState] = useState<"idle" | "loading" | "cooldown">("idle");
  const [refreshCooldownMin, setRefreshCooldownMin] = useState(0);
  const [pinnedLogins, setPinnedLogins] = useState<Set<string>>(new Set());
  const [mapFlyTarget, setMapFlyTarget] = useState<{ lat: number; lng: number; login: string; zoom?: number } | null>(null);
  const [githubRepos, setGithubRepos] = useState<UserRepo[] | null>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanRepos, setScanRepos] = useState<GhRepo[] | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanSearch, setScanSearch] = useState("");
  const [scanSort, setScanSort] = useState<"stars" | "name">("stars");

  // Token modal
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getStoredToken());

  // Contact dropdown
  const [contactOpen, setContactOpen] = useState(false);
  const [contactDetails, setContactDetails] = useState<{ email: string | null; twitter: string | null; blog: string | null } | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [starredLang, setStarredLang] = useState<string | null>(null);
  const [starredSort, setStarredSort] = useState<"date" | "stars" | "mapped">("date");
  const [profileTab, setProfileTab] = useState<"github" | "owned" | "starred">("github");

  const { theme } = useTheme();
  const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
  const mapStyleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  const handleScanOpen = useCallback(async () => {
    setScanModalOpen(true);
    if (scanRepos !== null) return;
    setScanLoading(true);
    try {
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) headers["x-gh-token"] = token;
      const res = await fetch(`/api/user-repos?username=${encodeURIComponent(login)}`, { headers });
      if (res.ok) {
        const data = await res.json() as { repos: GhRepo[] };
        setScanRepos(data.repos);
      } else {
        setScanRepos([]);
      }
    } catch {
      setScanRepos([]);
    } finally {
      setScanLoading(false);
    }
  }, [login, scanRepos]);

  const handleRefresh = useCallback(async () => {
    if (refreshState === "loading" || refreshState === "cooldown") return;
    setRefreshState("loading");

    try {
      const token = getStoredToken();
      const headers: Record<string, string> = {};
      if (token) headers["x-gh-token"] = token;

      const res = await fetch(`/api/profile/${encodeURIComponent(login)}/refresh`, {
        method: "POST",
        headers,
      });

      if (res.status === 429) {
        const data = await res.json() as { retryAfterSec?: number };
        const minutes = Math.ceil((data.retryAfterSec ?? 3600) / 60);
        setRefreshCooldownMin(minutes);
        setRefreshState("cooldown");
        return;
      }

      if (!res.ok) { setRefreshState("idle"); return; }

      // Re-fetch profile to reflect updated data
      const profileRes = await fetch(`/api/profile/${encodeURIComponent(login)}`);
      if (profileRes.ok) {
        const data = await profileRes.json() as ProfileResponse;
        setProfile(data);
      }
      setRefreshState("idle");
    } catch {
      setRefreshState("idle");
    }
  }, [login, refreshState]);

  const handleContactOpen = useCallback(async () => {
    setContactOpen((prev) => !prev);
    if (contactDetails !== null || contactLoading) return;
    setContactLoading(true);
    try {
      const token = getStoredToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["x-gh-token"] = token;
      const res = await fetch("/api/user-details", {
        method: "POST",
        headers,
        body: JSON.stringify({ logins: [login] }),
      });
      if (res.ok) {
        const { users } = await res.json() as { users: Array<{ email: string | null; twitter_username: string | null; blog: string | null }> };
        const u = users[0];
        setContactDetails(u
          ? { email: u.email, twitter: u.twitter_username, blog: u.blog }
          : { email: null, twitter: null, blog: null });
      } else {
        setContactDetails({ email: null, twitter: null, blog: null });
      }
    } catch {
      setContactDetails({ email: null, twitter: null, blog: null });
    } finally {
      setContactLoading(false);
    }
  }, [login, contactDetails, contactLoading]);

  // Resolve async params
  useEffect(() => {
    params.then(({ login: l }) => setLogin(l));
  }, [params]);

  // Fetch profile
  useEffect(() => {
    if (!login) return;
    setLoadState("loading");
    setProfile(null);
    setNearby(null);

    const ctrl = new AbortController();
    fetch(`/api/profile/${encodeURIComponent(login)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) {
            // Not in StarMapper yet — try to fetch live from GitHub
            setLoadState("fetching-live");
            const token = getStoredToken();
            const headers: Record<string, string> = {};
            if (token) headers["x-gh-token"] = token;
            const refreshRes = await fetch(
              `/api/profile/${encodeURIComponent(login)}/refresh`,
              { method: "POST", headers, signal: ctrl.signal },
            );
            if (!refreshRes.ok) { setLoadState("not-found"); return; }
            const profileRes = await fetch(
              `/api/profile/${encodeURIComponent(login)}`,
              { signal: ctrl.signal },
            );
            if (!profileRes.ok) { setLoadState("not-found"); return; }
            const data = await profileRes.json() as ProfileResponse;
            setProfile(data);
            setLoadState("loaded");
          } else {
            setLoadState("error");
          }
          return;
        }
        const data = await res.json() as ProfileResponse;
        setProfile(data);
        setLoadState("loaded");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setLoadState("error");
      });

    return () => ctrl.abort();
  }, [login]);

  // Track profile view — fire-and-forget, no await
  useEffect(() => {
    if (!login) return;
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "profile", slug: login.toLowerCase() }),
    }).catch(() => {});
  }, [login]);

  // Fetch nearby — non-blocking, only if profile has coords
  useEffect(() => {
    if (!profile?.lat || !profile?.lng) return;

    const ctrl = new AbortController();
    fetch(
      `/api/explore/nearby?lat=${profile.lat}&lng=${profile.lng}&radius=50`,
      { signal: ctrl.signal },
    )
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as NearbyResponse;
        // Exclude the profile user themselves from the nearby list
        const filtered = { ...data, users: data.users.filter((u) => u.login.toLowerCase() !== login.toLowerCase()) };
        if (filtered.users.length > 0) setNearby(filtered);
      })
      .catch(() => {});

    return () => ctrl.abort();
  }, [profile, login]);

  // Fetch GitHub repos — non-blocking
  useEffect(() => {
    if (!login) return;
    const ctrl = new AbortController();
    fetch(`/api/explore/user-repos?login=${encodeURIComponent(login)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as UserReposResponse;
        if (data.repos.length > 0) setGithubRepos(data.repos);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [login]);

  // Build a single synthetic StargazerPoint for the profile user
  const miniMapPoints: StargazerPoint[] =
    profile?.lat && profile?.lng
      ? [{
          login: profile.login,
          name: profile.name,
          bio: profile.cityNormalized ?? profile.location ?? null,
          company: profile.company,
          location: profile.location,
          followers: profile.followers,
          avatarUrl: `https://github.com/${profile.login}.png`,
          lat: profile.lat,
          lng: profile.lng,
          starredAt: null,
          linkedinUrl: null,
        }]
      : [];

  // Pinned nearby users added as extra map points
  const pinnedPoints: StargazerPoint[] = nearby?.users
    .filter((u) => pinnedLogins.has(u.login))
    .map((u) => ({
      login: u.login,
      name: u.name,
      bio: u.cityNormalized ?? null,
      company: u.company,
      location: u.cityNormalized ?? null,
      followers: u.followers,
      avatarUrl: `https://github.com/${u.login}.png`,
      lat: u.lat,
      lng: u.lng,
      starredAt: null,
      linkedinUrl: null,
    })) ?? [];

  const allMapPoints = [...miniMapPoints, ...pinnedPoints];

  const togglePin = (u: NearbyResponse["users"][number]) => {
    setPinnedLogins((prev) => {
      const next = new Set(prev);
      if (next.has(u.login)) {
        next.delete(u.login);
      } else {
        next.add(u.login);
        setMapFlyTarget({ lat: u.lat, lng: u.lng, login: u.login, zoom: 7 });
      }
      return next;
    });
  };

  const starredLangs = useMemo(() => {
    const langs = new Set<string>();
    for (const r of profile?.starredRepos ?? []) if (r.language) langs.add(r.language);
    return [...langs].sort();
  }, [profile?.starredRepos]);

  const starredFiltered = useMemo(() => {
    let repos = profile?.starredRepos ?? [];
    if (starredLang) repos = repos.filter((r) => r.language === starredLang);
    return [...repos].sort((a, b) => {
      if (starredSort === "stars") return b.totalCount - a.totalCount;
      if (starredSort === "mapped")
        return (b.mappedCount / Math.max(b.totalCount, 1)) - (a.mappedCount / Math.max(a.totalCount, 1));
      return new Date(b.starredAt ?? 0).getTime() - new Date(a.starredAt ?? 0).getTime();
    });
  }, [profile?.starredRepos, starredLang, starredSort]);

  const scanFiltered = useMemo(() => {
    if (!scanRepos) return [];
    const q = scanSearch.toLowerCase().trim();
    const filtered = q
      ? scanRepos.filter(
          (r) => r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
        )
      : [...scanRepos];
    if (scanSort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
    else filtered.sort((a, b) => b.stars - a.stars);
    return filtered;
  }, [scanRepos, scanSearch, scanSort]);

  const ownedVisible = showAllOwned ? profile?.ownedRepos : profile?.ownedRepos?.slice(0, 12);
  const starredVisible = showAllStarred ? starredFiltered : starredFiltered.slice(0, 12);
  const hasMap = !!(profile?.lat && profile?.lng);

  // ── Fetching live from GitHub ──────────────────────────────────────────────
  if (loadState === "fetching-live") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background text-foreground px-4">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"
          className="text-muted animate-spin" aria-hidden="true">
          <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
        </svg>
        <p className="text-muted text-sm">Fetching <span className="text-foreground font-medium">{login}</span> from GitHub…</p>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (loadState === "not-found") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-background text-foreground px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="size-12 rounded-full bg-surface flex items-center justify-center border border-border">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-muted-subtle" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
          <p className="text-foreground font-semibold">User not found on GitHub</p>
          <p className="text-muted text-sm max-w-xs">
            <code className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-xs">
              {login}
            </code>{" "}
            doesn&apos;t exist on GitHub or couldn&apos;t be fetched.
          </p>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-accent-blue text-sm hover:underline">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L4.81 7.25h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06z"/>
          </svg>
          Explore a repo instead
        </Link>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (loadState === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background text-foreground px-4">
        <p className="text-foreground font-semibold">Something went wrong</p>
        <Link href="/" className="text-accent-blue text-sm hover:underline">Back to homepage</Link>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
        afterLogo={
          <>
            <span className="text-border-subtle shrink-0 select-none" aria-hidden="true">/</span>
            {loadState === "loading" ? (
              <span className="h-5 w-24 bg-surface-alt rounded animate-pulse motion-reduce:animate-none" />
            ) : (
              <span className="text-muted text-sm truncate max-w-48">{login}</span>
            )}
          </>
        }
      />

      {/* ── Map — full width at top (or placeholder while loading) ──────── */}
      {(hasMap || loadState === "loading") && (
        <div data-tour="profile-map" className="h-64 sm:h-80 shrink-0 border-b border-border-subtle relative">
          {hasMap ? (
            <StargazerMapDynamic
              points={allMapPoints}
              flyTarget={mapFlyTarget}
              onFlyDone={() => setMapFlyTarget(null)}
              showProjectionToggle
              styleUrl={mapStyleUrl}
              initialCenter={
                profile?.lng != null && profile?.lat != null
                  ? [profile.lng, profile.lat]
                  : undefined
              }
            />
          ) : (
            <div className="w-full h-full bg-surface-alt animate-pulse motion-reduce:animate-none" />
          )}
        </div>
      )}

      {/* ── Content: stacked on mobile, two columns on lg ───────────────── */}
      <div className={(hasMap || loadState === "loading") ? "flex flex-col lg:flex-row flex-1 lg:overflow-hidden" : "flex flex-1"}>

        {/* Main: profile card + repos */}
        <div
          id="main"
          className={
            (hasMap || loadState === "loading")
              ? "w-full lg:flex-[2] lg:overflow-y-auto lg:border-r border-border-subtle px-4 sm:px-5 py-6 pb-12"
              : "w-full max-w-3xl mx-auto px-4 py-8 pb-16"
          }
        >

        {/* ── Profile card ─────────────────────────────────────────────── */}
        {loadState === "loading" ? (
          <div className="flex items-center gap-5 mb-8 animate-pulse motion-reduce:animate-none">
            <div className="size-20 rounded-full bg-surface-alt shrink-0" />
            <div className="flex flex-col gap-2 flex-1 pt-1">
              <div className="h-5 w-44 bg-surface-alt rounded" />
              <div className="h-3.5 w-60 bg-surface-alt rounded" />
              <div className="flex gap-2 mt-1">
                <div className="h-6 w-24 bg-surface-alt rounded-full" />
                <div className="h-6 w-16 bg-surface-alt rounded-full" />
              </div>
            </div>
          </div>
        ) : profile && (
          <div data-tour="profile-card" className="flex items-start gap-5 mb-8">
            <img
              src={`https://github.com/${profile.login}.png`}
              alt={`${profile.login} avatar`}
              className="size-20 rounded-full border border-border shrink-0"
              width={80}
              height={80}
            />
            <div className="flex flex-col gap-1.5 min-w-0 pt-0.5 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                    <h1 className="text-foreground font-semibold text-xl leading-tight">
                      {profile.name ?? profile.login}
                    </h1>
                    {profile.name && (
                      <span className="text-muted text-sm">{profile.login}</span>
                    )}
                    {profile.partial && (
                      <span className="text-2xs font-medium px-1.5 py-0.5 rounded-full border border-border text-muted-subtle">
                        Repo owner · limited data
                      </span>
                    )}
                  </div>
                </div>
                {/* Actions — top right of profile card */}
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`https://github.com/${profile.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View on GitHub"
                    aria-label="View on GitHub"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border
                               border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    <span className="hidden sm:inline">GitHub</span>
                  </a>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshState !== "idle"}
                    title={
                      refreshState === "cooldown"
                        ? `Updated recently — try again in ${refreshCooldownMin}min`
                        : "Refresh profile from GitHub"
                    }
                    aria-label="Refresh profile data from GitHub"
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border
                                transition-colors disabled:cursor-not-allowed
                                ${refreshState === "cooldown"
                                  ? "border-border text-muted-subtle"
                                  : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
                                }`}
                  >
                    <svg
                      width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
                      className={refreshState === "loading" ? "animate-spin" : ""}
                    >
                      <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                    </svg>
                    <span className="hidden sm:inline">{refreshState === "loading" ? "Refreshing…" : refreshState === "cooldown" ? `${refreshCooldownMin}min` : "Refresh"}</span>
                  </button>
                  {/* LinkedIn chip — only shown when URL is valid */}
                  {profile.linkedinUrl?.startsWith("https://") && (
                    <a
                      href={profile.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View LinkedIn profile"
                      aria-label="View LinkedIn profile"
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border
                                 border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                      </svg>
                      <span className="hidden sm:inline">LinkedIn</span>
                    </a>
                  )}
                  {/* Contact dropdown */}
                  <div className="relative">
                    <button
                      onClick={handleContactOpen}
                      title="Contact channels"
                      aria-label="Open contact channels"
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border
                                 border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2zm13 2.383-4.708 2.825L15 11.105V5.383zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741zM1 11.105l4.708-2.897L1 5.383v5.722z"/>
                      </svg>
                      <span className="hidden sm:inline">Contact</span>
                    </button>
                    {contactOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setContactOpen(false)} />
                        {/* Mobile: bottom-sheet full-width / Desktop: positioned dropdown */}
                        <div className="
                          fixed inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-border bg-surface shadow-lg py-2
                          sm:absolute sm:inset-auto sm:right-0 sm:bottom-auto sm:top-full sm:mt-1 sm:w-56 sm:rounded-lg sm:border sm:border-border sm:py-1
                        ">
                          <a
                            href={`https://github.com/${profile.login}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setContactOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                          >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                            </svg>
                            GitHub profile
                          </a>
                          {profile.linkedinUrl?.startsWith("https://") && (
                            <a
                              href={profile.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setContactOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                              </svg>
                              LinkedIn
                            </a>
                          )}
                          {contactLoading && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-subtle">
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="animate-spin" aria-hidden="true">
                                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                              </svg>
                              Looking up…
                            </div>
                          )}
                          {!contactLoading && contactDetails && (
                            <>
                              {contactDetails.email && (
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(contactDetails.email!).catch(() => {});
                                    setEmailCopied(true);
                                    setTimeout(() => setEmailCopied(false), 1500);
                                  }}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors w-full text-left"
                                  title="Click to copy email"
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
                                    <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2zm13 2.383-4.708 2.825L15 11.105V5.383zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741zM1 11.105l4.708-2.897L1 5.383v5.722z"/>
                                  </svg>
                                  <span className="flex-1 font-mono text-xs">{obfuscateEmail(contactDetails.email)}</span>
                                  <span className={`text-xs transition-opacity ${emailCopied ? "opacity-100 text-accent-green" : "opacity-0"}`}>
                                    Copied!
                                  </span>
                                </button>
                              )}
                              {contactDetails.twitter && (
                                <a
                                  href={`https://twitter.com/${contactDetails.twitter}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => setContactOpen(false)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                                  </svg>
                                  @{contactDetails.twitter}
                                </a>
                              )}
                              {contactDetails.blog?.startsWith("http") && (
                                <a
                                  href={contactDetails.blog}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => setContactOpen(false)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                                >
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                                    <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/>
                                  </svg>
                                  Website
                                </a>
                              )}
                              {!contactDetails.email && !contactDetails.twitter && !contactDetails.blog && !profile.linkedinUrl?.startsWith("https://") && (
                                <p className="px-3 py-2 text-xs text-muted-subtle">
                                  No other public contact info. Try GitHub directly.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <TourTrigger
                    tourId="profile"
                    label="Tour"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:border-accent-blue/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/40"
                  />
                </div>
              </div>
              {!profile.partial && (profile.company || profile.location) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  {profile.company && (
                    <span className="flex items-center gap-1">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M1.5 14.25V2.75C1.5 1.784 2.284 1 3.25 1h9.5c.966 0 1.75.784 1.75 1.75v11.5a.25.25 0 0 1-.25.25H11v-3.75a.75.75 0 0 0-.75-.75h-2.5a.75.75 0 0 0-.75.75V14.5H1.75a.25.25 0 0 1-.25-.25zM5.5 4.5h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5zm3 0h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5zm3 0h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5zm-6 3h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0h-1a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z"/>
                      </svg>
                      {profile.company.replace(/^@/, "")}
                    </span>
                  )}
                  {profile.location && (
                    <span className="flex items-center gap-1">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 0a5.53 5.53 0 0 0-5.5 5.5C2.5 9.5 8 16 8 16s5.5-6.5 5.5-10.5A5.53 5.53 0 0 0 8 0zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                      </svg>
                      {profile.cityNormalized ?? profile.location}
                    </span>
                  )}
                </div>
              )}
              {/* Stat chips — followers + public repos, visually distinct from descriptive text */}
              {!profile.partial && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium
                                   bg-surface border border-border px-2 py-1 rounded-full">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"
                         className="text-muted" aria-hidden="true">
                      <path d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4.001 4.001 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5zM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4zm-5.5-.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                    </svg>
                    <span className="text-foreground tabular-nums">{profile.followers.toLocaleString()}</span>
                    <span className="text-muted-subtle">followers</span>
                  </span>
                  {profile.publicRepos > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium
                                     bg-surface border border-border px-2 py-1 rounded-full">
                      <span className="text-foreground tabular-nums">{profile.publicRepos}</span>
                      <span className="text-muted-subtle">repos</span>
                    </span>
                  )}
                </div>
              )}
              {profile.languages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(profile.languages)].slice(0, 8).map((lang) => (
                    <Link
                      key={lang}
                      href={`/devs/${encodeURIComponent(lang.toLowerCase())}`}
                      className="text-2xs font-medium px-1.5 py-0.5 rounded-full border transition-opacity hover:opacity-80"
                      style={{
                        color: LANGUAGE_COLORS[lang] ?? "#8b949e",
                        borderColor: `${LANGUAGE_COLORS[lang] ?? "#8b949e"}40`,
                        backgroundColor: `${LANGUAGE_COLORS[lang] ?? "#8b949e"}14`,
                      }}
                    >
                      {lang}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section skeletons (loading state) ────────────────────────── */}
        {loadState === "loading" && (
          <div className="animate-pulse motion-reduce:animate-none space-y-8">
            <div>
              <div className="flex items-center gap-2 mb-3 pt-6 border-t border-border-subtle">
                <div className="h-3.5 w-32 bg-surface-alt rounded" />
                <div className="h-3.5 w-6 bg-surface-alt rounded-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-surface border border-border" />
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3 pt-6 border-t border-border-subtle">
                <div className="h-3.5 w-44 bg-surface-alt rounded" />
                <div className="h-3.5 w-8 bg-surface-alt rounded-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-surface border border-border" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── News / announcements ────────────────────────────────────── */}
        {login && (
          <section className="mb-2">
            <NewsTimeline login={login} maxItems={3} />
          </section>
        )}

        <hr className="border-border-subtle my-8" />

        {/* ── Tabs — mobile segmented control ─────────────────────────── */}
        <div className="block sm:hidden mb-4">
          <Tabs
            tabs={[
              { id: "github" as const, label: "GitHub", count: githubRepos?.length ?? profile?.publicRepos },
              { id: "owned" as const, label: "StarMapper", count: profile?.ownedRepos.length },
              { id: "starred" as const, label: "Starred", count: profile?.starredCount },
            ]}
            activeTab={profileTab}
            onChange={(t) => setProfileTab(t as "github" | "owned" | "starred")}
          />
        </div>

        {/* ── GitHub repos (scannable) ─────────────────────────────────── */}
        {githubRepos && githubRepos.length > 0 && (
          <section
            className={`mb-2 ${profileTab !== "github" ? "hidden sm:block" : ""}`}
            aria-labelledby="gh-repos-heading"
          >
            <div className="flex items-center gap-2 mb-3 sticky top-14 z-10 bg-background/90 backdrop-blur -mx-4 sm:-mx-5 px-4 sm:px-5 pb-2">
              <h2 id="gh-repos-heading" className="text-foreground text-sm font-semibold">GitHub Repos</h2>
              <span className="text-muted-subtle text-xs bg-surface border border-border px-1.5 py-0.5 rounded-full tabular-nums">
                {profile?.publicRepos ?? githubRepos.length}
              </span>
              <button
                onClick={handleScanOpen}
                title="Select a repo to map"
                aria-label="Select a repo to map"
                className="inline-flex items-center gap-1 text-2xs font-medium px-2 py-1 rounded-full border
                           border-accent-green/60 text-accent-green hover:bg-accent-green/10 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>
                </svg>
                Map a repo
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {githubRepos.map((r) => (
                <Link
                  key={r.fullName}
                  href={`/${r.fullName}`}
                  className="flex flex-col gap-1.5 p-3 rounded-lg border border-border bg-surface
                             hover:border-accent-blue/50 hover:bg-surface-alt transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-foreground text-sm font-medium group-hover:text-accent-blue
                                     transition-colors truncate leading-snug">
                      {r.name}
                    </span>
                    {r.language && (
                      <span
                        className="shrink-0 text-2xs font-medium px-1.5 py-0.5 rounded-full border"
                        style={{
                          color: LANGUAGE_COLORS[r.language] ?? "#8b949e",
                          borderColor: `${LANGUAGE_COLORS[r.language] ?? "#8b949e"}40`,
                          backgroundColor: `${LANGUAGE_COLORS[r.language] ?? "#8b949e"}14`,
                        }}
                      >
                        {r.language}
                      </span>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted line-clamp-1">{r.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>
                      </svg>
                      {formatCount(r.stars)}
                    </span>
                    <span className="ml-auto text-accent-blue text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                      Map stargazers →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            {profile && profile.publicRepos > githubRepos.length && (
              <a
                href={`https://github.com/${login}?tab=repositories&type=source`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-accent-blue hover:underline"
              >
                See all {profile.publicRepos} repos on GitHub →
              </a>
            )}
          </section>
        )}

        <hr className={`border-border-subtle my-8 ${profileTab !== "owned" ? "hidden sm:block" : ""}`} />

        {/* ── Owned repos ─────────────────────────────────────────────── */}
        {profile && profile.ownedRepos.length > 0 && (
          <section
            data-tour="profile-repos"
            className={`mb-2 ${profileTab !== "owned" ? "hidden sm:block" : ""}`}
            aria-labelledby="owned-heading"
          >
            <SectionHeader
              title="Repos on StarMapper"
              count={profile.ownedRepos.length}
              id="owned-heading"
              noBorder
              sticky
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ownedVisible?.map((r) => (
                <RepoCard key={`${r.owner}/${r.repo}`} repo={r} />
              ))}
            </div>
            {profile.ownedRepos.length > 12 && (
              <button
                onClick={() => setShowAllOwned((v) => !v)}
                className="mt-3 text-sm text-accent-blue hover:underline"
              >
                {showAllOwned
                  ? "Show less"
                  : `Show all ${profile.ownedRepos.length} repos`}
              </button>
            )}
          </section>
        )}

        <hr className={`border-border-subtle my-8 ${profileTab !== "starred" ? "hidden sm:block" : ""}`} />

        {/* ── Starred repos ────────────────────────────────────────────── */}
        {profile && (
          <section
            className={`mb-2 ${profileTab !== "starred" ? "hidden sm:block" : ""}`}
            aria-labelledby="starred-heading"
          >
            <SectionHeader
              title="Starred repos on StarMapper"
              count={profile.starredCount}
              id="starred-heading"
              noBorder
              sticky
            />
            {profile.starredRepos.length === 0 ? (
              <p className="text-muted text-sm">
                {profile.starredCount === 0
                  ? "Hasn't starred any tracked repo yet."
                  : "Stars found but no badge data available — try scanning the repos directly."}
              </p>
            ) : (
              <>
                {/* Filter + sort controls */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  {/* Language filter chips */}
                  {starredLangs.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => { setStarredLang(null); setShowAllStarred(false); }}
                        className={`text-2xs font-medium px-2 py-0.5 rounded-full border transition-colors
                          ${starredLang === null
                            ? "border-accent-blue/50 text-accent-blue bg-accent-blue/10"
                            : "border-border text-muted hover:text-foreground"}`}
                      >
                        All
                      </button>
                      {starredLangs.map((lang) => (
                        <button
                          key={lang}
                          onClick={() => { setStarredLang(starredLang === lang ? null : lang); setShowAllStarred(false); }}
                          className={`text-2xs font-medium px-2 py-0.5 rounded-full border transition-colors
                            ${starredLang === lang
                              ? "border-accent-blue/50 text-accent-blue bg-accent-blue/10"
                              : "border-border text-muted hover:text-foreground"}`}
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Sort buttons */}
                  <div className="flex items-center gap-0.5 ml-auto">
                    {(["date", "stars", "mapped"] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setStarredSort(opt)}
                        className={`text-2xs px-2 py-1 rounded transition-colors
                          ${starredSort === opt
                            ? "bg-surface-alt text-foreground"
                            : "text-muted hover:text-foreground"}`}
                      >
                        {opt === "date" ? "Recent" : opt === "stars" ? "Stars" : "Mapped %"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {starredVisible.map((r) => (
                    <RepoCard key={`${r.owner}/${r.repo}`} repo={r} />
                  ))}
                </div>
                {starredFiltered.length === 0 && (
                  <p className="text-muted text-sm mt-2">No repos match this filter.</p>
                )}
                {starredFiltered.length > 12 && (
                  <button
                    onClick={() => setShowAllStarred((v) => !v)}
                    className="mt-3 text-sm text-accent-blue hover:underline"
                  >
                    {showAllStarred
                      ? "Show less"
                      : `Show all ${starredFiltered.length} results`}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        </div>{/* end left panel */}

        {/* ── Developers nearby — bottom section on mobile, right column on lg ── */}
        {(hasMap || loadState === "loading") && (
          <aside
            data-tour="profile-nearby"
            aria-label="Developers nearby"
            className="w-full lg:flex-1 lg:overflow-y-auto border-t border-border-subtle lg:border-t-0 px-4 sm:px-5 py-6 pb-12 bg-surface/30 lg:bg-transparent"
          >
            {nearby === null ? (
              /* loading skeleton */
              <div className="animate-pulse motion-reduce:animate-none space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-3.5 w-36 bg-surface-alt rounded" />
                  <div className="h-3.5 w-6 bg-surface-alt rounded-full" />
                </div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-surface border border-border" />
                ))}
              </div>
            ) : nearby.users.length === 0 ? (
              <p className="text-muted text-sm pt-2">No developers found nearby.</p>
            ) : (
              <section aria-labelledby="nearby-heading">
                <SectionHeader title="Developers nearby" count={nearby.total} id="nearby-heading" noBorder />
                <ul className="flex flex-col gap-1.5" role="list">
                  {nearby.users.slice(0, 10).map((u) => {
                    const isPinned = pinnedLogins.has(u.login);
                    return (
                      <li key={u.login}>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border
                                        bg-surface hover:border-accent-blue/50 hover:bg-surface-alt
                                        transition-colors group">
                          <Link href={`/profile/${u.login}`} className="relative shrink-0">
                            <img
                              src={`https://github.com/${u.login}.png`}
                              alt=""
                              className="size-9 rounded-full border border-border"
                              width={36}
                              height={36}
                            />
                            {u.trackedRepos > 1 && (
                              <span className="absolute -bottom-0.5 -right-0.5 min-w-4 h-4 px-0.5
                                               flex items-center justify-center
                                               text-2xs font-semibold tabular-nums leading-none
                                               bg-accent-blue text-background rounded-full border border-background">
                                {u.trackedRepos}
                              </span>
                            )}
                          </Link>
                          <Link href={`/profile/${u.login}`} className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm text-foreground group-hover:text-accent-blue
                                             transition-colors font-medium truncate leading-snug">
                              {u.name ?? u.login}
                            </span>
                            {u.cityNormalized && (
                              <span className="text-xs text-muted truncate">{u.cityNormalized}</span>
                            )}
                          </Link>
                          <div className="flex flex-col items-end shrink-0 gap-0.5">
                            <span className="text-xs font-medium text-muted tabular-nums">
                              {u.distanceKm < 1 ? "<1" : u.distanceKm.toFixed(0)} km
                            </span>
                            <span className="text-2xs text-muted-subtle tabular-nums">
                              {formatCount(u.followers)} followers
                            </span>
                          </div>
                          <button
                            onClick={() => togglePin(u)}
                            title={isPinned ? "Unpin from map" : "Pin on map"}
                            aria-label={isPinned ? `Unpin ${u.login} from map` : `Pin ${u.login} on map`}
                            className={`shrink-0 p-1.5 rounded-md transition-colors
                              ${isPinned
                                ? "text-accent-blue bg-accent-blue/10 hover:bg-accent-blue/20"
                                : "text-muted-subtle hover:text-foreground hover:bg-surface-alt opacity-0 group-hover:opacity-100"
                              }`}
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path d="M8 0a5.53 5.53 0 0 0-5.5 5.5C2.5 9.5 8 16 8 16s5.5-6.5 5.5-10.5A5.53 5.53 0 0 0 8 0zm0 7.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                            </svg>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>{/* end flex container */}

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}

      <Modal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        title={`Map a repo from ${login}`}
        maxWidth="max-w-xl"
      >
        <div className="flex flex-col">
          {/* Search + sort */}
          <div className="px-5 py-3 border-b border-border-subtle flex items-center gap-2">
            <input
              type="text"
              value={scanSearch}
              onChange={(e) => setScanSearch(e.target.value)}
              placeholder="Search repos…"
              autoFocus
              className="flex-1 bg-surface-alt border border-border rounded-md px-3 py-2 text-sm
                         text-foreground placeholder:text-muted focus:outline-none
                         focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
            />
            <div className="flex items-center gap-0.5 shrink-0">
              {(["stars", "name"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setScanSort(opt)}
                  className={`text-2xs px-2.5 py-1.5 rounded-md transition-colors
                    ${scanSort === opt
                      ? "bg-surface-alt text-foreground border border-border"
                      : "text-muted hover:text-foreground"}`}
                >
                  {opt === "stars" ? "★ Stars" : "A–Z"}
                </button>
              ))}
            </div>
          </div>

          {/* Repo list */}
          <div className="overflow-y-auto max-h-96 divide-y divide-border-subtle">
            {scanLoading && (
              <div className="flex items-center justify-center py-10 gap-2 text-muted text-sm">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="animate-spin" aria-hidden="true">
                  <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                </svg>
                Loading repos…
              </div>
            )}
            {!scanLoading && scanFiltered.length === 0 && (
              <p className="py-10 text-center text-muted text-sm">
                {scanSearch ? "No repos match." : "No public repos found."}
              </p>
            )}
            {!scanLoading && scanFiltered.map((r) => (
              <Link
                key={r.name}
                href={`/${login}/${r.name}`}
                onClick={() => setScanModalOpen(false)}
                className="flex items-start gap-3 px-5 py-3.5 hover:bg-surface-alt transition-colors group"
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground group-hover:text-accent-blue
                                     transition-colors truncate">
                      {r.name}
                    </span>
                    {r.fork && (
                      <span className="shrink-0 text-2xs px-1.5 py-0.5 rounded-full border border-border text-muted-subtle">
                        fork
                      </span>
                    )}
                    {r.language && (
                      <span
                        className="shrink-0 text-2xs font-medium px-1.5 py-0.5 rounded-full border"
                        style={{
                          color: LANGUAGE_COLORS[r.language] ?? "#8b949e",
                          borderColor: `${LANGUAGE_COLORS[r.language] ?? "#8b949e"}40`,
                          backgroundColor: `${LANGUAGE_COLORS[r.language] ?? "#8b949e"}14`,
                        }}
                      >
                        {r.language}
                      </span>
                    )}
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted line-clamp-1">{r.description}</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1 text-xs text-muted tabular-nums pt-0.5">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/>
                  </svg>
                  {formatCount(r.stars)}
                </div>
              </Link>
            ))}
          </div>

          <div className="px-5 py-3 border-t border-border-subtle flex items-center justify-between">
            <span className="text-xs text-muted-subtle">
              {scanRepos ? `${scanFiltered.length} / ${scanRepos.length} repos` : ""}
            </span>
            <button
              onClick={() => setScanModalOpen(false)}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
