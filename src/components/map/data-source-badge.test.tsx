// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataSourceBadge } from "@/components/map/data-source-badge";

describe("DataSourceBadge", () => {
  it("labels reconstructed data honestly, not as a full scan", () => {
    render(<DataSourceBadge source="reconstructed" />);
    expect(screen.getByText(/reconstructed/i)).toBeInTheDocument();
  });

  it("labels engaged-community data with its own copy", () => {
    render(<DataSourceBadge source="engaged" />);
    expect(screen.getByText(/engaged community/i)).toBeInTheDocument();
  });
});
