/**
 * ISO 3166-1 country names (lowercase) + common aliases.
 * Used to filter raw GitHub location strings and identify real country names.
 */
const COUNTRY_SET = new Set([
  // A
  "afghanistan","albania","algeria","andorra","angola","antigua and barbuda",
  "argentina","armenia","australia","austria","azerbaijan",
  // B
  "bahamas","bahrain","bangladesh","barbados","belarus","belgium","belize",
  "benin","bhutan","bolivia","bosnia and herzegovina","botswana","brazil",
  "brunei","bulgaria","burkina faso","burundi",
  // C
  "cabo verde","cambodia","cameroon","canada","central african republic",
  "chad","chile","china","colombia","comoros","congo","costa rica","croatia",
  "cuba","cyprus","czechia","czech republic",
  // D
  "democratic republic of the congo","denmark","djibouti","dominica",
  "dominican republic",
  // E
  "ecuador","egypt","el salvador","equatorial guinea","eritrea","estonia",
  "eswatini","ethiopia",
  // F
  "fiji","finland","france",
  // G
  "gabon","gambia","georgia","germany","ghana","greece","grenada","guatemala",
  "guinea","guinea-bissau","guyana",
  // H
  "haiti","honduras","hungary",
  // I
  "iceland","india","indonesia","iran","iraq","ireland","israel","italy",
  "ivory coast","côte d'ivoire",
  // J
  "jamaica","japan","jordan",
  // K
  "kazakhstan","kenya","kiribati","kosovo","kuwait","kyrgyzstan",
  // L
  "laos","latvia","lebanon","lesotho","liberia","libya","liechtenstein",
  "lithuania","luxembourg",
  // M
  "madagascar","malawi","malaysia","maldives","mali","malta",
  "marshall islands","mauritania","mauritius","mexico","micronesia",
  "moldova","monaco","mongolia","montenegro","morocco","mozambique","myanmar",
  // N
  "namibia","nauru","nepal","netherlands","new zealand","nicaragua","niger",
  "nigeria","north korea","north macedonia","norway",
  // O
  "oman",
  // P
  "pakistan","palau","palestine","panama","papua new guinea","paraguay",
  "peru","philippines","poland","portugal",
  // Q
  "qatar",
  // R
  "romania","russia","rwanda",
  // S
  "saint kitts and nevis","saint lucia","saint vincent and the grenadines",
  "samoa","san marino","sao tome and principe","saudi arabia","senegal",
  "serbia","seychelles","sierra leone","singapore","slovakia","slovenia",
  "solomon islands","somalia","south africa","south korea","south sudan",
  "spain","sri lanka","sudan","suriname","sweden","switzerland","syria",
  // T
  "taiwan","tajikistan","tanzania","thailand","timor-leste","togo","tonga",
  "trinidad and tobago","tunisia","turkey","türkiye","turkmenistan","tuvalu",
  // U
  "uganda","ukraine","united arab emirates","united kingdom",
  "united states","united states of america","uruguay","uzbekistan",
  // V
  "vanuatu","venezuela","vietnam","viet nam",
  // Y
  "yemen",
  // Z
  "zambia","zimbabwe",

  // ── Common aliases / abbreviations ──────────────────────────────────────
  "usa","us","uk","uae","drc","england","scotland","wales","northern ireland",
  "hong kong","macau","macao","taiwan, china","republic of china",
  "republic of korea","south korea","north korea","dprk","rok",
  "russia","russian federation",
  "iran, islamic republic of","syrian arab republic","libyan arab jamahiriya",
  "bolivia, plurinational state of",
  "venezuela, bolivarian republic of",
  "tanzania, united republic of",
  "viet nam",
  "czech republic",
  "the netherlands","holland",
  "new zealand","nz",
  "brasil",  // common Portuguese misspelling counted
]);

const ALIAS_MAP: Record<string, string> = {
  "usa": "United States",
  "us": "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
  "nz": "New Zealand",
  "uae": "United Arab Emirates",
  "drc": "Democratic Republic of the Congo",
  "rok": "South Korea",
  "dprk": "North Korea",
  "russian federation": "Russia",
  "viet nam": "Vietnam",
  "türkiye": "Turkey",
  "czech republic": "Czechia",
  "côte d'ivoire": "Ivory Coast",
  "brasil": "Brazil",
  "hong kong": "Hong Kong",
  "taiwan": "Taiwan",
  "taiwan, china": "Taiwan",
  "republic of china": "Taiwan",
};

export const isCountry = (s: string): boolean => COUNTRY_SET.has(s.toLowerCase().trim());

export const normalizeCountry = (s: string): string => {
  const lower = s.toLowerCase().trim();
  if (ALIAS_MAP[lower]) return ALIAS_MAP[lower];
  // Title-case the raw value
  return s.trim().replace(/\b\w/g, (c) => c.toUpperCase());
};
