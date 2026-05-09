// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { createHash } from "crypto";

/**
 * SHA-256 hex digest of an API key.
 *
 * Keys are UUIDs (128 bits entropy) — hashing prevents an attacker who
 * reads the DB from using extracted keys directly. The hash is deterministic
 * so existing keys can be migrated via `scripts/backfill-api-key-hash.ts`.
 */
export const hashApiKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");
