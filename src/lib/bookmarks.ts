// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

const KEY = "starmapper:recent";
export type Bookmark = { owner: string; repo: string; stars: number; visitedAt: number };

export const getBookmarks = (): Bookmark[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
};

export const saveBookmark = (owner: string, repo: string, stars: number) => {
  try {
    const list = getBookmarks().filter((b) => !(b.owner === owner && b.repo === repo));
    localStorage.setItem(KEY, JSON.stringify([{ owner, repo, stars, visitedAt: Date.now() }, ...list].slice(0, 8)));
  } catch {}
};
