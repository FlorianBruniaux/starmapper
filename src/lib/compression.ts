// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// gzip + base64 codec shared between stargazer-cache and map-image routes.

import { gzipSync, gunzipSync } from "zlib";

/**
 * Encodes a value as gzip+base64. Use this instead of importing gzipSync directly.
 */
export const compressToGzBase64 = (value: unknown): string => {
  return gzipSync(JSON.stringify(value)).toString("base64");
};

/**
 * Decodes a gzip+base64 encoded string back to a typed array.
 */
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB guard against zip bombs

// Defense-in-depth: prevent prototype pollution from malformed cache entries.
const safeReviver = (key: string, value: unknown) =>
  key === "__proto__" || key === "constructor" || key === "prototype" ? undefined : value;

export const decompressGzBase64 = <T>(value: string): T[] => {
  const buf = gunzipSync(Buffer.from(value, "base64"));
  if (buf.byteLength > MAX_DECOMPRESSED_BYTES) {
    throw new Error(`Decompressed payload exceeds limit (${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB)`);
  }
  return JSON.parse(buf.toString("utf8"), safeReviver) as T[];
};
