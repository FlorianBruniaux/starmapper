// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
const getRedis = (): Redis | null => {
  if (_redis) return _redis;
  try {
    _redis = Redis.fromEnv();
    return _redis;
  } catch {
    return null;
  }
};

export const normalizeLogin = (s: string) => s.trim().toLowerCase();

const LOGIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

export const isValidLogin = (s: string): boolean =>
  typeof s === "string" && s.length >= 1 && s.length <= 39 && LOGIN_RE.test(s);

/**
 * Verifies a GitHub PAT and returns the authenticated login, or null if invalid.
 * Caches the result in Upstash for 5 minutes (key = sha256 prefix of PAT).
 */
export const verifyPat = async (pat: string): Promise<string | null> => {
  if (!pat || pat.length < 10) return null;

  const cacheKey = `pat:${createHash("sha256").update(pat).digest("hex").slice(0, 32)}`;

  try {
    const cached = await getRedis()?.get<string>(cacheKey);
    if (cached) return cached;
  } catch {
    // Upstash unavailable — fall through to live check
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${pat}`,
        "User-Agent": "starmapper/1.0",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { login?: unknown };
    if (typeof data.login !== "string" || !data.login) return null;

    const login = normalizeLogin(data.login);

    try {
      await getRedis()?.set(cacheKey, login, { ex: 300 });
    } catch {
      // non-fatal
    }

    return login;
  } catch {
    return null;
  }
};
