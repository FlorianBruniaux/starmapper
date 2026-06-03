// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useCallback, useRef, useState, startTransition } from "react";
import type { FollowerPoint, FollowersChunkResponse } from "@/app/api/followers-chunk/route";
import { getStoredToken, setStoredToken } from "@/lib/token";

export type UnmappedFollowerEntry = {
  login: string;
  name: string | null;
  followers: number;
  avatarUrl: string;
};

export type FollowersScanState = {
  points: FollowerPoint[];
  unmapped: UnmappedFollowerEntry[];
  processed: number;
};

export type FollowersScanAction =
  | { type: "reset" }
  | { type: "chunk"; points: FollowerPoint[]; unmapped: UnmappedFollowerEntry[] };

export const followersScanReducer = (
  state: FollowersScanState,
  action: FollowersScanAction,
): FollowersScanState => {
  switch (action.type) {
    case "reset":
      return { points: [], unmapped: [], processed: 0 };
    case "chunk":
      return {
        points: action.points,
        unmapped: action.unmapped,
        processed: action.points.length + action.unmapped.length,
      };
    default:
      return state;
  }
};

class RateLimitedError extends Error {
  resetAt: number;
  reason: "github" | "server";
  constructor(resetAt: number, reason: "github" | "server" = "server") {
    super("rate_limited");
    this.resetAt = resetAt;
    this.reason = reason;
  }
}

class TokenInvalidError extends Error {
  constructor() {
    super("token_invalid");
  }
}

export type FollowersScanStatus = "idle" | "loading" | "waiting" | "done" | "error";

type UseFollowersScanControllerOptions = {
  login: string;
  dispatch: React.Dispatch<FollowersScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setTokenOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHasToken: React.Dispatch<React.SetStateAction<boolean>>;
  ghHeaders: () => Record<string, string>;
};

export const useFollowersScanController = ({
  login,
  dispatch,
  setTotal,
  setTokenOpen,
  setHasToken,
  ghHeaders,
}: UseFollowersScanControllerOptions) => {
  const [status, setStatus] = useState<FollowersScanStatus>("idle");
  const [retryIn, setRetryIn] = useState(0);
  const [retryTotal, setRetryTotal] = useState(0);
  const [waitReason, setWaitReason] = useState<"github" | "server">("server");
  const [error, setError] = useState("");
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const runningRef = useRef(false);
  const pendingScanRef = useRef(false);

  const fetchNextChunk = useCallback(async (cursor: string | null) => {
    const res = await fetch("/api/followers-chunk", {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ login, cursor }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as { resetAt?: number };
      throw new RateLimitedError(body.resetAt ?? Date.now() + 60_000, body.resetAt ? "github" : "server");
    }
    if (res.status === 401) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (body.error === "github_token_invalid") throw new TokenInvalidError();
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as FollowersChunkResponse;
  }, [login, ghHeaders]);

  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    dispatch({ type: "reset" });
    setStatus("loading");
    let cursor: string | null = null;
    let allPoints: FollowerPoint[] = [];
    let allUnmapped: UnmappedFollowerEntry[] = [];

    try {
      while (true) {
        let chunk: FollowersChunkResponse;
        while (true) {
          try {
            chunk = await fetchNextChunk(cursor);
            break;
          } catch (e) {
            if (e instanceof RateLimitedError) {
              const secsLeft = Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000));
              setWaitReason(e.reason);
              setStatus("waiting");
              setRetryIn(secsLeft);
              setRetryTotal(secsLeft);
              await new Promise((r) => setTimeout(r, secsLeft * 1000));
              setStatus("loading");
            } else if (e instanceof TokenInvalidError) {
              setStoredToken("");
              setHasToken(false);
            } else {
              throw e;
            }
          }
        }

        if (chunk!.quotaRemaining !== null && chunk!.quotaRemaining !== undefined) {
          setQuotaRemaining(chunk!.quotaRemaining);
        }
        setTotal(chunk!.totalCount);
        allPoints = allPoints.concat(chunk!.points);
        allUnmapped = allUnmapped.concat(chunk!.unmapped);
        startTransition(() => {
          dispatch({ type: "chunk", points: allPoints, unmapped: allUnmapped });
        });
        if (!chunk!.nextCursor) break;
        cursor = chunk!.nextCursor;
      }

      setStatus("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStatus("error");
    } finally {
      runningRef.current = false;
    }
  }, [fetchNextChunk, dispatch, setTotal, setHasToken]);

  const handleStartScan = useCallback(() => {
    if (!getStoredToken()) {
      pendingScanRef.current = true;
      setTokenOpen(true);
      return;
    }
    startScraping();
  }, [startScraping, setTokenOpen]);

  const handleTokenClose = useCallback(() => {
    setTokenOpen(false);
    setHasToken(!!getStoredToken());
    if (pendingScanRef.current) {
      pendingScanRef.current = false;
      if (getStoredToken()) startScraping();
    }
  }, [startScraping, setTokenOpen, setHasToken]);

  return {
    status,
    retryIn,
    retryTotal,
    waitReason,
    error,
    quotaRemaining,
    startScraping,
    handleStartScan,
    handleTokenClose,
    runningRef,
  };
};
