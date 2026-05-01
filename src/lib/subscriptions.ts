// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const KEY = "starmapper:subs";
const MAX = 100;

export type Subscription = { login: string; subscribedAt: number };

const read = (): Subscription[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Subscription =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Subscription).login === "string" &&
        typeof (s as Subscription).subscribedAt === "number",
    );
  } catch {
    return [];
  }
};

const write = (list: Subscription[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // QuotaExceededError or disabled (Safari private mode) — silent fail
  }
};

export const getSubscriptions = (): Subscription[] => read();

export const hasSubscription = (login: string): boolean => {
  const target = login.toLowerCase();
  return read().some((s) => s.login === target);
};

export const addSubscription = (login: string): Subscription[] => {
  const target = login.toLowerCase();
  const list = read().filter((s) => s.login !== target);
  const next = [{ login: target, subscribedAt: Date.now() }, ...list];
  write(next);
  return next;
};

export const removeSubscription = (login: string): Subscription[] => {
  const target = login.toLowerCase();
  const next = read().filter((s) => s.login !== target);
  write(next);
  return next;
};
