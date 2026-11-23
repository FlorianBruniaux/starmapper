// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const require = createRequire(import.meta.url);
const jsxA11y = require("eslint-plugin-jsx-a11y") as ESLint.Plugin;

describe("ESLint accessibility compatibility", () => {
  const linter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.tsx"],
      languageOptions: { parser: tseslint.parser },
      plugins: { "jsx-a11y": jsxA11y },
      rules: { "jsx-a11y/interactive-supports-focus": "error" },
    }],
  });

  it("still rejects a non-focusable interactive menu", async () => {
    const [result] = await linter.lintText('export const Menu = () => <div role="menu" onClick={() => {}} />;', { filePath: "src/compat-probe.tsx" });
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "jsx-a11y/interactive-supports-focus", severity: 2 }),
    ]));
  });

  it("accepts native navigation links", async () => {
    const [result] = await linter.lintText('export const Menu = () => <nav aria-label="Mobile navigation"><a href="/explore">Explore</a></nav>;', { filePath: "src/compat-probe.tsx" });
    expect(result.messages).toEqual([]);
  });
});
