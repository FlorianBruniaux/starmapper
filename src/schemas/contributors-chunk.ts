// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

export const contributorsChunkSchema = z.object({
  owner: z
    .string({ error: "Invalid owner format" })
    .regex(OWNER_REPO_RE, "Invalid owner format")
    .refine((s) => !/^\.+$/.test(s), "Invalid owner format")
    .transform((s) => s.toLowerCase()),
  repo: z
    .string({ error: "Invalid repo format" })
    .regex(OWNER_REPO_RE, "Invalid repo format")
    .refine((s) => !/^\.+$/.test(s), "Invalid repo format")
    .transform((s) => s.toLowerCase()),
  page: z
    .number({ error: "Invalid page" })
    .int("Page must be integer")
    .min(1, "Page must be >= 1")
    .max(5, "Page must be <= 5"),
});

export type ContributorsChunkBody = z.infer<typeof contributorsChunkSchema>;
