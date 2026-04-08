// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

const LogoSvg = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-accent-blue flex-shrink-0">
    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
    <ellipse cx="10" cy="10" rx="4" ry="8" stroke="currentColor" strokeWidth="1.25"/>
    <line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.25"/>
    <path d="M3.5 6.5 Q10 5 16.5 6.5" stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M3.5 13.5 Q10 15 16.5 13.5" stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M10 5.5 L10.6 7.4 L12.6 7.4 L11.0 8.6 L11.6 10.5 L10 9.3 L8.4 10.5 L9.0 8.6 L7.4 7.4 L9.4 7.4 Z" fill="currentColor"/>
  </svg>
);

type Props = {
  sticky?: boolean;
  innerMaxWidth?: string;
  backLink?: string;
  afterLogo?: React.ReactNode;
  nav?: React.ReactNode;
  showNav?: boolean;      // renders Leaderboard + Developers links; use nav prop for custom content
  showToken?: boolean;
  hasToken?: boolean;
  onTokenClick?: () => void;
  rightAccessory?: React.ReactNode;  // rendered before ThemeToggle (e.g. "23 mapped" badge)
};

export const Header = ({
  sticky = false,
  innerMaxWidth,
  backLink,
  afterLogo,
  nav,
  showNav = false,
  showToken = false,
  hasToken = false,
  onTokenClick,
  rightAccessory,
}: Props) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close burger menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const positionCls = sticky
    ? "sticky top-0 bg-surface/80"
    : "fixed top-0 left-0 right-0 bg-background/80";

  const px = innerMaxWidth ? "px-4" : "px-6";
  const widthCls = innerMaxWidth ? `${innerMaxWidth} mx-auto` : "";

  const tokenButton = showToken && (
    <button
      onClick={onTokenClick}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
        hasToken
          ? "border-accent-green-emphasis text-accent-green hover:bg-accent-green-emphasis/10"
          : "border-border text-muted hover:text-foreground hover:border-accent-blue"
      }`}
    >
      {hasToken ? (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
          Token set
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z" />
          </svg>
          Add token
        </>
      )}
    </button>
  );

  const navLinks = showNav && (
    <>
      <Link
        href="/explore"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5V5a5 5 0 0 0 4.797 4.994A4.001 4.001 0 0 0 8 13.277V14H5.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5H8v-.723a4.001 4.001 0 0 0 2.203-3.283A5 5 0 0 0 15 5V3.5A1.5 1.5 0 0 0 13.5 2h-11Zm11 1.5V5a3.5 3.5 0 0 1-2.81 3.441A4.005 4.005 0 0 0 11 7V3.5h2.5Zm-10 0H5V7a4.005 4.005 0 0 0 .31 1.441A3.5 3.5 0 0 1 2.5 5V3.5Z" />
        </svg>
        Leaderboard
      </Link>
      <Link
        href="/devs"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M0 11.25c0-.966.784-1.75 1.75-1.75h12.5c.966 0 1.75.784 1.75 1.75v3A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm2-9.5C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 6.75Zm1.75-.25a.25.25 0 0 0-.25.25v5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5a.25.25 0 0 0-.25-.25Zm-2.25 9.75c0-.138.112-.25.25-.25h12.5a.25.25 0 0 1 .25.25v3a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25Z" />
        </svg>
        Developers
      </Link>
    </>
  );

  return (
    <header className={`${positionCls} z-20 border-b border-border-subtle backdrop-blur-sm`}>
      <div className={`${widthCls} ${px} h-14 flex items-center justify-between`}>

        {/* Left: back arrow + logo + afterLogo */}
        <div className="flex items-center gap-2 min-w-0">
          {backLink && (
            <Link href={backLink} className="text-muted hover:text-foreground transition-colors -ml-1 p-1 shrink-0">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.56 7.25h8.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 0 1 0 1.06Z" />
              </svg>
            </Link>
          )}
          <LogoSvg />
          <Link href="/" className="text-foreground font-semibold text-sm hover:text-accent-blue transition-colors shrink-0">
            StarMapper
          </Link>
          {afterLogo}
        </div>

        {/* Center: nav (desktop only) */}
        {(nav || showNav) && (
          <nav className="hidden md:flex items-center gap-2">
            {showNav ? navLinks : nav}
          </nav>
        )}

        {/* Right: rightAccessory + token (desktop) + theme + burger (mobile) */}
        <div className="flex items-center gap-2">
          {rightAccessory}

          {/* Desktop-only token + theme */}
          <div className="hidden md:flex items-center gap-2">
            {tokenButton}
            <ThemeToggle />
          </div>

          {/* Mobile: theme always visible + burger for nav/token */}
          <div className="flex md:hidden items-center gap-1">
            <ThemeToggle />
            {(nav || showNav || showToken) && (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  aria-label="Open menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                  className="p-2 text-muted hover:text-foreground transition-colors rounded-lg border border-transparent hover:border-border"
                >
                  {menuOpen ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z" />
                    </svg>
                  )}
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl border border-border bg-surface shadow-xl overflow-hidden py-1"
                    onClick={() => setMenuOpen(false)}
                  >
                    {showNav && (
                      <>
                        <Link
                          href="/explore"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5V5a5 5 0 0 0 4.797 4.994A4.001 4.001 0 0 0 8 13.277V14H5.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5H8v-.723a4.001 4.001 0 0 0 2.203-3.283A5 5 0 0 0 15 5V3.5A1.5 1.5 0 0 0 13.5 2h-11Zm11 1.5V5a3.5 3.5 0 0 1-2.81 3.441A4.005 4.005 0 0 0 11 7V3.5h2.5Zm-10 0H5V7a4.005 4.005 0 0 0 .31 1.441A3.5 3.5 0 0 1 2.5 5V3.5Z" />
                          </svg>
                          Leaderboard
                        </Link>
                        <Link
                          href="/devs"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M0 11.25c0-.966.784-1.75 1.75-1.75h12.5c.966 0 1.75.784 1.75 1.75v3A1.75 1.75 0 0 1 14.25 16H1.75A1.75 1.75 0 0 1 0 14.25Zm2-9.5C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 6.75Zm1.75-.25a.25.25 0 0 0-.25.25v5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5a.25.25 0 0 0-.25-.25Zm-2.25 9.75c0-.138.112-.25.25-.25h12.5a.25.25 0 0 1 .25.25v3a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25Z" />
                          </svg>
                          Developers
                        </Link>
                      </>
                    )}
                    {nav && (
                      <div className="px-4 py-2.5 text-sm text-muted">
                        {nav}
                      </div>
                    )}
                    {showToken && (
                      <>
                        {(showNav || nav) && <div className="my-1 border-t border-border-subtle" />}
                        <button
                          onClick={onTokenClick}
                          className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                            hasToken
                              ? "text-accent-green hover:bg-surface-alt"
                              : "text-muted hover:text-foreground hover:bg-surface-alt"
                          }`}
                        >
                          {hasToken ? (
                            <>
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                              </svg>
                              Token set
                            </>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z" />
                              </svg>
                              Add token
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
