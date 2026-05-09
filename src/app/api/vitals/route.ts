// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_METRICS = new Set(["FCP", "LCP", "CLS", "TTFB", "FID", "INP"]);
const ALLOWED_RATINGS = new Set(["good", "needs-improvement", "poor"]);

type VitalPayload = {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  id: string;
  navigationType?: string;
  path: string;
};

export const POST = async (req: NextRequest): Promise<NextResponse> => {
  try {
    const body = (await req.json()) as VitalPayload;

    if (typeof body.name !== "string" || !ALLOWED_METRICS.has(body.name)) {
      return NextResponse.json({ error: "invalid_metric" }, { status: 400 });
    }
    if (!Number.isFinite(body.value) || !Number.isFinite(body.delta)) {
      return NextResponse.json({ error: "invalid_value" }, { status: 400 });
    }
    if (typeof body.rating !== "string" || !ALLOWED_RATINGS.has(body.rating)) {
      return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
    }

    // Structured log — visible in Vercel dashboard (Functions > Logs)
    console.log(
      JSON.stringify({
        type: "web_vital",
        name: body.name,
        value: body.value,
        rating: body.rating,
        delta: body.delta,
        navigationType: typeof body.navigationType === "string" ? body.navigationType : "navigate",
        path: typeof body.path === "string" ? body.path.replace(/[\r\n\t]/g, " ").slice(0, 200) : "",
        ts: new Date().toISOString(),
      }),
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
};
