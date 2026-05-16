// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  Trophy,
  BookOpen,
  Server,
  Globe,
  Rss,
  X,
  Menu,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/logo";

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
  projectionButton?: React.ReactNode; // 2D/3D toggle, rendered between rightAccessory and token
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
  projectionButton,
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

  const resolvedMaxWidth = innerMaxWidth ?? "max-w-7xl";
  const px = "px-4";
  const widthCls = `${resolvedMaxWidth} mx-auto`;

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
          <Check size={11} aria-hidden="true" />
          Token set
        </>
      ) : (
        <>
          <Clock size={11} aria-hidden="true" />
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
        <Trophy size={13} aria-hidden="true" />
        Explore
      </Link>
      <Link
        href="/repos"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <BookOpen size={13} aria-hidden="true" />
        Repos
      </Link>
      <Link
        href="/devs"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <Server size={13} aria-hidden="true" />
        Dev Maps
      </Link>
      <Link
        href="/devs/atlas"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <Globe size={13} aria-hidden="true" />
        Atlas
      </Link>
      <Link
        href="/feeds"
        className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground border border-border hover:border-accent-blue px-3 py-1.5 rounded-lg transition-colors"
      >
        <Rss size={13} aria-hidden="true" />
        Feeds
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
              <ArrowLeft size={16} aria-hidden="true" />
            </Link>
          )}
          <LogoMark />
          <Link href="/" className="font-semibold text-sm text-foreground hover:text-accent-blue transition-colors shrink-0">
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
          {projectionButton}

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
                    <X size={16} aria-hidden="true" />
                  ) : (
                    <Menu size={16} aria-hidden="true" />
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
                          <Trophy size={13} aria-hidden="true" />
                          Explore
                        </Link>
                        <Link
                          href="/repos"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <BookOpen size={13} aria-hidden="true" />
                          Repos
                        </Link>
                        <Link
                          href="/devs"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <Server size={13} aria-hidden="true" />
                          Dev Maps
                        </Link>
                        <Link
                          href="/devs/atlas"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <Globe size={13} aria-hidden="true" />
                          Atlas
                        </Link>
                        <Link
                          href="/feeds"
                          className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
                        >
                          <Rss size={13} aria-hidden="true" />
                          Feeds
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
                              <Check size={13} aria-hidden="true" />
                              Token set
                            </>
                          ) : (
                            <>
                              <Clock size={13} aria-hidden="true" />
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
