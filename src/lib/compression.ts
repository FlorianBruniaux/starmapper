// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// gzip + base64 codec shared between stargazer-cache and map-image routes.

import { gunzipSync } from "zlib";

/**
 * Decodes a gzip+base64 encoded string back to a typed array.
 */
export const decompressGzBase64 = <T>(value: string): T[] => {
  return JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8")) as T[];
};
