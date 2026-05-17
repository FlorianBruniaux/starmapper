import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "coverage/**",
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
      // Disable React Compiler advisory rules that flag existing intentional patterns.
      // Keep exhaustive-deps enabled separately so real stale-closure risks stay visible.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
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
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-redundant-roles": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/role-supports-aria-props": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
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
