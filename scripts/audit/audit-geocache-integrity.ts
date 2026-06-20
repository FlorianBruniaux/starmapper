// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
//
// Détecte les entrées geocache avec des coordonnées vraisemblablement incorrectes.
//
// Stratégie : pour chaque entrée avec des coordonnées valides, extrait les noms de pays
// reconnaissables dans la clé, puis vérifie si les coordonnées tombent dans les bornes
// attendues. Une entrée est "suspecte" si les coords ne correspondent à aucun pays détecté.
//
// Cas typique détecté : "france / paris" → coords Singapour (geocodeur trompé par le
// format "Pays / Ville" non standard).
//
// Local:   pnpm audit:geocache
// Prod:    pnpm audit:geocache:prod
//
// Options:
//   --fix          Supprime les entrées suspectes (re-géocodage au prochain scan)
//   --batch-size N Entrées par requête DB (défaut: 2000)
//   --out FILE     Chemin du rapport JSON (défaut: geocache-audit-report.json)

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import pg from "pg";

const { values } = parseArgs({
  options: {
    fix: { type: "boolean", default: false },
    "batch-size": { type: "string", default: "2000" },
    out: { type: "string", default: "geocache-audit-report.json" },
  },
  strict: true,
  args: process.argv.slice(2),
});

const FIX = values.fix;
const BATCH_SIZE = parseInt(values["batch-size"] ?? "2000", 10);
const OUT_FILE = values.out ?? "geocache-audit-report.json";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c statement_timeout=0",
});

// ---------------------------------------------------------------------------
// Country bounding boxes [minLat, maxLat, minLng, maxLng]
// ---------------------------------------------------------------------------
type CountryBounds = { name: string; bounds: [number, number, number, number] };

