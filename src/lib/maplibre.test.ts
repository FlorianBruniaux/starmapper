// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, expect, it } from "vitest";
import { getWorkerUrl } from "./maplibre";

describe("MapLibre worker setup", () => {
  it("configures the dedicated module worker instead of relying on bundle URL inference", () => {
    expect(getWorkerUrl()).toMatch(/\/maplibre-gl-worker(?:[.-][\w-]+)?\.mjs(?:\?|$)/);
  });
});
