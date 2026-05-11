// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";

const ALLOWED_METRICS = ["FCP", "LCP", "CLS", "TTFB", "FID", "INP"] as const;
const ALLOWED_RATINGS = ["good", "needs-improvement", "poor"] as const;

export const vitalsSchema = z.object({
  name: z.enum(ALLOWED_METRICS, { error: "invalid_metric" }),
  value: z.number({ error: "invalid_value" }).refine(Number.isFinite, { message: "invalid_value" }),
  delta: z.number({ error: "invalid_value" }).refine(Number.isFinite, { message: "invalid_value" }),
  rating: z.enum(ALLOWED_RATINGS, { error: "invalid_rating" }),
  id: z.string({ error: "invalid_metric" }),
  navigationType: z.union([z.string(), z.null()]).optional(),
  path: z
    .string({ error: "invalid_metric" })
    .transform((p) => p.replace(/[\r\n\t]/g, " ").slice(0, 200)),
});

export type VitalsBody = z.infer<typeof vitalsSchema>;
