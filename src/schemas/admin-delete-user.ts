// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";

const LOGIN_RE = /^[a-z0-9._-]{1,100}$/;

export const adminDeleteUserSchema = z.object({
  login: z
    .string({ error: "invalid_login" })
    .trim()
    .toLowerCase()
    .regex(LOGIN_RE, "invalid_login"),
  notes: z.string().max(500).optional(),
});

export type AdminDeleteUserBody = z.infer<typeof adminDeleteUserSchema>;
