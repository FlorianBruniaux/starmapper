"use client";

import type { StargazerPoint } from "@/app/api/chunk/route";
import type { TimeEstimate } from "@/lib/format";
import { formatEstimate, timeAgo } from "@/lib/format";

type RepoInfo = {
  name: string;
  description: string | null;
  stars: number;
  avatar: string | null;
};

type FindStatus = "idle" | "searching" | "found" | "no-location" | "not-found";

type ScanStatus = "idle" | "loading" | "waiting" | "done" | "cached" | "refreshing" | "error";

type UnmappedUser = {
  login: string;
  name: string | null;
  followers: number;
  starredAt: string | null;
};

type Props = {
  owner: string;
  repo: string;
  repoInfo: RepoInfo | null;
  compareOwner: string | null;
  compareRepo: string | null;
  compareInfo: RepoInfo | null;
  compareStatus: "idle" | "loading" | "done";
  comparePoints: StargazerPoint[];
  points: StargazerPoint[];
  total: number;
  unmapped: UnmappedUser[];
  setDrawerOpen: (v: boolean) => void;
  status: ScanStatus;
  pct: number;
  retryIn: number;
  processed: number;
  estimate: TimeEstimate | null;
  cachedAt: number | null;
  latestStarredAt: string | null;
  startRefresh: () => void;
  newStarsCount: number;
  handleStartScan: () => void;
  error: string | null;
  findInput: string;
  setFindInput: (v: string) => void;
  setFindStatus: (v: FindStatus) => void;
  findUser: () => void;
  findStatus: FindStatus;
};

export const TopPanel = ({
  owner, repo, repoInfo,
  compareOwner, compareRepo, compareInfo, compareStatus, comparePoints,
  points, total, unmapped, setDrawerOpen,
  status, pct, retryIn, processed, estimate,
  cachedAt, latestStarredAt, startRefresh, newStarsCount, handleStartScan,
  error,
  findInput, setFindInput, setFindStatus, findUser, findStatus,
}: Props) => {
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-overlay
      bg-background/90 border border-border rounded-xl
      px-5 py-3 text-center backdrop-blur-md shadow-2xl min-w-[320px]">

      <div className="flex items-center justify-center gap-2 mb-1">
        {repoInfo?.avatar && (
          <img src={repoInfo.avatar} alt="" className="w-5 h-5 rounded-full" />
        )}
        <a
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          className="text-foreground text-sm font-semibold hover:underline"
        >
          {owner}/{repo}
        </a>
      </div>

      {compareOwner && compareRepo && (
        <div className="mt-1 flex items-center justify-center gap-2 text-2xs">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-purple flex-shrink-0" />
          <span className="text-muted">
            vs <span className="text-accent-purple">{compareOwner}/{compareRepo}</span>
            {compareInfo && <span className="text-muted-subtle ml-1">({compareInfo.stars.toLocaleString()} ★)</span>}
            {compareStatus === "loading" && <span className="text-muted-subtle ml-1">· scanning…</span>}
            {compareStatus === "done" && <span className="text-muted-subtle ml-1">· {comparePoints.length} mapped</span>}
          </span>
        </div>
      )}

      <div className="flex gap-5 justify-center mt-2">
        {[
          { val: points.length.toLocaleString(), label: "mapped" },
          { val: total.toLocaleString() || "—", label: "total stars" },
          { val: new Set(points.map((p) => p.location?.split(",").pop()?.trim())).size.toString(), label: "locations" },
        ].map(({ val, label }) => (
          <div key={label} className="text-center">
            <div className="text-2xl font-bold text-foreground">{val}</div>
            <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">{label}</div>
          </div>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="text-center cursor-pointer hover:opacity-80 transition-opacity"
        >
          <div className="text-2xl font-bold text-muted">{unmapped.length.toLocaleString()}</div>
          <div className="text-2xs text-muted uppercase tracking-wide mt-0.5">no location</div>
        </button>
      </div>

      {/* Progress bar — during scan */}
      {(status === "loading" || status === "refreshing" || status === "waiting") && (
        <div className="mt-3">
          <div className="w-full bg-surface-alt rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-accent-blue h-full rounded-full transition-all duration-300"
              style={{ width: status === "refreshing" ? "100%" : `${pct}%` }}
            />
          </div>
          <div className="text-2xs text-muted mt-1">
            {status === "waiting"
              ? `⏸ Queued — resuming in ${retryIn}s…`
              : status === "refreshing"
              ? "↻ Fetching new stars…"
              : `Fetching ${processed.toLocaleString()} / ${total.toLocaleString()} — ${pct}%`
            }
            {estimate && status === "loading" && (
              <span className="ml-1 text-muted-subtle">· est. {formatEstimate(estimate)}</span>
            )}
          </div>
        </div>
      )}

      {/* Mapping ratio bar — after scan */}
      {(status === "cached" || status === "done") && total > 0 && points.length > 0 && (
        <div className="mt-2.5">
          <div className="w-full bg-surface-alt rounded-full h-1 overflow-hidden">
            <div
              className="bg-accent-blue h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.round((points.length / total) * 100)}%` }}
            />
          </div>
          <div className="text-2xs text-muted-subtle mt-0.5 text-center">
            {points.length.toLocaleString()} / {total.toLocaleString()} mapped ({Math.round((points.length / total) * 100)}%)
          </div>
        </div>
      )}

      {/* Cache status */}
      {(status === "cached" || status === "done") && cachedAt && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <span className="text-2xs text-accent-green">
            {status === "done" ? "✓ Indexed" : `✓ Cached ${timeAgo(cachedAt)}`}
          </span>
          {status === "cached" && latestStarredAt && (
            <button
              onClick={startRefresh}
              className="text-2xs text-accent-blue hover:underline flex items-center gap-1"
            >
              ↻ {newStarsCount > 0 ? `${newStarsCount} new stars` : "Refresh"}
            </button>
          )}
          <button
            onClick={handleStartScan}
            className="text-2xs text-muted hover:text-foreground hover:underline"
          >
            Full rescan
          </button>
        </div>
      )}

      {status === "error" && error && (
        <div className="mt-2 text-accent-red text-xs">{error}</div>
      )}

      {/* Find me */}
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input
            value={findInput}
            onChange={(e) => { setFindInput(e.target.value); setFindStatus("idle"); }}
            onKeyDown={(e) => { if (e.key === "Enter") findUser(); }}
            placeholder="GitHub username or URL…"
            className="flex-1 bg-surface-alt border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder-muted-subtle focus:outline-none focus:border-accent-blue"
          />
          <button
            onClick={findUser}
            disabled={findStatus === "searching"}
            className="bg-surface-alt border border-border rounded-md px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-border transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {findStatus === "searching" ? (
              <>
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Searching…
              </>
            ) : "Find"}
          </button>
        </div>
        {findStatus === "found" && (
          <p className="text-2xs text-accent-green">✓ Found — flying to location</p>
        )}
        {findStatus === "no-location" && (
          <p className="text-2xs text-accent-orange">Starred but has no location set on GitHub</p>
        )}
        {findStatus === "not-found" && (
          <p className="text-2xs text-accent-red">Not found in stargazers</p>
        )}
      </div>
    </div>
  );
};
