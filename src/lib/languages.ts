// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Canonical language names as stored in github_user.languages[].
 * Slugs in URLs are lowercased; this map provides the canonical form for display and DB queries.
 *
 * e.g. URL /devs/typescript → slug "typescript" → canonical "TypeScript"
 *
 * Languages are sourced from real GitHub primaryLanguage values.
 * Keep sorted alphabetically for readability.
 */
export const LANGUAGE_SLUG_MAP: Record<string, string> = {
  "actionscript":    "ActionScript",
  "astro":           "Astro",
  "blade":           "Blade",
  "c":               "C",
  "c#":              "C#",
  "c++":             "C++",
  "clojure":         "Clojure",
  "cmake":           "CMake",
  "coffeescript":    "CoffeeScript",
  "crystal":         "Crystal",
  "css":             "CSS",
  "dart":            "Dart",
  "dockerfile":      "Dockerfile",
  "elixir":          "Elixir",
  "elm":             "Elm",
  "erlang":          "Erlang",
  "f#":              "F#",
  "fortran":         "Fortran",
  "go":              "Go",
  "groovy":          "Groovy",
  "haskell":         "Haskell",
  "hcl":             "HCL",
  "html":            "HTML",
  "java":            "Java",
  "javascript":      "JavaScript",
  "julia":           "Julia",
  "jupyter notebook": "Jupyter Notebook",
  "kotlin":          "Kotlin",
  "lua":             "Lua",
  "makefile":        "Makefile",
  "markdown":        "Markdown",
  "mdx":             "MDX",
  "nix":             "Nix",
  "objective-c":     "Objective-C",
  "ocaml":           "OCaml",
  "perl":            "Perl",
  "php":             "PHP",
  "powershell":      "PowerShell",
  "python":          "Python",
  "r":               "R",
  "ruby":            "Ruby",
  "rust":            "Rust",
  "scala":           "Scala",
  "scss":            "SCSS",
  "shell":           "Shell",
  "svelte":          "Svelte",
  "swift":           "Swift",
  "terraform":       "HCL",
  "tsx":             "TypeScript",
  "typescript":      "TypeScript",
  "v":               "V",
  "verilog":         "Verilog",
  "vim script":      "Vim Script",
  "vue":             "Vue",
  "webassembly":     "WebAssembly",
  "zig":             "Zig",
};

/**
 * Returns the canonical DB-stored language name from a URL slug,
 * or null if the slug is not recognized.
 *
 * slugToLanguage("typescript") → "TypeScript"
 * slugToLanguage("unknown") → null
 */
export const slugToLanguage = (slug: string): string | null =>
  LANGUAGE_SLUG_MAP[slug.toLowerCase()] ?? null;

/**
 * Returns a display-friendly language name from a canonical name.
 * Falls back to capitalizing the first letter.
 *
 * displayLanguage("TypeScript") → "TypeScript"
 * displayLanguage("javascript") → "Javascript"
 */
export const displayLanguage = (canonical: string): string => canonical;

/**
 * Converts a canonical language name to a URL slug.
 * Used for generating links to /devs/[slug].
 *
 * languageToSlug("TypeScript") → "typescript"
 * languageToSlug("C++") → "c++"
 */
export const languageToSlug = (canonical: string): string =>
  canonical.toLowerCase();
