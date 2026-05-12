// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { z } from "zod";

const REPO_SLUG_RE = /^[a-zA-Z0-9._-]{1,100}\/[a-zA-Z0-9._-]{1,100}$/;
const LOGIN_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,37}[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

export const trackSchema = z
  .object({
    type: z.enum(["repo", "profile", "feed_rss"], { error: "invalid_params" }),
    slug: z.string({ error: "invalid_params" }),
  })
  .superRefine((data, ctx) => {
    const re = data.type === "repo" ? REPO_SLUG_RE : LOGIN_SLUG_RE;
    if (!re.test(data.slug)) {
      ctx.addIssue({ code: "custom", message: "invalid_params", path: ["slug"] });
    }
  });

export type TrackBody = z.infer<typeof trackSchema>;
