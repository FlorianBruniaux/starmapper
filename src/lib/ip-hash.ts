// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { createHmac } from "crypto";

// IP_HASH_SECRET: keys the HMAC used to dedupe public, unauthenticated votes by IP without
// storing raw IPs. Deliberately not a reuse of CACHE_SIGN_SECRET (github-auth.ts): that secret
// protects forgery-resistance of a Redis cache, this one protects confidentiality of a stored
// column, different threat models and rotation lifecycles. Unlike CACHE_SIGN_SECRET, "skip
// hashing when unset" is not an option here since ipHash is the table's primary key, so the
// fallback still hashes, just with a fixed dev-only key, loud in production only.
const IP_HASH_SECRET = process.env.IP_HASH_SECRET ?? "dev-insecure-ip-hash-secret-do-not-use-in-prod";

if (!process.env.IP_HASH_SECRET && process.env.NODE_ENV === "production") {
  console.warn(
    "[ip-hash] IP_HASH_SECRET not set in production, falling back to a predictable dev key",
  );
}

/**
 * Privacy-preserving, deterministic dedupe key for a client IP. `namespace` keeps hashes
 * unlinkable across features that might one day share this secret: two different namespaces
 * on the same ip/secret produce unrelated hashes.
 */
export const hashIp = (ip: string, namespace = "roadmap-vote"): string =>
  createHmac("sha256", IP_HASH_SECRET).update(`${namespace}:${ip}`).digest("base64url");
