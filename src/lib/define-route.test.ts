// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/define-route";

const makeReq = (body: unknown, opts?: { rawBody?: string }): NextRequest =>
  new NextRequest("http://localhost/api/test", {
    method: "POST",
    body: opts?.rawBody ?? JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("defineRoute", () => {
  const schema = z.object({
    name: z.string({ error: "missing_name" }),
    count: z.number().int().nonnegative({ error: "invalid_count" }),
  });

  it("dispatches to handler with parsed body on success", async () => {
    const handler = defineRoute(schema, async (_req, body) =>
      Response.json({ ok: true, body }),
    );
    const res = await handler(makeReq({ name: "x", count: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, body: { name: "x", count: 1 } });
  });

  it("returns 400 invalid_json when body is not parseable JSON", async () => {
    const handler = defineRoute(schema, async () => Response.json({}));
    const res = await handler(makeReq(null, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("honours jsonErrorCode option for the JSON parse branch", async () => {
    const handler = defineRoute(
      schema,
      async () => Response.json({}),
      { jsonErrorCode: "invalid_body" },
    );
    const res = await handler(makeReq(null, { rawBody: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("returns 400 with first issue message as code on schema failure", async () => {
    const handler = defineRoute(schema, async () => Response.json({}));
    const res = await handler(makeReq({ count: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_name");
  });

  it("falls back to invalid_params when no issue message is set", async () => {
    const bareSchema = z.object({ a: z.string() });
    const handler = defineRoute(bareSchema, async () => Response.json({}));
    const res = await handler(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
