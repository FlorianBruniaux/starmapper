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
export const COOKIE_NAME = "sm-token";

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Constant-time string comparison — prevents HMAC timing attacks. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

/** Verify a session token. Returns false if invalid, expired, or secret missing. */
export const verifyToken = async (token: string | undefined, secret: string): Promise<boolean> => {
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > TOKEN_TTL_MS) return false;
  const expected = await hmacSign(`${ts}.${nonce}`, secret);
  return safeEqual(sig, expected);
};
