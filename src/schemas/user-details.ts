// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";
import { LOGIN_RE } from "@/lib/api-validation";

export const userDetailsSchema = z.object({
  logins: z
    .array(z.string().max(40).regex(LOGIN_RE, "invalid_login"))
    .min(1, "Missing logins")
    .max(200, "Max 200 users per request"),
});

export type UserDetailsBody = z.infer<typeof userDetailsSchema>;
