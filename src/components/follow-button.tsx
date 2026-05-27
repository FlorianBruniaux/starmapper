// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState } from "react";
import { Rss, Check } from "lucide-react";
import { addSubscription, hasSubscription, removeSubscription } from "@/lib/subscriptions";

type Props = { login: string; minimal?: boolean };

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
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
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
        <Rss size={11} aria-hidden="true" />
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
        <Rss size={11} aria-hidden="true" />
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
        <Rss size={11} aria-hidden="true" />
        {following ? "Following" : "Follow"}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 z-50 w-96 rounded-xl border border-border bg-surface shadow-xl overflow-hidden"
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
              {following && <Check size={10} aria-hidden="true" />}
            </span>
            <span>Follow on StarMapper</span>
          </button>

          <div className="border-t border-border-subtle mx-4" />

          {/* RSS URLs */}
          <div className="px-4 py-3 space-y-2.5">
            <p className="text-xs text-muted mb-2">Subscribe via RSS reader:</p>
            {(["rss", "json"] as const).map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <span className="text-xs text-muted w-10 shrink-0">{kind === "rss" ? "RSS" : "JSON"}</span>
                <input
                  readOnly
                  value={kind === "rss" ? rssUrl : jsonUrl}
                  aria-label={`${kind.toUpperCase()} feed URL`}
                  className="flex-1 min-w-0 bg-background border border-border rounded px-2.5 py-1.5 text-xs font-mono text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
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

          <div className="px-4 pb-4">
            <a href={`/feed/${login}`} className="text-xs text-accent-blue hover:underline">
              Open subscribe page →
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
