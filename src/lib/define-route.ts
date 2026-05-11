// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { NextRequest } from "next/server";
import type { z } from "zod";
import { jsonError } from "@/lib/api-helpers";

type RouteHandler<T> = (req: NextRequest, body: T) => Promise<Response>;

type Options = {
  jsonErrorCode?: string;
};

export const defineRoute =
  <T>(schema: z.ZodType<T>, handler: RouteHandler<T>, options: Options = {}) =>
  async (req: NextRequest): Promise<Response> => {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonError(options.jsonErrorCode ?? "invalid_json", 400);
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      const firstMessage = result.error.issues[0]?.message;
      const code = firstMessage && firstMessage.length > 0 ? firstMessage : "invalid_params";
      return jsonError(code, 400);
    }
    return handler(req, result.data);
  };
