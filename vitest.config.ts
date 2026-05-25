// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const alias = {
  "@": path.resolve(__dirname, "./src"),
  // Force react and react-dom to resolve from the same node_modules path,
  // preventing the "Incompatible React versions" error from pnpm's deduped installs.
  "react": path.resolve(__dirname, "node_modules/react"),
  "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
  "react-dom/client": path.resolve(__dirname, "node_modules/react-dom/client"),
};

const WORKTREE_EXCLUDE = ["**/.claude/worktrees/**", "**/.worktrees/**", "**/node_modules/**"];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Exclude git worktrees from both possible locations
    exclude: WORKTREE_EXCLUDE,
    // Coverage is configured at top level — applies across both projects
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/components/**/*.tsx",
        "src/hooks/**/*.ts",
      ],
      exclude: [
        "src/lib/db.ts",        // Prisma singleton — tested via mocks
        "src/lib/theme.ts",     // Browser-only (localStorage)
        "src/lib/bookmarks.ts", // Browser-only (localStorage)
        "src/lib/token.ts",     // Browser-only (sessionStorage)
        "**/__tests__/**",
      ],
      thresholds: {
        // Node project (lib + API) keeps original thresholds.
        // Component project is new — lower thresholds prevent day-1 CI block.
        // These apply globally; individual project control requires separate config files.
        lines: 30,
        functions: 30,
        branches: 30,
      },
    },
    projects: [
      // ── Project 1: lib + API routes (Node environment) ──────────────────────
      {
        test: {
          name: "node",
          environment: "node",
          globals: true,
          // MANDATORY: geocoder.ts has module-level circuit breaker state.
          // Process isolation prevents one test file poisoning the next.
          pool: "forks",
          include: ["src/lib/**/*.test.ts", "src/app/api/**/*.test.ts"],
          exclude: WORKTREE_EXCLUDE,
          setupFiles: ["./vitest.setup.node.ts"],
        },
        resolve: { alias },
      },
      // ── Project 2: React components (jsdom environment) ─────────────────────
      {
        plugins: [react()],
        test: {
          name: "components",
          environment: "jsdom",
          globals: true,
          include: [
            "src/components/**/*.test.tsx",
            // App-level component tests (excludes api/ subfolder via negative pattern)
            "src/app/**/!(api)/**/*.test.tsx",
            "src/hooks/**/*.test.ts",
            "src/hooks/**/*.test.tsx",
          ],
          exclude: WORKTREE_EXCLUDE,
          setupFiles: ["./vitest.setup.ts"],
        },
        resolve: { alias },
      },
    ],
  },
});
