// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { StargazerPoint } from "@/app/api/chunk/route";

export type LocalCache = {
  version: 1;
  points: StargazerPoint[];
  unmapped: { login: string; name: string | null; followers: number; starredAt: string | null }[];
  totalCount: number;
  scannedAt: number;
  latestStarredAt: string | null;
};

export const cacheKey = (owner: string, repo: string) => `starmapper:${owner}/${repo}`;

export const loadCache = (owner: string, repo: string): LocalCache | null => {
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo));
    if (!raw) return null;
    const cache = JSON.parse(raw) as LocalCache;
    return cache.version === 1 ? cache : null;
  } catch {
    return null;
  }
};

export const saveCache = (owner: string, repo: string, data: Omit<LocalCache, "version">) => {
  try {
    localStorage.setItem(cacheKey(owner, repo), JSON.stringify({ version: 1, ...data }));
  } catch {
    // localStorage quota exceeded or unavailable — non-fatal
  }
};

export const clearCache = (owner: string, repo: string) => {
  try {
    localStorage.removeItem(cacheKey(owner, repo));
  } catch {
    // localStorage unavailable — non-fatal
  }
};
