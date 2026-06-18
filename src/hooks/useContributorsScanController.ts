// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { useCallback, useRef, useState, startTransition } from "react";
import type { ContributorPoint, ContributorsChunkResponse } from "@/app/api/contributors-chunk/route";
import { getStoredToken, setStoredToken } from "@/lib/token";

export type ContributorsScanState = {
  points: ContributorPoint[];
  unmapped: { login: string; contributions: number }[];
  processed: number;
};

export type ContributorsScanAction =
  | { type: "reset" }
  | { type: "chunk"; points: ContributorPoint[]; unmapped: { login: string; contributions: number }[] };

export const contributorsScanReducer = (
  state: ContributorsScanState,
  action: ContributorsScanAction,
): ContributorsScanState => {
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
  constructor() { super("token_invalid"); }
}

export type ContributorsScanStatus = "idle" | "computing" | "loading" | "waiting" | "done" | "error";

type UseContributorsScanControllerOptions = {
  owner: string;
  repo: string;
  dispatch: React.Dispatch<ContributorsScanAction>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setTokenOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHasToken: React.Dispatch<React.SetStateAction<boolean>>;
  ghHeaders: () => Record<string, string>;
};

export const useContributorsScanController = ({
  owner,
  repo,
  dispatch,
  setTotal,
  setTokenOpen,
  setHasToken,
  ghHeaders,
}: UseContributorsScanControllerOptions) => {
  const [status, setStatus] = useState<ContributorsScanStatus>("idle");
  const [retryIn, setRetryIn] = useState(0);
  const [retryTotal, setRetryTotal] = useState(0);
  const [waitReason, setWaitReason] = useState<"github" | "server">("server");
  const [error, setError] = useState("");
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const runningRef = useRef(false);
  const pendingScanRef = useRef(false);

  const fetchPage = useCallback(async (page: number) => {
    const res = await fetch("/api/contributors-chunk", {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ owner, repo, page }),
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
    return (await res.json()) as ContributorsChunkResponse;
  }, [owner, repo, ghHeaders]);

  const startScraping = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    dispatch({ type: "reset" });
    setStatus("loading");

    let page = 1;
    let allPoints: ContributorPoint[] = [];
    let allUnmapped: { login: string; contributions: number }[] = [];

    try {
      while (true) {
        let chunk: ContributorsChunkResponse;
        while (true) {
          try {
            chunk = await fetchPage(page);
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
              throw e;
            } else {
              throw e;
            }
          }
        }

        // GitHub is still computing contributor stats — retry once after a short delay
        if (chunk!.computing) {
          setStatus("computing");
          await new Promise((r) => setTimeout(r, 5_000));
          setStatus("loading");
          continue;
        }

        if (chunk!.quotaRemaining !== null && chunk!.quotaRemaining !== undefined) {
          setQuotaRemaining(chunk!.quotaRemaining);
        }
        setTotal(chunk!.totalCount + allPoints.length + allUnmapped.length);
        allPoints = allPoints.concat(chunk!.points);
        allUnmapped = allUnmapped.concat(chunk!.unmapped);
        startTransition(() => {
          dispatch({ type: "chunk", points: allPoints, unmapped: allUnmapped });
        });

        if (chunk!.nextPage === null) break;
        page = chunk!.nextPage;
      }

      setTotal(allPoints.length + allUnmapped.length);
      setStatus("done");
    } catch (e: unknown) {
      if (e instanceof TokenInvalidError) {
        setTokenOpen(true);
        setStatus("idle");
      } else {
        setError(e instanceof Error ? e.message : "Unknown error");
        setStatus("error");
      }
    } finally {
      runningRef.current = false;
    }
  }, [fetchPage, dispatch, setTotal, setTokenOpen]);

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
