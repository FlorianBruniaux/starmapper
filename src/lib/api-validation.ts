// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shared validation helpers for owner/repo/login path params and request bodies.
// Centralises the regex that was duplicated across 7 route files.

export const OWNER_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;
export const LOGIN_RE = /^[a-zA-Z0-9_-]{1,39}$/;

/** Returns normalised `{ owner, repo }` or `null` if either value is invalid. */
export const validateOwnerRepo = (
  owner: unknown,
  repo: unknown,
): { owner: string; repo: string } | null => {
  if (typeof owner !== "string" || !OWNER_REPO_RE.test(owner)) return null;
  if (typeof repo !== "string" || !OWNER_REPO_RE.test(repo)) return null;
  // Reject dot-only segments (".", "..") — path traversal latent risk even though
  // currently inert (Prisma finds no rows, GitHub normalises the URL to a 404).
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() };
};

/** Normalises an already-validated owner/repo pair (path params are always strings). */
export const normalizeOwnerRepo = (owner: string, repo: string) => ({
  owner: owner.toLowerCase(),
  repo: repo.toLowerCase(),
});
