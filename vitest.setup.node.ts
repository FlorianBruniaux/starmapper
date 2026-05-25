// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Global mock for next/cache — cacheTag, cacheLife, revalidateTag throw
// "Invariant: static generation store missing" in a plain Node test environment.
// This no-op mock prevents all node-project tests from needing individual vi.mock("next/cache").

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  unstable_cache: vi.fn((fn: () => unknown) => fn),
}));