const COUNTRY_KEYWORDS: Record<string, CountryBounds> = {
  // Europe
  "france": { name: "France", bounds: [41.3, 51.1, -5.1, 9.6] },
  "germany": { name: "Germany", bounds: [47.3, 55.1, 5.9, 15.0] },
  "deutschland": { name: "Germany", bounds: [47.3, 55.1, 5.9, 15.0] },
  "uk": { name: "UK", bounds: [49.9, 60.9, -8.6, 1.8] },
  "united kingdom": { name: "UK", bounds: [49.9, 60.9, -8.6, 1.8] },
  "great britain": { name: "UK", bounds: [49.9, 60.9, -8.6, 1.8] },
  "england": { name: "England", bounds: [49.9, 55.9, -5.7, 1.8] },
  "scotland": { name: "Scotland", bounds: [54.6, 60.8, -7.6, -0.8] },
  "wales": { name: "Wales", bounds: [51.3, 53.4, -5.3, -2.7] },
  "ireland": { name: "Ireland", bounds: [51.4, 55.4, -10.5, -6.0] },
  "spain": { name: "Spain", bounds: [35.9, 43.8, -9.3, 4.3] },
  "espana": { name: "Spain", bounds: [35.9, 43.8, -9.3, 4.3] },
  "españa": { name: "Spain", bounds: [35.9, 43.8, -9.3, 4.3] },
  "italy": { name: "Italy", bounds: [36.6, 47.1, 6.6, 18.5] },
  "italia": { name: "Italy", bounds: [36.6, 47.1, 6.6, 18.5] },
  "netherlands": { name: "Netherlands", bounds: [50.8, 53.5, 3.4, 7.2] },
  "holland": { name: "Netherlands", bounds: [50.8, 53.5, 3.4, 7.2] },
  "belgium": { name: "Belgium", bounds: [49.5, 51.5, 2.5, 6.4] },
  "belgique": { name: "Belgium", bounds: [49.5, 51.5, 2.5, 6.4] },
  "belgie": { name: "Belgium", bounds: [49.5, 51.5, 2.5, 6.4] },
  "switzerland": { name: "Switzerland", bounds: [45.8, 47.8, 5.9, 10.5] },
  "suisse": { name: "Switzerland", bounds: [45.8, 47.8, 5.9, 10.5] },
  "schweiz": { name: "Switzerland", bounds: [45.8, 47.8, 5.9, 10.5] },
  "sweden": { name: "Sweden", bounds: [55.3, 69.1, 11.1, 24.2] },
  "sverige": { name: "Sweden", bounds: [55.3, 69.1, 11.1, 24.2] },
  "norway": { name: "Norway", bounds: [57.9, 71.2, 4.6, 31.1] },
  "norge": { name: "Norway", bounds: [57.9, 71.2, 4.6, 31.1] },
  "denmark": { name: "Denmark", bounds: [54.6, 57.8, 8.1, 15.2] },
  "finland": { name: "Finland", bounds: [59.8, 70.1, 20.5, 31.6] },
  "suomi": { name: "Finland", bounds: [59.8, 70.1, 20.5, 31.6] },
  "austria": { name: "Austria", bounds: [46.4, 49.0, 9.5, 17.2] },
  "österreich": { name: "Austria", bounds: [46.4, 49.0, 9.5, 17.2] },
  "osterreich": { name: "Austria", bounds: [46.4, 49.0, 9.5, 17.2] },
  "portugal": { name: "Portugal", bounds: [37.0, 42.2, -9.5, -6.2] },
  "greece": { name: "Greece", bounds: [34.8, 41.7, 19.4, 29.6] },
  "grece": { name: "Greece", bounds: [34.8, 41.7, 19.4, 29.6] },
  "grèce": { name: "Greece", bounds: [34.8, 41.7, 19.4, 29.6] },
  "romania": { name: "Romania", bounds: [43.6, 48.3, 20.3, 29.7] },
  "turkey": { name: "Turkey", bounds: [36.0, 42.1, 26.0, 44.8] },
  "turquie": { name: "Turkey", bounds: [36.0, 42.1, 26.0, 44.8] },
  "ukraine": { name: "Ukraine", bounds: [44.4, 52.4, 22.1, 40.2] },
  "poland": { name: "Poland", bounds: [49.0, 54.8, 14.1, 24.2] },
  "polska": { name: "Poland", bounds: [49.0, 54.8, 14.1, 24.2] },
  "russia": { name: "Russia", bounds: [41.2, 81.9, 19.6, 180.0] },
  "czech": { name: "Czech Republic", bounds: [48.6, 51.1, 12.1, 18.9] },
  "czechia": { name: "Czech Republic", bounds: [48.6, 51.1, 12.1, 18.9] },
  "hungary": { name: "Hungary", bounds: [45.7, 48.6, 16.1, 22.9] },
  "slovakia": { name: "Slovakia", bounds: [47.7, 49.6, 16.8, 22.6] },
  "bulgaria": { name: "Bulgaria", bounds: [41.2, 44.2, 22.4, 28.6] },
  "serbia": { name: "Serbia", bounds: [41.9, 46.2, 18.8, 23.0] },
  "croatia": { name: "Croatia", bounds: [42.4, 46.6, 13.5, 19.5] },
  "slovenia": { name: "Slovenia", bounds: [45.4, 46.9, 13.4, 16.6] },
  "lithuania": { name: "Lithuania", bounds: [53.9, 56.5, 21.0, 26.8] },
  "latvia": { name: "Latvia", bounds: [55.7, 57.9, 21.0, 28.2] },
  "estonia": { name: "Estonia", bounds: [57.5, 59.7, 21.8, 28.2] },
  "belarus": { name: "Belarus", bounds: [51.2, 56.2, 23.2, 32.8] },
  "moldova": { name: "Moldova", bounds: [45.5, 48.5, 26.6, 30.2] },
  // Americas
  "usa": { name: "USA", bounds: [24.5, 49.4, -125.0, -66.9] },
  "united states": { name: "USA", bounds: [24.5, 49.4, -125.0, -66.9] },
  "canada": { name: "Canada", bounds: [41.7, 83.1, -141.0, -52.6] },
  "brazil": { name: "Brazil", bounds: [-33.8, 5.3, -73.4, -28.8] },
  "brasil": { name: "Brazil", bounds: [-33.8, 5.3, -73.4, -28.8] },
  "mexico": { name: "Mexico", bounds: [14.5, 32.7, -117.1, -86.7] },
  "méxico": { name: "Mexico", bounds: [14.5, 32.7, -117.1, -86.7] },
  "argentina": { name: "Argentina", bounds: [-55.1, -21.8, -73.6, -53.6] },
  "colombia": { name: "Colombia", bounds: [-4.2, 12.5, -79.0, -66.9] },
  "chile": { name: "Chile", bounds: [-55.9, -17.5, -75.6, -66.4] },
  "peru": { name: "Peru", bounds: [-18.4, 0.0, -81.3, -68.7] },
  "perú": { name: "Peru", bounds: [-18.4, 0.0, -81.3, -68.7] },
  "venezuela": { name: "Venezuela", bounds: [0.7, 12.2, -73.4, -60.0] },
  "ecuador": { name: "Ecuador", bounds: [-5.1, 1.5, -81.1, -75.2] },
  "uruguay": { name: "Uruguay", bounds: [-34.9, -30.1, -58.4, -53.1] },
  "bolivia": { name: "Bolivia", bounds: [-22.9, -9.7, -69.6, -57.5] },
  "paraguay": { name: "Paraguay", bounds: [-27.6, -19.3, -62.6, -54.3] },
  "cuba": { name: "Cuba", bounds: [19.8, 23.2, -84.9, -74.1] },
  // Asia
  "india": { name: "India", bounds: [8.1, 37.1, 68.1, 97.4] },
  "china": { name: "China", bounds: [18.2, 53.6, 73.5, 134.8] },
  "japan": { name: "Japan", bounds: [24.4, 45.5, 122.9, 153.9] },
  "south korea": { name: "South Korea", bounds: [33.1, 38.6, 124.6, 129.6] },
  "taiwan": { name: "Taiwan", bounds: [21.9, 25.3, 119.5, 122.0] },
  "vietnam": { name: "Vietnam", bounds: [8.6, 23.4, 102.1, 109.5] },
  "philippines": { name: "Philippines", bounds: [5.0, 20.9, 116.9, 126.6] },
  "indonesia": { name: "Indonesia", bounds: [-11.0, 6.1, 95.0, 141.0] },
  "malaysia": { name: "Malaysia", bounds: [0.9, 7.4, 99.6, 119.3] },
  "singapore": { name: "Singapore", bounds: [1.0, 1.6, 103.5, 104.2] },
  "thailand": { name: "Thailand", bounds: [5.6, 20.5, 97.4, 105.6] },
  "bangladesh": { name: "Bangladesh", bounds: [20.7, 26.6, 88.0, 92.7] },
  "pakistan": { name: "Pakistan", bounds: [23.7, 37.1, 60.9, 77.8] },
  "iran": { name: "Iran", bounds: [25.1, 39.8, 44.0, 63.3] },
  "iraq": { name: "Iraq", bounds: [29.1, 37.4, 38.8, 48.6] },
  "israel": { name: "Israel", bounds: [29.5, 33.3, 34.3, 35.9] },
  "saudi arabia": { name: "Saudi Arabia", bounds: [16.4, 32.2, 34.6, 55.7] },
  "jordan": { name: "Jordan", bounds: [29.2, 33.4, 34.9, 39.3] },
  "lebanon": { name: "Lebanon", bounds: [33.1, 34.7, 35.1, 36.6] },
  "nepal": { name: "Nepal", bounds: [26.4, 30.4, 80.0, 88.2] },
  "sri lanka": { name: "Sri Lanka", bounds: [5.9, 9.8, 80.0, 81.9] },
  "hong kong": { name: "Hong Kong", bounds: [22.1, 22.6, 113.8, 114.5] },
  "myanmar": { name: "Myanmar", bounds: [9.6, 28.5, 92.2, 101.2] },
  "cambodia": { name: "Cambodia", bounds: [9.9, 14.7, 102.3, 107.6] },
  "uzbekistan": { name: "Uzbekistan", bounds: [37.2, 45.6, 56.0, 73.1] },
  "kazakhstan": { name: "Kazakhstan", bounds: [40.6, 55.4, 50.3, 87.3] },
  "armenia": { name: "Armenia", bounds: [38.8, 41.3, 43.4, 46.6] },
  "azerbaijan": { name: "Azerbaijan", bounds: [38.4, 41.9, 44.8, 51.0] },
  // Africa
  "south africa": { name: "South Africa", bounds: [-34.8, -22.1, 16.5, 32.9] },
  "nigeria": { name: "Nigeria", bounds: [4.2, 13.9, 2.7, 14.7] },
  "egypt": { name: "Egypt", bounds: [22.0, 31.7, 24.7, 37.1] },
  "kenya": { name: "Kenya", bounds: [-4.7, 5.0, 33.9, 41.9] },
  "ghana": { name: "Ghana", bounds: [4.7, 11.2, -3.3, 1.2] },
  "ethiopia": { name: "Ethiopia", bounds: [3.4, 14.9, 33.0, 48.0] },
  "tanzania": { name: "Tanzania", bounds: [-11.7, -1.0, 29.3, 40.5] },
  "uganda": { name: "Uganda", bounds: [-1.5, 4.2, 29.6, 35.0] },
  "cameroon": { name: "Cameroon", bounds: [1.7, 13.1, 8.5, 16.2] },
  "senegal": { name: "Senegal", bounds: [12.3, 16.7, -17.5, -11.4] },
  "sénégal": { name: "Senegal", bounds: [12.3, 16.7, -17.5, -11.4] },
  "morocco": { name: "Morocco", bounds: [27.7, 35.9, -13.2, -1.0] },
  "maroc": { name: "Morocco", bounds: [27.7, 35.9, -13.2, -1.0] },
  "algeria": { name: "Algeria", bounds: [18.9, 37.1, -8.7, 12.0] },
  "algérie": { name: "Algeria", bounds: [18.9, 37.1, -8.7, 12.0] },
  "algerie": { name: "Algeria", bounds: [18.9, 37.1, -8.7, 12.0] },
  "tunisie": { name: "Tunisia", bounds: [30.2, 37.4, 7.5, 11.6] },
  "tunisia": { name: "Tunisia", bounds: [30.2, 37.4, 7.5, 11.6] },
  "rwanda": { name: "Rwanda", bounds: [-2.8, -1.1, 28.9, 30.9] },
  "zimbabwe": { name: "Zimbabwe", bounds: [-22.4, -15.6, 25.2, 33.1] },
  // Oceania
  "australia": { name: "Australia", bounds: [-43.6, -10.7, 113.3, 153.6] },
  "new zealand": { name: "New Zealand", bounds: [-47.3, -34.4, 166.5, 178.6] },
};

