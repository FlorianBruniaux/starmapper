// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

const ownerRepo = z
  .string({ error: "invalid_params" })
  .regex(OWNER_REPO_RE, "invalid_params")
  .transform((s) => s.toLowerCase());

const boundedInt = (max: number) =>
  z
    .number({ error: "invalid_params" })
    .int({ message: "invalid_params" })
    .nonnegative({ message: "invalid_params" })
    .max(max, { message: "invalid_params" });

export const badgeUpdateSchema = z.object({
  owner: ownerRepo,
  repo: ownerRepo,
  mappedCount: boundedInt(10_000_000),
  countryCount: boundedInt(10_000),
  totalCount: boundedInt(10_000_000),
  language: z.string({ error: "invalid_params" }).nullable().optional(),
  forksCount: z.number({ error: "invalid_params" }).optional(),
  watchersCount: z.number({ error: "invalid_params" }).optional(),
});

export type BadgeUpdateBody = z.infer<typeof badgeUpdateSchema>;
