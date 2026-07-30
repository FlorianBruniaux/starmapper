// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, AlertTriangle } from "lucide-react";
import { StargazerNoticeModal } from "@/components/stargazer-notice-modal";
import { STARGAZER_NOTICE_SHORT } from "@/lib/stargazer-notice";

// Bump this ID whenever you want the banner to reappear for users who dismissed it.
const BANNER_ID = "issue-stargazer-restriction-v2-vote";

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
        className="relative flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3
                   px-4 sm:px-10 py-2.5
                   bg-surface border-b border-border
                   border-t-2 border-t-accent-orange"
      >
        {/* Vote CTA: leads the banner, live and time-sensitive (LinkedIn traffic) */}
        <Link
          href="/roadmap"
          className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-foreground hover:text-accent-blue transition-colors"
        >
          <span className="font-semibold">Four ways forward. One of them is a real open question.</span>
          <span className="text-accent-blue underline underline-offset-2 hover:no-underline whitespace-nowrap">
            Vote on the roadmap
          </span>
        </Link>

        <span className="hidden sm:inline text-border-subtle select-none" aria-hidden="true">
          ·
        </span>

        {/* Issue notice: trails now, most repeat visitors already dismissed the v1 notice once */}
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

        <button
          onClick={dismiss}
          aria-label="Dismiss notice"
          className="absolute right-3 top-2 sm:top-1/2 sm:-translate-y-1/2 p-1.5 rounded
                     text-muted-subtle hover:text-foreground transition-colors"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </>
  );
};
