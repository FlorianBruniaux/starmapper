// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Country name → ISO 3166-1 alpha-2 code
// Flag emoji is computed dynamically from the code — no static emoji map needed.
const COUNTRY_ISO: Record<string, string> = {
  "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Andorra": "AD",
  "Angola": "AO", "Argentina": "AR", "Armenia": "AM", "Australia": "AU",
  "Austria": "AT", "Azerbaijan": "AZ", "Bahrain": "BH", "Bangladesh": "BD",
  "Belarus": "BY", "Belgium": "BE", "Bolivia": "BO", "Bosnia And Herzegovina": "BA",
  "Brazil": "BR", "Bulgaria": "BG", "Cambodia": "KH", "Canada": "CA",
  "Chile": "CL", "China": "CN", "Colombia": "CO", "Costa Rica": "CR",
  "Croatia": "HR", "Cuba": "CU", "Cyprus": "CY", "Czechia": "CZ",
  "Czech Republic": "CZ", "Denmark": "DK", "Ecuador": "EC", "Egypt": "EG",
  "El Salvador": "SV", "Estonia": "EE", "Ethiopia": "ET", "Finland": "FI",
  "France": "FR", "Georgia": "GE", "Germany": "DE", "Ghana": "GH",
  "Greece": "GR", "Guatemala": "GT", "Honduras": "HN", "Hong Kong": "HK",
  "Hungary": "HU", "Iceland": "IS", "India": "IN", "Indonesia": "ID",
  "Iran": "IR", "Iraq": "IQ", "Ireland": "IE", "Israel": "IL",
  "Italy": "IT", "Jamaica": "JM", "Japan": "JP", "Jordan": "JO",
  "Kazakhstan": "KZ", "Kenya": "KE", "Kuwait": "KW", "Kyrgyzstan": "KG",
  "Latvia": "LV", "Lebanon": "LB", "Libya": "LY", "Lithuania": "LT",
  "Luxembourg": "LU", "Malaysia": "MY", "Malta": "MT", "Mexico": "MX",
  "Moldova": "MD", "Mongolia": "MN", "Montenegro": "ME", "Morocco": "MA",
  "Myanmar": "MM", "Nepal": "NP", "Netherlands": "NL", "New Zealand": "NZ",
  "Nicaragua": "NI", "Nigeria": "NG", "North Macedonia": "MK", "Norway": "NO",
  "Pakistan": "PK", "Panama": "PA", "Paraguay": "PY", "Peru": "PE",
  "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Puerto Rico": "PR",
  "Qatar": "QA", "Romania": "RO", "Russia": "RU", "Saudi Arabia": "SA",
  "Senegal": "SN", "Serbia": "RS", "Singapore": "SG", "Slovakia": "SK",
  "Slovenia": "SI", "South Africa": "ZA", "South Korea": "KR", "Spain": "ES",
  "Sri Lanka": "LK", "Sweden": "SE", "Switzerland": "CH", "Syria": "SY",
  "Taiwan": "TW", "Tajikistan": "TJ", "Tanzania": "TZ", "Thailand": "TH",
  "Tunisia": "TN", "Turkey": "TR", "Uganda": "UG", "Ukraine": "UA",
  "United Arab Emirates": "AE", "United Kingdom": "GB", "United States": "US",
  "Uruguay": "UY", "Uzbekistan": "UZ", "Venezuela": "VE", "Vietnam": "VN",
  "Yemen": "YE", "Zimbabwe": "ZW",
};

// Compute flag emoji from ISO 3166-1 alpha-2 code
// e.g. "US" → 🇺🇸, "FR" → 🇫🇷
const isoToFlagEmoji = (iso: string): string => {
  const offset = 0x1f1e6 - 65; // regional indicator A starts at 0x1F1E6
  return (
    String.fromCodePoint(iso.charCodeAt(0) + offset) +
    String.fromCodePoint(iso.charCodeAt(1) + offset)
  );
};

export const countryFlag = (name: string): string => {
  const iso = COUNTRY_ISO[name];
  return iso ? isoToFlagEmoji(iso) : "🌍";
};

// GitHub canonical language colors
export const LANGUAGE_COLOR: Record<string, string> = {
  "ActionScript":     "#882b0f",
  "Astro":            "#ff5a03",
  "Blade":            "#f7523f",
  "C":                "#555555",
  "C#":               "#178600",
  "C++":              "#f34b7d",
  "Clojure":          "#db5855",
  "CMake":            "#da3434",
  "CoffeeScript":     "#244776",
  "Crystal":          "#000100",
  "CSS":              "#563d7c",
  "Dart":             "#00b4ab",
  "Dockerfile":       "#384d54",
  "Elixir":           "#6e4a7e",
  "Elm":              "#60b5cc",
  "Erlang":           "#b83998",
  "F#":               "#b845fc",
  "Fortran":          "#4d41b1",
  "Go":               "#00add8",
  "Groovy":           "#4298b8",
  "Haskell":          "#5e5086",
  "HCL":              "#844fba",
  "HTML":             "#e34c26",
  "Java":             "#b07219",
  "JavaScript":       "#f1e05a",
  "Julia":            "#a270ba",
  "Jupyter Notebook": "#da5b0b",
  "Kotlin":           "#a97bff",
  "Lua":              "#000080",
  "Makefile":         "#427819",
  "Markdown":         "#083fa1",
  "MDX":              "#fcb32c",
  "Nix":              "#7e7eff",
  "Objective-C":      "#438eff",
  "OCaml":            "#3be133",
  "Perl":             "#0298c3",
  "PHP":              "#4f5d95",
  "PowerShell":       "#012456",
  "Python":           "#3572a5",
  "R":                "#198ce7",
  "Ruby":             "#701516",
  "Rust":             "#dea584",
  "Scala":            "#c22d40",
  "SCSS":             "#c6538c",
  "Shell":            "#89e051",
  "Svelte":           "#ff3e00",
  "Swift":            "#f05138",
  "TypeScript":       "#3178c6",
  "V":                "#5d87bf",
  "Verilog":          "#b2b7f8",
  "Vim Script":       "#199f4b",
  "Vue":              "#41b883",
  "WebAssembly":      "#04133b",
  "Zig":              "#ec915c",
};
