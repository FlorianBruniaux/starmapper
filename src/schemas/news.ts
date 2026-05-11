// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";

const BODY_MAX = 280;
const URL_RE = /^https:\/\/.+/;
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fc00:|fd|0\.0\.0\.0)/i;

const isPrivateUrl = (raw: string): boolean => {
  try {
    const { hostname } = new URL(raw);
    return PRIVATE_HOST_RE.test(hostname);
  } catch {
    return true;
  }
};

export const newsBodySchema = z
  .object({
    body: z.string({ error: "body_required" }),
    url: z.union([z.string(), z.null()]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.body.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "body_required", path: ["body"] });
      return;
    }
    if (data.body.length > BODY_MAX) {
      ctx.addIssue({ code: "custom", message: "body_too_long", path: ["body"] });
      return;
    }
    if (data.url !== undefined && data.url !== null) {
      if (!URL_RE.test(data.url) || isPrivateUrl(data.url)) {
        ctx.addIssue({ code: "custom", message: "url_invalid", path: ["url"] });
      }
    }
  });

export type NewsBody = z.infer<typeof newsBodySchema>;
