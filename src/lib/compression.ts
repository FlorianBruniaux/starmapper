// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// gzip + base64 codec shared between stargazer-cache and map-image routes.

import { gunzipSync } from "zlib";

/**
 * Decodes a gzip+base64 encoded value back to a typed array.
 * Falls back to returning the value as-is if it is already a plain array (legacy rows).
 */
export const decompressGzBase64 = <T>(value: unknown): T[] => {
  if (typeof value === "string") {
    return JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8")) as T[];
  }
  return Array.isArray(value) ? (value as T[]) : [];
};
