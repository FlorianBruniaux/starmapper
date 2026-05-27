// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { NewsItem } from "@/app/api/news/route";
import { NewsPublishModal } from "@/components/news-publish-modal";
import { FollowButton } from "@/components/follow-button";
import { getStoredToken, getStoredUsername } from "@/lib/token";

type Props = {
  login: string;
  maxItems?: number;
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

const isStale = (items: NewsItem[]): boolean => {
  if (!items[0]) return false;
  return Date.now() - new Date(items[0].publishedAt).getTime() > 90 * 86_400_000;
};


export const NewsTimeline = ({ login, maxItems }: Props) => {
  const [appUrl, setAppUrl] = useState("");
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch(`/api/news/${login}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as { items: NewsItem[] };
      setItems(data.items);
    } catch {
      setItems([]);
    }
  }, [login]);

  useEffect(() => {
    setAppUrl(window.location.origin);
  }, []);

  useEffect(() => {
    const storedLogin = getStoredUsername().toLowerCase();
    setIsOwner(!!getStoredToken() && storedLogin === login.toLowerCase());
    fetchNews();
  }, [fetchNews, login]);

  const handlePublished = useCallback(() => {
    setShowPublish(false);
    fetchNews();
  }, [fetchNews]);

  const handleDelete = useCallback(async (id: number) => {
    const pat = getStoredToken();
    if (!pat) return;
    setDeleteLoading(id);
    try {
      await fetch(`/api/news/item/${id}`, {
        method: "DELETE",
        headers: { "x-gh-token": pat },
      });
      setItems((prev) => prev?.filter((n) => n.id !== id) ?? []);
    } finally {
      setDeleteLoading(null);
    }
  }, []);

  const rssUrl = `${appUrl}/api/feed/${login}/rss`;
  const jsonUrl = `${appUrl}/api/feed/${login}/json`;
  const stale = items && items.length > 0 && isStale(items);
  const visibleItems = items && maxItems ? items.slice(0, maxItems) : items;
  const hasMore = items && maxItems ? items.length > maxItems : false;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">News</h2>
          <FollowButton login={login} />
          {stale && (
            <span className="text-xs text-muted bg-surface-alt px-2 py-0.5 rounded-full">
              Last post {formatRelativeDate(items![0].publishedAt)}
            </span>
          )}
        </div>
        {isOwner && (
          <button
            onClick={() => setShowPublish(true)}
            className="text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors"
          >
            Publish
          </button>
        )}
      </div>

      {items === null && (
        <div className="h-10 rounded-lg bg-surface animate-pulse" />
      )}

      {items !== null && items.length === 0 && isOwner && (
        <button
          onClick={() => setShowPublish(true)}
          className="w-full py-4 rounded-lg border border-dashed border-border text-sm text-muted hover:text-foreground hover:border-accent-blue/50 transition-colors"
        >
          Write your first announcement
        </button>
      )}

      {items !== null && items.length === 0 && !isOwner && (
        <p className="py-3 text-sm text-muted">No news yet.</p>
      )}

      {visibleItems !== null && visibleItems.length > 0 && (
        <>
          <ul className="space-y-2">
            {visibleItems.map((item) => (
              <li
                key={item.id}
                className="group relative rounded-lg bg-surface border border-border p-3 text-sm"
              >
                <p className="text-foreground leading-relaxed break-words">{item.body}</p>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="text-xs text-muted">{formatRelativeDate(item.publishedAt)}</span>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:underline flex items-center gap-1"
                    >
                      <ExternalLink size={10} aria-hidden="true" />
                      Link
                    </a>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={deleteLoading === item.id}
                      className="ml-auto text-xs text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-50"
                    >
                      {deleteLoading === item.id ? "Deleting…" : "Delete"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {hasMore && (
            <a
              href={`/feed/${login}`}
              className="block text-xs text-muted hover:text-accent-orange transition-colors"
            >
              View all →
            </a>
          )}
        </>
      )}

      {showPublish && (
        <NewsPublishModal
          login={login}
          rssUrl={rssUrl}
          jsonUrl={jsonUrl}
          onClose={() => setShowPublish(false)}
          onPublished={handlePublished}
        />
      )}
    </section>
  );
};
