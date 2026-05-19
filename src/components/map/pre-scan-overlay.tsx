// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import NextImage from "next/image";
import { formatEstimate, timeAgo } from "@/lib/format";
import type { TimeEstimate } from "@/lib/format";
import type { ScanStatus } from "@/hooks/useScanController";

const TOKEN_REQUIRED_STARS = 50_000;

type RepoInfo = {
  name: string;
  description: string | null;
  avatar: string | null;
};

type Props = {
  status: ScanStatus;
  cacheCheckDone: boolean;
  repoInfo: RepoInfo;
  estimate: TimeEstimate;
  total: number;
  lastDbScan: string | null;
  hasToken: boolean;
  /**
   * Pre-resolved by page.tsx: either startScraping or handleStartScan
   * depending on repo size and token state. PreScanOverlay does not re-implement the logic.
   */
  onStart: () => void;
};

export const PreScanOverlay = ({
  status, cacheCheckDone, repoInfo, estimate,
  total, lastDbScan, hasToken, onStart,
}: Props) => {
  if (status !== "idle" || !cacheCheckDone || !estimate) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prescan-title"
        className="bg-surface border border-border rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          {repoInfo.avatar && (
            <NextImage src={repoInfo.avatar} alt="" width={40} height={40} sizes="40px" className="w-10 h-10 rounded-full" />
          )}
          <div>
            <h2 id="prescan-title" className="text-foreground font-semibold">{repoInfo.name}</h2>
            {repoInfo.description && (
              <div className="text-muted text-xs mt-0.5 line-clamp-1">{repoInfo.description}</div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <div className="flex-1 bg-background rounded-lg px-4 py-3 text-center">
            <div className="text-2xl font-bold text-foreground">{total.toLocaleString()}</div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">stars</div>
          </div>
          <div className="flex-1 bg-background rounded-lg px-4 py-3 text-center">
            <div className="text-2xl font-bold text-accent-blue">{formatEstimate(estimate)}</div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">estimated</div>
          </div>
        </div>

        {estimate.keepOpen && (
          <div className="flex items-start gap-2.5 bg-warning-subtle border border-accent-orange/30 rounded-lg px-4 py-3 mb-6">
            <span className="text-accent-orange mt-0.5 flex-shrink-0">⚠</span>
            <p className="text-accent-orange text-xs leading-relaxed">
              Keep this tab open during indexing. Closing it will restart from scratch.
              {estimate.unit === "h" && " Consider running this overnight."}
            </p>
          </div>
        )}

        {lastDbScan ? (
          <div className="flex items-center gap-2 bg-background border border-accent-green-emphasis/40 rounded-lg px-4 py-2.5 mb-6">
            <span className="text-accent-green text-xs">✓ Last scanned {timeAgo(new Date(lastDbScan).getTime())}</span>
            <span className="text-border text-xs">·</span>
            <span className="text-muted-subtle text-xs">Results shared with other users</span>
          </div>
        ) : (
          <p className="text-muted text-xs mb-6 leading-relaxed">
            Stargazers are geocoded via their GitHub location field.
            Results are cached and shared — subsequent visitors load instantly.
          </p>
        )}

        {total >= TOKEN_REQUIRED_STARS && !hasToken && (
          <div className="flex items-start gap-2.5 bg-accent-orange/10 border border-accent-orange/30 rounded-lg px-4 py-3 mb-6">
            <span className="text-accent-orange mt-0.5 flex-shrink-0 text-sm">⚠</span>
            <div>
              <p className="text-accent-orange text-xs font-medium mb-1">
                A GitHub token is required for repos over 50,000 stars
              </p>
              <p className="text-muted text-xs leading-relaxed mb-2.5">
                Without a token, GitHub limits requests to 60/hr — not enough to index this repo.
                A free token unlocks 5,000/hr. No special permissions needed.
              </p>
              <button type="button" onClick={onStart} className="text-xs text-accent-blue hover:underline font-medium">
                Add your GitHub token →
              </button>
            </div>
          </div>
        )}

        <button
          onClick={onStart}
          disabled={total >= TOKEN_REQUIRED_STARS && !hasToken}
          className={`w-full bg-accent-green-emphasis text-white font-medium py-3 rounded-lg transition-colors text-sm ${
            total >= TOKEN_REQUIRED_STARS && !hasToken ? "opacity-40 cursor-not-allowed" : "hover:opacity-90"
          }`}
        >
          {lastDbScan ? `Rescan ${total.toLocaleString()} stars →` : `Start indexing ${total.toLocaleString()} stars →`}
        </button>
      </div>
    </div>
  );
};
