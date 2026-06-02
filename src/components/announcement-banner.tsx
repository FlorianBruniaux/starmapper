// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";

// Bump this ID whenever you want the banner to reappear for users who dismissed it.
const BANNER_ID = "announce-chrome-ext-v1";

type LinkItem = { label: string; href: string; external?: boolean };

const LINKS: LinkItem[] = [
  { label: "Chrome Extension", href: "https://chromewebstore.google.com/detail/starmapper/ejpbdhlaohhngpfbjjfadokgnndnnmmh", external: true },
  { label: "Trending repos", href: "/trending" },
  { label: "vs Star History", href: "/vs/star-history" },
  { label: "Dev Maps", href: "/devs" },
  { label: "Language Atlas", href: "/devs/atlas" },
];

export const AnnouncementBanner = () => {
  const [visible, setVisible] = useState(true);

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
    <div
      role="region"
      aria-label="Announcement"
      className="relative flex items-center justify-center gap-4 px-10 py-2.5
                 bg-surface border-b border-border
                 border-t-2 border-t-accent-orange"
    >
      <span className="flex items-center gap-3 flex-wrap justify-center">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-white tracking-wide uppercase">
          New
        </span>
        {LINKS.map((link, i) => {
          const cls = "text-sm text-muted hover:text-foreground transition-colors flex items-center gap-1";
          const inner = (
            <>
              {link.label}
              <ArrowRight size={12} aria-hidden="true" />
              {i < LINKS.length - 1 && (
                <span className="ml-2 text-border-subtle select-none">·</span>
              )}
            </>
          );
          return link.external ? (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {inner}
            </a>
          ) : (
            <Link key={link.href} href={link.href} className={cls}>
              {inner}
            </Link>
          );
        })}
      </span>

      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded
                   text-muted-subtle hover:text-foreground transition-colors"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
};
