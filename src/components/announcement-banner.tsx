// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// Bump this ID whenever you want the banner to reappear for users who dismissed it.
const BANNER_ID = "announce-changelog-v1";

type LinkItem = { label: string; href: string };

const LINKS: LinkItem[] = [
  { label: "Stargazer Intelligence", href: "/explore" },
  { label: "Dev Profiles", href: "/profile/karpathy" },
  { label: "Language Atlas", href: "/devs/atlas" },
  { label: "Dev Maps", href: "/devs" },
  { label: "Changelog", href: "/changelog" },
];

export const AnnouncementBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(`starmapper:banner:${BANNER_ID}`)) setVisible(true);
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
      role="banner"
      className="relative flex items-center justify-center gap-4 px-10 py-2.5
                 bg-surface border-b border-border
                 border-t-2 border-t-accent-orange"
    >
      <span className="flex items-center gap-3 flex-wrap justify-center">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold
                         bg-accent-orange text-white tracking-wide uppercase">
          New
        </span>
        {LINKS.map((link, i) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm text-muted hover:text-foreground transition-colors flex items-center gap-1"
          >
            {link.label}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4"/>
            </svg>
            {i < LINKS.length - 1 && (
              <span className="ml-2 text-border-subtle select-none">·</span>
            )}
          </Link>
        ))}
      </span>

      <button
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded
                   text-muted-subtle hover:text-foreground transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2 2l12 12M14 2L2 14"/>
        </svg>
      </button>
    </div>
  );
};