// 1° ≈ 111km — absorbs geocoder imprecision near borders
const TOLERANCE_DEG = 1.0;

const isWithinBounds = (
  lat: number,
  lng: number,
  [minLat, maxLat, minLng, maxLng]: [number, number, number, number],
): boolean =>
  lat >= minLat - TOLERANCE_DEG &&
  lat <= maxLat + TOLERANCE_DEG &&
  lng >= minLng - TOLERANCE_DEG &&
  lng <= maxLng + TOLERANCE_DEG;

// Extract all country matches from a geocache key.
// Uses word-boundary-like regex so "usa" doesn't match "usage".
const detectCountries = (key: string): CountryBounds[] => {
  const results: CountryBounds[] = [];
  const seen = new Set<string>();
  for (const [keyword, country] of Object.entries(COUNTRY_KEYWORDS)) {
    if (seen.has(country.name)) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![a-záàâäéèêëîïôöùûü])${escaped}(?![a-záàâäéèêëîïôöùûü])`, "i");
    if (regex.test(key)) {
      results.push(country);
      seen.add(country.name);
    }
  }
  return results;
};

type SuspiciousEntry = {
  key: string;
  lat: number;
  lng: number;
  hasSlash: boolean;
  detectedCountries: string[];
  reason: string;
};

const main = async () => {
  console.log(`Geocache integrity audit — fix: ${FIX}, batchSize: ${BATCH_SIZE}`);
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);
  console.log();

  const suspicious: SuspiciousEntry[] = [];
  let offset = 0;
  let totalScanned = 0;
  let totalWithCountry = 0;

  while (true) {
    const { rows } = await pool.query<{ key: string; lat: number; lng: number }>(
      `SELECT key, lat::float, lng::float FROM geocache WHERE lat IS NOT NULL ORDER BY key LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );

    if (rows.length === 0) break;
    offset += rows.length;
    totalScanned += rows.length;

    for (const row of rows) {
      const detected = detectCountries(row.key);
      if (detected.length === 0) continue;

      totalWithCountry++;

      // OK if coords fall within ANY detected country's bounding box
      const matched = detected.find((c) => isWithinBounds(row.lat, row.lng, c.bounds));
      if (matched) continue;

      suspicious.push({
        key: row.key,
        lat: row.lat,
        lng: row.lng,
        hasSlash: row.key.includes("/"),
        detectedCountries: detected.map((c) => c.name),
        reason: `[${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}] outside bounds of: ${detected.map((c) => c.name).join(", ")}`,
      });
    }

    process.stdout.write(
      `\r  Scanned: ${totalScanned} | With country: ${totalWithCountry} | Suspicious: ${suspicious.length}`,
    );
  }

  console.log(`\n\n--- Results ---`);
  console.log(`  Total scanned:        ${totalScanned}`);
  console.log(`  With country keyword: ${totalWithCountry}`);
  console.log(`  Suspicious:           ${suspicious.length}`);
  console.log(`    → with slash:       ${suspicious.filter((e) => e.hasSlash).length}`);
  console.log(`    → without slash:    ${suspicious.filter((e) => !e.hasSlash).length}`);

  // Top countries affected
  const countryCount: Record<string, number> = {};
  for (const e of suspicious) {
    for (const c of e.detectedCountries) {
      countryCount[c] = (countryCount[c] ?? 0) + 1;
    }
  }
  const topCountries = Object.entries(countryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topCountries.length > 0) {
    console.log(`\n  Top affected countries:`);
    for (const [name, count] of topCountries) {
      console.log(`    ${name.padEnd(20)} ${count}`);
    }
  }

  // Sample output
  if (suspicious.length > 0) {
    console.log(`\n  Sample suspicious entries:`);
    suspicious.slice(0, 30).forEach((e) => {
      const slash = e.hasSlash ? " [/]" : "";
      console.log(`    "${e.key}"${slash}`);
      console.log(`      → ${e.reason}`);
    });
    if (suspicious.length > 30) {
      console.log(`    ... and ${suspicious.length - 30} more (see ${OUT_FILE})`);
    }
  }

  // Write JSON report
  const report = {
    scannedAt: new Date().toISOString(),
    totalScanned,
    totalWithCountry,
    totalSuspicious: suspicious.length,
    suspiciousWithSlash: suspicious.filter((e) => e.hasSlash).length,
    topAffectedCountries: Object.fromEntries(topCountries),
    entries: suspicious.sort((a, b) => a.key.localeCompare(b.key)),
  };
  await writeFile(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n  Full report: ${OUT_FILE}`);

  if (FIX && suspicious.length > 0) {
    console.log(`\n  Deleting ${suspicious.length} suspicious entries...`);
    const keys = suspicious.map((e) => e.key);
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 500) {
      const batch = keys.slice(i, i + 500);
      const result = await pool.query(`DELETE FROM geocache WHERE key = ANY($1::text[])`, [batch]);
      deleted += result.rowCount ?? 0;
      console.log(`    ${Math.min(i + 500, keys.length)}/${keys.length} processed`);
    }
    console.log(`  Deleted: ${deleted} entries. They will be re-geocoded on next scan.`);
  } else if (suspicious.length > 0) {
    console.log(`\n  Run with --fix to delete and trigger re-geocoding.`);
  }

  await pool.end();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
