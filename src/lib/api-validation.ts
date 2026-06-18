// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Shared validation helpers for owner/repo/login path params and request bodies.
// Centralises the regex that was duplicated across 7 route files.

export const OWNER_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;
// Strict GitHub login format: starts and ends with alphanumeric, hyphens allowed in between.
// Matches the regex used by isValidLogin() in github-auth.ts.
export const LOGIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

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

/** Returns the login string as-is or null if invalid.
 *  GitHub logins: 1-39 chars, alphanumeric + hyphens, cannot start or end with a hyphen. */
export const validateLogin = (login: unknown): string | null =>
  typeof login === "string" && LOGIN_RE.test(login) ? login : null;
