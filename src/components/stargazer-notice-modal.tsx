// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ExternalLink, X } from "lucide-react";
import {
  STARGAZER_NOTICE_HEADLINE,
  STARGAZER_NOTICE_BODY,
  STARGAZER_NOTICE_LINKS,
} from "@/lib/stargazer-notice";

type Props = { onClose: () => void };

/**
 * Explains the GitHub stargazer-access restriction. Reused by the landing form and the
 * repo page. Copy lives in src/lib/stargazer-notice.ts.
 */
export const StargazerNoticeModal = ({ onClose }: Props) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stargazer-notice-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl
                   bg-surface border border-border shadow-2xl
                   border-t-2 border-t-accent-orange"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 p-1.5 rounded text-muted-subtle
                     hover:text-foreground transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>

        <div className="p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full
                             bg-accent-orange/15">
              <AlertTriangle size={16} className="text-accent-orange" aria-hidden="true" />
            </span>
            <h2 id="stargazer-notice-title" className="text-lg font-bold text-foreground">
              {STARGAZER_NOTICE_HEADLINE}
            </h2>
          </div>

          <div className="flex flex-col gap-3">
            {STARGAZER_NOTICE_BODY.map((para) => (
              <p key={para.slice(0, 24)} className="text-sm text-muted leading-relaxed">
                {para}
              </p>
            ))}
          </div>

          <Link
            href="/roadmap"
            onClick={onClose}
            className="flex items-center justify-between gap-2 p-3 rounded-lg border border-accent-blue/30
                       bg-accent-blue/5 hover:bg-accent-blue/10 transition-colors group"
          >
            <span className="text-sm font-medium text-foreground group-hover:text-accent-blue transition-colors">
              Vote on the roadmap: four ways forward
            </span>
            <ArrowRight size={14} className="shrink-0 text-accent-blue" aria-hidden="true" />
          </Link>

          <div className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-semibold text-muted-subtle uppercase tracking-wide">
              Official sources
            </p>
            {STARGAZER_NOTICE_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-blue hover:underline flex items-center gap-1.5"
              >
                {link.label}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
