// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const ownerRepo = z
  .string({ error: "Invalid owner/repo format" })
  .regex(OWNER_REPO_RE, "Invalid owner/repo format")
  .transform((s) => s.toLowerCase());

export const chunkSchema = z.object({
  owner: ownerRepo,
  repo: ownerRepo,
  cursor: z.union([z.string({ error: "Invalid cursor" }).max(1000, "Invalid cursor"), z.null()]).optional(),
  since: z
    .string({ error: "Invalid since parameter" })
    .regex(ISO_8601_RE, "Invalid since parameter")
    .refine((s) => Number.isFinite(new Date(s).getTime()), { message: "Invalid since parameter" })
    .optional(),
});

export type ChunkBody = z.infer<typeof chunkSchema>;
