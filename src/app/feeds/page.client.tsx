// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getSubscriptions, removeSubscription } from "@/lib/subscriptions";
import type { Subscription } from "@/lib/subscriptions";
import type { NewsItem } from "@/app/api/news/route";

type FeedCard = {
  login: string;
  subscribedAt: number;
  status: "loading" | "ok" | "empty" | "error";
  items: NewsItem[];
};

const formatRelativeDate = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

const SkeletonCard = () => (
  <div className="rounded-xl bg-surface border border-border overflow-hidden animate-pulse">
    <div className="p-4 flex items-center gap-3 border-b border-border">
      <div className="w-9 h-9 rounded-full bg-surface-alt shrink-0" />
      <div className="space-y-1.5 flex-1">
        <div className="h-3 w-24 bg-surface-alt rounded" />
        <div className="h-2.5 w-16 bg-surface-alt rounded" />
      </div>
    </div>
    <div className="p-4 space-y-2">
      <div className="h-3 w-full bg-surface-alt rounded" />
      <div className="h-3 w-4/5 bg-surface-alt rounded" />
    </div>
  </div>
);

const EmptyState = () => (
  <div className="flex flex-col items-center gap-4 py-20 text-center">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-muted opacity-30" aria-hidden="true">
      <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
    </svg>
    <div className="space-y-1">
      <p className="text-sm font-medium text-foreground">No subscriptions yet</p>
      <p className="text-sm text-muted max-w-xs">
        Click <strong className="text-foreground">Follow</strong> on any developer profile to start tracking their announcements.
      </p>
    </div>
    <Link
      href="/devs"
      className="mt-2 text-sm text-accent-blue hover:underline"
    >
      Discover developers →
    </Link>
  </div>
);

const UnfollowIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
  </svg>
);

const FeedCardView = ({
  card,
  onUnfollow,
  onRetry,
}: {
  card: FeedCard;
  onUnfollow: (login: string) => void;
  onRetry: (login: string) => void;
}) => {
  const [retrying, setRetrying] = useState(false);

  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <Link href={`/profile/${card.login}`} className="shrink-0">
          <Image
            src={`https://github.com/${card.login}.png`}
            alt={`${card.login} avatar`}
            width={36}
            height={36}
            className="rounded-full border border-border"
            unoptimized
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/profile/${card.login}`}
            className="text-sm font-medium text-foreground hover:text-accent-blue transition-colors truncate block"
          >
            @{card.login}
          </Link>
        </div>
        <button
          type="button"
          onClick={() => onUnfollow(card.login)}
          aria-label={`Unfollow ${card.login}`}
          title="Unfollow"
          className="shrink-0 p-1.5 rounded text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
        >
          <UnfollowIcon />
        </button>
      </div>

      {/* Card body */}
      <div className="p-4 flex-1 space-y-2">
        {card.status === "loading" && (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 w-full bg-surface-alt rounded" />
            <div className="h-3 w-4/5 bg-surface-alt rounded" />
          </div>
        )}

        {card.status === "error" && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Couldn&apos;t load</span>
            <button
              type="button"
              onClick={async () => {
                setRetrying(true);
                onRetry(card.login);
                setRetrying(false);
              }}
              disabled={retrying}
              className="text-accent-blue hover:underline disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {(card.status === "ok" || card.status === "empty") && card.items.length === 0 && (
          <p className="text-xs text-muted">No news yet.</p>
        )}

        {card.status === "ok" && card.items.length > 0 && (
          <ul className="space-y-2.5">
            {card.items.slice(0, 2).map((item) => (
              <li key={item.id} className="space-y-1">
                <p className="text-xs text-foreground leading-relaxed line-clamp-2">{item.body}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{formatRelativeDate(item.publishedAt)}</span>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:underline"
                    >
                      Link →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Card footer */}
      <div className="px-4 py-2.5 border-t border-border">
        <Link
          href={`/profile/${card.login}`}
          className="text-xs text-muted hover:text-accent-blue transition-colors"
        >
          View profile →
        </Link>
      </div>
    </div>
  );
};

export const FeedsPageClient = () => {
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [cards, setCards] = useState<Record<string, FeedCard>>({});

  useEffect(() => {
    setSubs(getSubscriptions());
  }, []);

  const loadCards = useCallback((subscriptions: Subscription[]) => {
    const initial: Record<string, FeedCard> = {};
    for (const s of subscriptions) {
      initial[s.login] = { login: s.login, subscribedAt: s.subscribedAt, status: "loading", items: [] };
    }
    setCards(initial);

    void Promise.all(
      subscriptions.map(async (s) => {
        try {
          const res = await fetch(`/api/news/${s.login}`);
          if (!res.ok) throw new Error(`status ${res.status}`);
          const data = await res.json() as { items: NewsItem[] };
          setCards((prev) => ({
            ...prev,
            [s.login]: { ...prev[s.login], status: data.items.length > 0 ? "ok" : "empty", items: data.items },
          }));
        } catch {
          setCards((prev) => ({
            ...prev,
            [s.login]: { ...prev[s.login], status: "error", items: [] },
          }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    if (subs === null || subs.length === 0) return;
    loadCards(subs);
  }, [subs, loadCards]);

  const handleRetry = useCallback(async (login: string) => {
    setCards((prev) => ({ ...prev, [login]: { ...prev[login], status: "loading" } }));
    try {
      const res = await fetch(`/api/news/${login}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json() as { items: NewsItem[] };
      setCards((prev) => ({
        ...prev,
        [login]: { ...prev[login], status: data.items.length > 0 ? "ok" : "empty", items: data.items },
      }));
    } catch {
      setCards((prev) => ({ ...prev, [login]: { ...prev[login], status: "error" } }));
    }
  }, []);

  const handleUnfollow = (login: string) => {
    removeSubscription(login);
    setSubs((prev) => prev?.filter((s) => s.login !== login) ?? []);
    setCards((prev) => {
      const next = { ...prev };
      delete next[login];
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground">Your feeds</h1>
          <p className="text-sm text-muted mt-0.5">
            Latest announcements from developers you follow.
          </p>
        </div>
        {subs !== null && subs.length > 0 && (
          <span className="text-xs text-muted bg-surface border border-border rounded-full px-2.5 py-1 shrink-0">
            {subs.length} following
          </span>
        )}
      </div>

      {/* Loading skeleton */}
      {subs === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {subs !== null && subs.length === 0 && <EmptyState />}

      {/* Cards grid */}
      {subs !== null && subs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {subs.map((s) => {
            const card = cards[s.login] ?? {
              login: s.login,
              subscribedAt: s.subscribedAt,
              status: "loading" as const,
              items: [],
            };
            return (
              <FeedCardView key={s.login} card={card} onUnfollow={handleUnfollow} onRetry={handleRetry} />
            );
          })}
        </div>
      )}

      {subs !== null && subs.length > 0 && (
        <p className="text-xs text-muted text-center pt-2">
          Subscriptions stored locally in this browser. Clearing site data will reset them.
        </p>
      )}
    </div>
  );
};
