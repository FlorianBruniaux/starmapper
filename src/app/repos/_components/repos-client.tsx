// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useState } from "react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { RepoTable } from "@/components/repo-table";
import { TokenModal, getStoredToken } from "@/components/token-modal";
import { CommandSearch } from "@/components/command-search";
import type { MappedRepo } from "@/app/api/repos/route";

type Props = {
  initialRepos: MappedRepo[];
  initialTotal: number;
};

export const ReposClient = ({ initialRepos, initialTotal }: Props) => {
  const [tokenOpen, setTokenOpen] = useState(false);
  const [hasToken, setHasToken] = useState(() => !!getStoredToken());

  return (
    <>
      <CommandSearch repos={initialRepos} />
      {tokenOpen && (
        <TokenModal
          onClose={() => {
            setTokenOpen(false);
            setHasToken(!!getStoredToken());
          }}
        />
      )}
      <Header
        sticky
        showNav
        showToken
        hasToken={hasToken}
        onTokenClick={() => setTokenOpen(true)}
      />

      <main id="main" className="min-h-screen bg-background pt-14">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-10">
          <div className="flex items-end justify-between mb-5 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">All mapped repos</h1>
              <p className="text-sm text-muted mt-1">
                {initialTotal.toLocaleString()} repositories scanned by the community
              </p>
            </div>
          </div>

          {/* Search bar — triggers Cmd+K CommandSearch */}
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { metaKey: true, key: "k", bubbles: true }),
              )
            }
            className="w-full flex items-center gap-3 bg-surface border border-border rounded-lg px-4 py-2.5 mb-5 text-left hover:border-accent-blue/40 transition-colors group"
            aria-label="Search mapped repos"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
              className="shrink-0 text-muted-subtle group-hover:text-accent-blue transition-colors" aria-hidden="true">
              <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z" />
            </svg>
            <span className="flex-1 text-sm text-muted-subtle">
              Search {initialTotal.toLocaleString()} mapped repos...
            </span>
            <kbd className="hidden sm:block text-2xs text-muted-subtle bg-surface-alt border border-border rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>

          <RepoTable repos={initialRepos} />
        </div>
      </main>

      <Footer />
    </>
  );
};
