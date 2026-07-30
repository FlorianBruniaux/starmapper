// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, X, AlertTriangle } from "lucide-react";
import { StargazerNoticeModal } from "@/components/stargazer-notice-modal";
import { STARGAZER_NOTICE_SHORT } from "@/lib/stargazer-notice";
import { STILL_WORKING_LINKS } from "@/lib/still-working-links";

// Bump this ID whenever you want the banner to reappear for users who dismissed it.
const BANNER_ID = "issue-stargazer-restriction-v2-vote";

const LINKS = STILL_WORKING_LINKS;

export const AnnouncementBanner = () => {
  const [visible, setVisible] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(`starmapper:banner:${BANNER_ID}`)) setVisible(false);
    } catch {
      // localStorage unavailable (private browsing, etc.)
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(`starmapper:banner:${BANNER_ID}`, "1");
    } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      {modalOpen && <StargazerNoticeModal onClose={() => setModalOpen(false)} />}
      <div
        role="region"
        aria-label="Service notice"
        className="relative flex items-center justify-center gap-4 px-10 py-2.5
                   bg-surface border-b border-border
                   border-t-2 border-t-accent-orange"
      >
        <span className="flex items-center gap-3 flex-wrap justify-center">
          {/* Issue notice — leads the banner, opens the explanatory modal */}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 text-sm text-foreground hover:text-accent-orange
                       transition-colors group/notice"
          >
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-bold
                             bg-accent-orange text-white tracking-wide uppercase">
              <AlertTriangle size={10} aria-hidden="true" />
              Issue
            </span>
            <span className="font-medium">{STARGAZER_NOTICE_SHORT}</span>
            <span className="text-accent-blue underline underline-offset-2 group-hover/notice:no-underline">
              Learn more
            </span>
          </button>

          <span className="hidden sm:inline text-border-subtle select-none" aria-hidden="true">
            ·
          </span>

          {/* Vote CTA — new, actionable content distinct from the restriction notice above */}
          <Link
            href="/roadmap"
            className="flex items-center gap-1.5 text-sm text-foreground hover:text-accent-blue transition-colors"
          >
            <span className="font-medium">Four ways forward. One of them is a real open question.</span>
            <span className="text-accent-blue underline underline-offset-2 hover:no-underline">
              Vote on the roadmap
            </span>
          </Link>

          <span className="hidden sm:inline text-border-subtle select-none" aria-hidden="true">
            ·
          </span>

          {/* Still-working features (different data sources, unaffected by the restriction) */}
          {LINKS.map((link, i) => {
            const cls =
              "text-sm text-muted hover:text-foreground transition-colors flex items-center gap-1";
            const inner = (
              <>
                {link.label}
                <ArrowRight size={12} aria-hidden="true" />
                {i < LINKS.length - 1 && (
                  <span className="ml-2 text-border-subtle select-none">·</span>
                )}
              </>
            );
            return (
              <Link key={link.href} href={link.href} className={cls}>
                {inner}
              </Link>
            );
          })}
        </span>

        <button
          onClick={dismiss}
          aria-label="Dismiss notice"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded
                     text-muted-subtle hover:text-foreground transition-colors"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </>
  );
};
