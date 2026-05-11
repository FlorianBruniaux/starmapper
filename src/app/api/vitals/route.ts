// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextResponse } from "next/server";
import { defineRoute } from "@/lib/define-route";
import { vitalsSchema } from "@/schemas/vitals";

export const POST = defineRoute(
  vitalsSchema,
  async (_req, body) => {
    const navigationType = typeof body.navigationType === "string" ? body.navigationType : "navigate";
    console.log(
      JSON.stringify({
        type: "web_vital",
        name: body.name,
        value: body.value,
        rating: body.rating,
        delta: body.delta,
        navigationType,
        path: body.path,
        ts: new Date().toISOString(),
      }),
    );
    return NextResponse.json({ ok: true });
  },
  { jsonErrorCode: "invalid_body" },
);
