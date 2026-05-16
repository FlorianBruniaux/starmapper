// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Run tests in parallel within a file, sequentially across files
    // to avoid module-level state collisions (circuit breakers in geocoder.ts)
    pool: "forks",
    // Exclude git worktrees from both possible locations
    exclude: ["**/.claude/worktrees/**", "**/.worktrees/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: [
        "src/lib/db.ts",        // Prisma singleton — tested via mocks
        "src/lib/theme.ts",     // Browser-only (localStorage)
        "src/lib/bookmarks.ts", // Browser-only (localStorage)
        "**/__tests__/**",
      ],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
