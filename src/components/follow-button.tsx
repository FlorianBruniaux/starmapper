// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState } from "react";
import { addSubscription, hasSubscription, removeSubscription } from "@/lib/subscriptions";

type Props = { login: string; minimal?: boolean };

const RssIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const FollowButton = ({ login, minimal = false }: Props) => {
  const [following, setFollowing] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"rss" | "json" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFollowing(hasSubscription(login));
  }, [login]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleFollow = () => {
    if (following) {
      removeSubscription(login);
      setFollowing(false);
    } else {
      addSubscription(login);
      setFollowing(true);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const rssUrl = `${origin}/api/feed/${login}/rss`;
  const jsonUrl = `${origin}/api/feed/${login}/json`;

  const copyUrl = async (which: "rss" | "json") => {
    try {
      await navigator.clipboard.writeText(which === "rss" ? rssUrl : jsonUrl);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  if (following === null) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border text-muted opacity-50 cursor-default"
      >
        <RssIcon />
        Follow
      </button>
    );
  }

  if (minimal) {
    return (
      <button
        type="button"
        onClick={toggleFollow}
        aria-pressed={following}
        aria-label={following ? `Unfollow ${login}` : `Follow ${login} on StarMapper`}
        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
          following
            ? "border-accent-green-emphasis text-accent-green hover:bg-accent-green-emphasis/10"
            : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
        }`}
      >
        <RssIcon />
        {following ? "Following" : "Follow"}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={following ? `Following ${login} — click to manage` : `Follow ${login} on StarMapper`}
        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
          following
            ? "border-accent-green-emphasis text-accent-green hover:bg-accent-green-emphasis/10"
            : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
        }`}
      >
        <RssIcon />
        {following ? "Following" : "Follow"}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-border bg-surface shadow-xl overflow-hidden"
        >
          {/* Follow toggle */}
          <button
            type="button"
            role="menuitem"
            aria-pressed={following}
            onClick={toggleFollow}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors text-left hover:bg-surface-alt ${
              following ? "text-accent-green" : "text-muted hover:text-foreground"
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                following ? "border-accent-green bg-accent-green/10" : "border-border"
              }`}
            >
              {following && <CheckIcon />}
            </span>
            <span>Follow on StarMapper</span>
          </button>

          <div className="border-t border-border-subtle mx-4" />

          {/* RSS URLs */}
          <div className="px-4 py-2.5 space-y-2">
            <p className="text-xs text-muted mb-1.5">Subscribe via RSS reader:</p>
            {(["rss", "json"] as const).map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <span className="text-xs text-muted w-10 shrink-0">{kind === "rss" ? "RSS" : "JSON"}</span>
                <input
                  readOnly
                  value={kind === "rss" ? rssUrl : jsonUrl}
                  aria-label={`${kind.toUpperCase()} feed URL`}
                  className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs font-mono text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => copyUrl(kind)}
                  aria-label={copied === kind ? "Copied" : `Copy ${kind.toUpperCase()} URL`}
                  className={`shrink-0 text-xs px-2 py-1 rounded border transition-colors ${
                    copied === kind
                      ? "border-accent-green/40 text-accent-green"
                      : "border-border text-muted hover:text-foreground hover:border-accent-blue/50"
                  }`}
                >
                  {copied === kind ? "✓" : "Copy"}
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 pb-3">
            <a href={`/feed/${login}`} className="text-xs text-accent-blue hover:underline">
              Open subscribe page →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
