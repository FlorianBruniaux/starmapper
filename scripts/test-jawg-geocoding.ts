// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

// Quick smoke test for the starmapper.jawg.io geocoding instance
// Run: sh -c 'set -a && . .env.local && set +a && tsx scripts/test-jawg-geocoding.ts'

const JAWG_URL = "https://starmapper.jawg.io/places/v1/search";

const TEST_LOCATIONS = [
  "Paris",
  "Paris, France",
  "New York",
  "Tokyo",
  "São Paulo",
  "Berlin, Germany",
  "London, UK",
  "notarealplace12345xyz",
];

const geocodeOne = async (location: string): Promise<string> => {
  const apiKey = process.env.JAWG_TOKEN_HEADER;
  if (!apiKey) throw new Error("JAWG_TOKEN_HEADER not set in .env.local");

  const url = `${JAWG_URL}?text=${encodeURIComponent(location)}&size=1`;
  const res = await fetch(url, { headers: { "x-api-key": apiKey } });

  if (!res.ok) return `HTTP ${res.status} ${res.statusText}`;

  const data = await res.json();
  if (data.features?.length > 0) {
    const [lng, lat] = data.features[0].geometry.coordinates as [number, number];
    const label = data.features[0].properties?.label ?? "";
    return `✓ ${lat.toFixed(4)}, ${lng.toFixed(4)}  (${label})`;
  }
  return "— not found";
};

const run = async () => {
  console.log(`\nTesting: ${JAWG_URL}\n${"─".repeat(60)}`);

  for (const loc of TEST_LOCATIONS) {
    const result = await geocodeOne(loc);
    console.log(`${loc.padEnd(25)} → ${result}`);
  }

  console.log("\nDone.");
};

run().catch(console.error);
