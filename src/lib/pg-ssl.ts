// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// pg-connection-string (used internally by `pg`) treats sslmode=prefer/require/verify-ca as
// aliases for verify-full and emits a deprecation warning on every connect — removed in
// pg-connection-string v3 / pg v9, where those modes adopt weaker libpq semantics instead.
// Neon connection strings default to sslmode=require. Rewriting to sslmode=verify-full keeps
// today's behavior (full certificate validation) explicit and silences the warning, without
// touching how DATABASE_URL itself is issued or consumed elsewhere (db.ts, Prisma adapter).
const ALIASED_SSL_MODES = new Set(["prefer", "require", "verify-ca"]);

export const withVerifyFullSsl = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode && ALIASED_SSL_MODES.has(sslmode)) {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    // Not a parseable URL: hand it back untouched and let pg produce the real error.
    return connectionString;
  }
};
