// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Shared `pg.Pool` factory for one-shot scripts.
 *
 * Every script under scripts/ opens its own Pool (see scripts/lib/db.ts for the
 * PrismaClient equivalent). Without this helper, each of those pools connects with
 * whatever sslmode happens to be in the connection string — typically Neon's default
 * sslmode=require, which does not verify the server certificate. withVerifyFullSsl
 * rewrites that to sslmode=verify-full, closing the MITM gap.
 */

import pg from "pg";
import { withVerifyFullSsl } from "@/lib/pg-ssl";

export const createScriptPool = (
  connectionString: string,
  opts?: Omit<pg.PoolConfig, "connectionString">,
): pg.Pool => new pg.Pool({ connectionString: withVerifyFullSsl(connectionString), ...opts });
