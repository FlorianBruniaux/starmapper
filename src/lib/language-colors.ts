// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Language colors from github/linguist (github.com/github-linguist/linguist).
 * Keys must match canonical names in LANGUAGE_SLUG_MAP (src/lib/languages.ts).
 * Used for categorical choropleth rendering on /devs/atlas.
 */
export const LANGUAGE_COLORS: Record<string, string> = {
  "ActionScript":    "#882B0F",
  "Astro":           "#ff5a03",
  "Blade":           "#F7523F",
  "C":               "#555555",
  "C#":              "#178600",
  "C++":             "#f34b7d",
  "Clojure":         "#db5855",
  "CMake":           "#DA3434",
  "CoffeeScript":    "#244776",
  "Crystal":         "#000100",
  "CSS":             "#563d7c",
  "Dart":            "#00B4AB",
  "Dockerfile":      "#384d54",
  "Elixir":          "#6e4a7e",
  "Elm":             "#60B5CC",
  "Erlang":          "#B83998",
  "F#":              "#b845fc",
  "Fortran":         "#4d41b1",
  "Go":              "#00ADD8",
  "Groovy":          "#4298b8",
  "Haskell":         "#5e5086",
  "HCL":             "#844FBA",
  "HTML":            "#e34c26",
  "Java":            "#b07219",
  "JavaScript":      "#f1e05a",
  "Julia":           "#a270ba",
  "Jupyter Notebook": "#DA5B0B",
  "Kotlin":          "#A97BFF",
  "Lua":             "#000080",
  "Makefile":        "#427819",
  "Markdown":        "#083fa1",
  "MDX":             "#fcb32c",
  "Nix":             "#7e7eff",
  "Objective-C":     "#438eff",
  "OCaml":           "#3be133",
  "Perl":            "#0298c3",
  "PHP":             "#4F5D95",
  "PowerShell":      "#012456",
  "Python":          "#3572A5",
  "R":               "#198CE7",
  "Ruby":            "#701516",
  "Rust":            "#dea584",
  "Scala":           "#c22d40",
  "SCSS":            "#c6538c",
  "Shell":           "#89e051",
  "Svelte":          "#ff3e00",
  "Swift":           "#F05138",
  "TypeScript":      "#3178c6",
  "V":               "#5d87bf",
  "Verilog":         "#b2b7f8",
  "Vim Script":      "#199f4b",
  "Vue":             "#41b883",
  "WebAssembly":     "#04133b",
  "Zig":             "#ec915c",
};

/**
 * Fallback for any language not in LANGUAGE_COLORS.
 * Should never appear if LANGUAGE_COLORS covers all LANGUAGE_SLUG_MAP values.
 */
export const DEFAULT_LANG_COLOR = "#8b949e";

/**
 * Color for countries with <MIN_DEVS_PER_COUNTRY or no data at all.
 */
export const NO_DATA_COLOR = "rgba(139, 148, 158, 0.10)";

/** Returns the linguist color for a canonical language name, or the default fallback. */
export const langColor = (lang: string): string =>
  LANGUAGE_COLORS[lang] ?? DEFAULT_LANG_COLOR;
