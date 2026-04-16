// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/header";
import { StargazerMapDynamic } from "@/components/map/stargazer-map-dynamic";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { LANGUAGE_COLORS } from "@/lib/language-colors";
import type { ProfileResponse, ProfileRepo } from "@/app/api/profile/[login]/route";
import type { NearbyResponse } from "@/app/api/explore/nearby/route";
import type { StargazerPoint } from "@/app/api/chunk/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  title, count, id, noBorder = false,
}: {
  title: string; count?: number; id?: string; noBorder?: boolean;
}) => (
  <div className={`flex items-center gap-2 mb-3 ${noBorder ? "" : "pt-6 border-t border-border-subtle"}`}>
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
  const [loadState, setLoadState] = useState<"loading" | "not-found" | "error" | "loaded">("loading");
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);
  const [showAllOwned, setShowAllOwned] = useState(false);
  const [showAllStarred, setShowAllStarred] = useState(false);

  // Token modal
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
  }, []);

  // Resolve async params
  useEffect(() => {
    params.then(({ login: l }) => setLogin(l));
  }, [params]);

  useEffect(() => {
    setHasToken(!!getStoredToken());
  }, []);

  // Fetch profile
  useEffect(() => {
    if (!login) return;
    setLoadState("loading");
    setProfile(null);
    setNearby(null);

    const ctrl = new AbortController();
    fetch(`/api/profile/${encodeURIComponent(login)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404) { setLoadState("not-found"); return; }
        if (!res.ok) { setLoadState("error"); return; }
        const data = await res.json() as ProfileResponse;
        setProfile(data);
        setLoadState("loaded");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setLoadState("error");
      });

    return () => ctrl.abort();
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

  // Build a single synthetic StargazerPoint for the mini-map
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
          <p className="text-foreground font-semibold">User not tracked yet</p>
          <p className="text-muted text-sm max-w-xs">
            <code className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-xs">
              {login}
            </code>{" "}
            hasn&apos;t been seen on any StarMapper scan yet.
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

  const ownedVisible = showAllOwned ? profile?.ownedRepos : profile?.ownedRepos.slice(0, 12);
  const starredVisible = showAllStarred ? profile?.starredRepos : profile?.starredRepos.slice(0, 12);
  const hasMap = !!(profile?.lat && profile?.lng);

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

      {/* Two-column when map available, centered single column otherwise */}
      <div className={hasMap ? "flex flex-1 overflow-hidden" : "flex flex-1"}>

        {/* ── Left / main content panel ─────────────────────────────── */}
        <div
          id="main"
          className={
            hasMap
              ? "flex-[2] overflow-y-auto border-r border-border-subtle px-5 py-6 pb-12"
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
          <div className="flex items-start gap-5 mb-8">
            <img
              src={`https://github.com/${profile.login}.png`}
              alt={`${profile.login} avatar`}
              className="size-20 rounded-full border border-border shrink-0"
              width={80}
              height={80}
            />
            <div className="flex flex-col gap-1.5 min-w-0 pt-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
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

        {/* ── Owned repos ─────────────────────────────────────────────── */}
        {profile && profile.ownedRepos.length > 0 && (
          <section className="mb-2" aria-labelledby="owned-heading">
            <SectionHeader
              title="Repos on StarMapper"
              count={profile.ownedRepos.length}
              id="owned-heading"
              noBorder
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

        {/* ── Starred repos ────────────────────────────────────────────── */}
        {profile && (
          <section className="mb-2" aria-labelledby="starred-heading">
            <SectionHeader
              title="Starred repos on StarMapper"
              count={profile.starredCount}
              id="starred-heading"
            />
            {profile.starredRepos.length === 0 ? (
              <p className="text-muted text-sm">
                {profile.starredCount === 0
                  ? "Hasn't starred any tracked repo yet."
                  : "Stars found but no badge data available — try scanning the repos directly."}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {starredVisible?.map((r) => (
                    <RepoCard key={`${r.owner}/${r.repo}`} repo={r} />
                  ))}
                </div>
                {profile.starredRepos.length > 12 && (
                  <button
                    onClick={() => setShowAllStarred((v) => !v)}
                    className="mt-3 text-sm text-accent-blue hover:underline"
                  >
                    {showAllStarred
                      ? "Show less"
                      : `Show all ${profile.starredRepos.length} results`}
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {/* ── People nearby ────────────────────────────────────────────── */}
        {nearby && nearby.users.length > 0 && (
          <section className="mb-2" aria-labelledby="nearby-heading">
            <SectionHeader title="Developers nearby" count={nearby.total} id="nearby-heading" />
            <ul className="flex flex-col gap-1.5" role="list">
              {nearby.users.slice(0, 10).map((u) => (
                <li key={u.login}>
                  <Link
                    href={`/profile/${u.login}`}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border
                               bg-surface hover:border-accent-blue/50 hover:bg-surface-alt
                               transition-colors group"
                  >
                    {/* avatar + trackedRepos badge overlay */}
                    <div className="relative shrink-0">
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
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-foreground group-hover:text-accent-blue
                                       transition-colors font-medium truncate leading-snug">
                        {u.name ?? u.login}
                      </span>
                      {u.cityNormalized && (
                        <span className="text-xs text-muted truncate">{u.cityNormalized}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-0.5">
                      <span className="text-xs font-medium text-muted tabular-nums">
                        {u.distanceKm < 1 ? "<1" : u.distanceKm.toFixed(0)} km
                      </span>
                      <span className="text-2xs text-muted-subtle tabular-nums">
                        {formatCount(u.followers)} followers
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Footer link to GitHub ─────────────────────────────────────── */}
        {profile && (
          <div className="pt-4 border-t border-border">
            <a
              href={`https://github.com/${profile.login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              View on GitHub
            </a>
          </div>
        )}
        </div>{/* end left panel */}

        {/* ── Right: full-height map ──────────────────────────────────── */}
        {hasMap && (
          <div className="flex-1 relative">
            <StargazerMapDynamic points={miniMapPoints} />
          </div>
        )}
      </div>{/* end two-column flex container */}

      {tokenOpen && <TokenModal onClose={handleTokenClose} />}
    </div>
  );
}
