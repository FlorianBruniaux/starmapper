// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

export const MAX_CACHEABLE_STARS = 500_000;

const ownerRepo = z
  .string({ error: "invalid_params" })
  .regex(OWNER_REPO_RE, "invalid_params")
  .transform((s) => s.toLowerCase());

export const stargazerCacheEnvelopeSchema = z.object({
  owner: ownerRepo,
  repo: ownerRepo,
  totalCount: z
    .number({ error: "invalid_params" })
    .int({ message: "invalid_params" })
    .nonnegative({ message: "invalid_params" })
    .max(MAX_CACHEABLE_STARS, { message: "invalid_params" }),
  ts: z.number({ error: "expired_request" }),
  latestStarredAt: z.string().optional(),
  pointsGz: z.string().optional(),
  unmappedGz: z.string().optional(),
  points: z.array(z.unknown()).optional(),
  unmapped: z.array(z.unknown()).optional(),
});

export type StargazerCacheEnvelope = z.infer<typeof stargazerCacheEnvelopeSchema>;
