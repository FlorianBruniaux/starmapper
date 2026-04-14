// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { NextRequest, NextResponse } from "next/server";

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

    // Structured log — visible in Vercel dashboard (Functions > Logs)
    console.log(
      JSON.stringify({
        type: "web_vital",
        name: body.name,
        value: body.value,
        rating: body.rating,
        delta: body.delta,
        navigationType: body.navigationType ?? "navigate",
        path: body.path,
        ts: new Date().toISOString(),
      }),
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
};
