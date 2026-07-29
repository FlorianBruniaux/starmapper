// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Lightweight session-storage utilities — kept separate from TokenModal so
// the UI component can be lazy-loaded without pulling these into the initial bundle.

const TOKEN_KEY = "gh_token";
const USERNAME_KEY = "gh_username";

// 15-day rolling TTL — reset on each active read
const TOKEN_TTL_MS = 15 * 24 * 60 * 60 * 1000;
// 90-day absolute ceiling — set once at write time, never renewed, so an
// actively-used token in a browser that's never closed still expires eventually
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

type StoredValue = { v: string; exp: number; absExp: number };

const readSession = (key: string): string => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    const parsed: StoredValue = JSON.parse(raw);
    if (parsed.exp < Date.now() || parsed.absExp < Date.now()) {
      localStorage.removeItem(key);
      return "";
    }
    // Rolling TTL: reset expiry on each active read, keep absExp fixed
    localStorage.setItem(
      key,
      JSON.stringify({ v: parsed.v, exp: Date.now() + TOKEN_TTL_MS, absExp: parsed.absExp }),
    );
    return parsed.v;
  } catch { return ""; }
};

const writeSession = (key: string, value: string) => {
  try {
    if (value) {
      const now = Date.now();
      localStorage.setItem(
        key,
        JSON.stringify({ v: value, exp: now + TOKEN_TTL_MS, absExp: now + ABSOLUTE_TTL_MS }),
      );
    } else {
      localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
};

export const getStoredToken = (): string => readSession(TOKEN_KEY);
export const setStoredToken = (token: string) => writeSession(TOKEN_KEY, token);
export const getStoredUsername = (): string => readSession(USERNAME_KEY);
export const setStoredUsername = (username: string) => writeSession(USERNAME_KEY, username);
