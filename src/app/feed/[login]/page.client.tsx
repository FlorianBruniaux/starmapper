// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { FollowButton } from "@/components/follow-button";

type Props = { login: string; rssUrl: string; jsonUrl: string };

const RssIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="5" cy="19" r="1" fill="currentColor"/>
  </svg>
);

const JsonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 3H7a4 4 0 00-4 4v1a2 2 0 01-2 2 2 2 0 012 2v1a4 4 0 004 4h1M16 3h1a4 4 0 014 4v1a2 2 0 002 2 2 2 0 00-2 2v1a4 4 0 01-4 4h-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const feeds = [
  {
    key: "rss" as const,
    label: "RSS 2.0",
    icon: <RssIcon />,
    color: "text-accent-orange",
    hint: "Feedly, Reeder, Inoreader…",
  },
  {
    key: "json" as const,
    label: "JSON Feed",
    icon: <JsonIcon />,
    color: "text-accent-blue",
    hint: "n8n, Zapier, custom integrations",
  },
];

export const FeedPageClient = ({ login, rssUrl, jsonUrl }: Props) => {
  const [copied, setCopied] = useState<"rss" | "json" | null>(null);

  const copy = async (which: "rss" | "json") => {
    const url = which === "rss" ? rssUrl : jsonUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback: input was focused for manual copy
    }
  };

  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Subscribe</h2>
          <p className="text-xs text-muted mt-0.5">
            Add to your feed reader.{" "}
            <a
              href="https://aboutfeeds.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue hover:underline"
            >
              What&apos;s a feed?
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FollowButton login={login} minimal />
          <div className="flex items-center gap-1.5 text-xs text-muted bg-surface-alt border border-border rounded-full px-2.5 py-1">
            <RssIcon />
            <span>Feed</span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {feeds.map(({ key, label, icon, color, hint }) => {
          const url = key === "rss" ? rssUrl : jsonUrl;
          const isCopied = copied === key;

          return (
            <div key={key} className="px-4 py-3 flex items-center gap-3">
              <div className={`shrink-0 ${color}`}>{icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-medium text-foreground">{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </div>
                <input
                  readOnly
                  value={url}
                  aria-label={`${label} feed URL`}
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <button
                onClick={() => copy(key)}
                aria-label={isCopied ? "Copied" : `Copy ${label} URL`}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  isCopied
                    ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                    : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
                }`}
              >
                {isCopied ? (
                  <>
                    <CheckIcon />
                    Copied
                  </>
                ) : (
                  "Copy"
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
