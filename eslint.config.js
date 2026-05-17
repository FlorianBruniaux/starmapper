import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "prisma/generated/**",
      "next-env.d.ts",
      "scripts/**",
      ".claude/**",
      ".worktrees/**",
      "extension/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.test.tsx",
      "**/*.spec.tsx",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "@next/next": nextPlugin,
    },
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Downgrade new react-hooks rules that flag valid-but-not-ideal patterns.
      // These were introduced in react-hooks v5+ after the codebase was written.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      ...Object.fromEntries(
        Object.entries(jsxA11y.configs.recommended.rules).map(([key, value]) => {
          // Handle both string and array-form rule configs
          if (value === "error" || value === 2) return [key, "warn"];
          if (Array.isArray(value) && (value[0] === "error" || value[0] === 2))
            return [key, ["warn", ...value.slice(1)]];
          return [key, value];
        }),
      ),
      ...Object.fromEntries(
        Object.entries(nextPlugin.configs.recommended.rules).map(([key, value]) => {
          if (value === "error" || value === 2) return [key, "warn"];
          if (Array.isArray(value) && (value[0] === "error" || value[0] === 2))
            return [key, ["warn", ...value.slice(1)]];
          return [key, value];
        }),
      ),
      // Enforce type-only imports (consistent with StarMapper conventions)
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      // No any — StarMapper convention
      "@typescript-eslint/no-explicit-any": "error",
      // Unused vars — warn with _ prefix escape hatch
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Relax a few rules that conflict with StarMapper patterns
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
      // jsx-a11y: relax rules that conflict with custom components
      "jsx-a11y/label-has-associated-control": "off",
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
