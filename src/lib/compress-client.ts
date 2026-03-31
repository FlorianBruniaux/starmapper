// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Client-side gzip + base64 codec (browser only — uses CompressionStream Web API).
// Available in all modern browsers (Chrome 80+, Firefox 113+, Safari 16.4+).
// NOT compatible with Node.js / server-side — use src/lib/compression.ts for server.

/**
 * Compresses an array to gzip+base64 to keep POST bodies under Vercel's 4.5MB limit.
 */
export const compressToBase64 = async (data: unknown[]): Promise<string> => {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }
  // Base64 in chunks to avoid stack overflow on large arrays
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < merged.length; i += CHUNK) {
    binary += String.fromCharCode(...merged.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};
