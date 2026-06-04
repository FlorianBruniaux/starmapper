// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { OWNER_REPO_RE } from "@/lib/api-validation";

export const followersChunkSchema = z.object({
  login: z
    .string({ error: "Invalid login format" })
    .regex(OWNER_REPO_RE, "Invalid login format")
    .refine((s) => !/^\.+$/.test(s), "Invalid login format")
    .transform((s) => s.toLowerCase()),
  cursor: z
    .union([z.string({ error: "Invalid cursor" }).max(1000, "Invalid cursor"), z.null()])
    .optional(),
});

export type FollowersChunkBody = z.infer<typeof followersChunkSchema>;
