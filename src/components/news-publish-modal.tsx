// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredToken } from "@/lib/token";

type Props = {
  login: string;
  rssUrl: string;
  jsonUrl: string;
  onClose: () => void;
  onPublished: () => void;
};

type ApiError = "pat_required" | "pat_invalid" | "cooldown_active" | "body_required" | "body_too_long" | "url_invalid" | "internal";

const BODY_MAX = 280;

const formatRetry = (secs: number): string => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
};

export const NewsPublishModal = ({ login, rssUrl, jsonUrl, onClose, onPublished }: Props) => {
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);
  const [copied, setCopied] = useState<"rss" | "json" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasToken = !!getStoredToken();

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const copyUrl = useCallback(async (which: "rss" | "json") => {
    const target = which === "rss" ? rssUrl : jsonUrl;
    try {
      await navigator.clipboard.writeText(target);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback: select input text
    }
  }, [rssUrl, jsonUrl]);

  const handleSubmit = useCallback(async () => {
    const pat = getStoredToken();
    if (!pat) {
      setError("Paste your GitHub token first — it's the same one used to scan repos.");
      return;
    }

    if (!body.trim()) { setError("Write something first."); return; }
    if (body.length > BODY_MAX) { setError(`Max ${BODY_MAX} chars.`); return; }
    if (url && !/^https?:\/\/.+/.test(url)) { setError("URL must start with https://"); return; }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gh-token": pat },
        body: JSON.stringify({ body: body.trim(), url: url || undefined }),
      });

      const data = await res.json() as { error?: ApiError; retryAfterSec?: number };

      if (!res.ok) {
        if (data.error === "cooldown_active" && data.retryAfterSec) {
          setRetryAfterSec(data.retryAfterSec);
          setError(`Next post available in ${formatRetry(data.retryAfterSec)}.`);
        } else if (data.error === "pat_invalid") {
          setError(`Token doesn't match @${login}. Change it via the key icon above.`);
        } else {
          setError("Something went wrong. Try again.");
        }
        return;
      }

      onPublished();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, [body, url, login, onPublished]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-xl bg-surface border border-border shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Publish announcement</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {!hasToken ? (
          <div className="p-4 space-y-3">
            <p className="text-sm text-muted">
              You need a GitHub token to publish. Enter it via the key icon at the top of the page — it's the same one used to scan repos faster.
            </p>
            <button onClick={onClose} className="w-full py-2 rounded-lg border border-border text-sm text-muted hover:text-foreground transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => { setBody(e.target.value); setError(null); }}
                placeholder="What did you just ship? Keep it short."
                rows={4}
                maxLength={BODY_MAX + 10}
                className="w-full bg-surface-alt border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
              />
              <span className={`absolute bottom-2 right-3 text-xs tabular-nums ${body.length > BODY_MAX ? "text-accent-red" : "text-muted"}`}>
                {body.length}/{BODY_MAX}
              </span>
            </div>

            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              placeholder="Link (optional) — https://github.com/you/project"
              className="w-full bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue/40 focus:border-accent-blue"
            />

            {error && (
              <p className="text-xs text-accent-red">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !body.trim() || body.length > BODY_MAX}
              className="w-full py-2 rounded-lg bg-accent-green text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Publishing…" : "Publish"}
            </button>

            {retryAfterSec === null && (
              <div className="pt-2 border-t border-border space-y-2">
                <p className="text-xs text-muted">Share your feed so followers can subscribe:</p>
                {[{ label: "RSS", url: rssUrl, key: "rss" as const }, { label: "JSON Feed", url: jsonUrl, key: "json" as const }].map(({ label, url: feedUrl, key }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-muted w-16 shrink-0">{label}</span>
                    <code className="flex-1 truncate text-xs bg-background rounded px-2 py-1 text-muted font-mono">{feedUrl}</code>
                    <button
                      onClick={() => copyUrl(key)}
                      className="shrink-0 text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground transition-colors"
                    >
                      {copied === key ? "Copied!" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
