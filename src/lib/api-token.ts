// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * HMAC-SHA256 session token — Edge Runtime compatible (Web Crypto API).
 *
 * Token format:  {timestamp_ms}.{nonce_hex}.{hmac_hex}
 *
 * Security properties:
 *   - Only the server (holding SM_TOKEN_SECRET) can generate valid tokens.
 *   - An attacker who visits the site gets a valid cookie, but tokens expire in
 *     TOKEN_TTL_MS (2h). Extracting + reusing the cookie requires active session
 *     maintenance and is still rate-limited (30 req/min per IP).
 *   - Constant-time comparison prevents timing-based HMAC forgery.
 *   - When SM_TOKEN_SECRET is not set (local dev without env), validation is
 *     skipped — the app falls back to Referer check + rate limit only.
 */

export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
// __Host- requires Secure + Path=/ + no Domain attribute (all already true in production —
// see proxy.ts's cookies.set call) and additionally makes the cookie unforgeable via a
// sibling subdomain or a Domain-scoped cookie set by a compromised subdomain. Only applied
// in production: __Host- cookies are rejected outright by the browser over plain http://,
// which is how local dev runs, so this would otherwise break the session cookie locally.
export const COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-sm-token" : "sm-token";

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * Constant-time string comparison — prevents HMAC timing attacks.
 * Always iterates maxLen chars regardless of input lengths, so the loop
 * duration does not reveal which string is shorter.
 */
export const safeEqual = (a: string, b: string): boolean => {
  const maxLen = Math.max(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0 && a.length === b.length;
};

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

const hmacSign = async (payload: string, secret: string): Promise<string> => {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(sig);
};

/** Generate a signed session token. Call server-side only. */
export const generateToken = async (secret: string): Promise<string> => {
  const ts = Date.now();
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(8)).buffer as ArrayBuffer);
  const payload = `${ts}.${nonce}`;
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
};

/**
 * Verify a session token against one or more secrets.
 *
 * Accepting an array enables secret rotation: sign new tokens with the primary
 * secret only (generateToken), but keep verifying against the previous secret
 * too for the length of one TOKEN_TTL_MS window so cookies issued before a
 * rotation aren't rejected mid-flight. Two-deploy rotation: set
 * SM_TOKEN_SECRET_PREV to the old value, SM_TOKEN_SECRET to the new one,
 * deploy; once TOKEN_TTL_MS has elapsed, drop SM_TOKEN_SECRET_PREV.
 * Returns false if invalid, expired, or no secret provided.
 */
export const verifyToken = async (
  token: string | undefined,
  secret: string | readonly string[],
): Promise<boolean> => {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
  if (secrets.length === 0 || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > TOKEN_TTL_MS) return false;
  for (const s of secrets) {
    const expected = await hmacSign(`${ts}.${nonce}`, s);
    if (safeEqual(sig, expected)) return true;
  }
  return false;
};

/**
 * Reads SM_TOKEN_SECRET (primary, used for signing new tokens) and the
 * optional SM_TOKEN_SECRET_PREV (verification-only, for rotation) from env.
 * Returns them as an array suitable for verifyToken; empty when neither is set.
 */
export const getSmSecrets = (): string[] =>
  [process.env.SM_TOKEN_SECRET, process.env.SM_TOKEN_SECRET_PREV].filter(
    (s): s is string => Boolean(s),
  );
