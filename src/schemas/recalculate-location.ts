// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { LOGIN_RE } from "@/lib/api-validation";

export const recalculateLocationSchema = z.object({
  login: z
    .string({ error: "missing_login" })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "missing_login" })
    .refine((s) => LOGIN_RE.test(s), { message: "invalid_login" }),
});

export type RecalculateLocationBody = z.infer<typeof recalculateLocationSchema>;
