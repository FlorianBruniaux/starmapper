/**
 * seed-geocache-geonames.ts
 *
 * Pre-warms the geocache with GeoNames data (cities15000 + countryInfo).
 * Reduces API calls to Jawg/Geoapify/Nominatim for common location strings.
 *
 * Usage:
 *   npx tsx scripts/seed-geocache-geonames.ts --dry-run   # preview only
 *   npx tsx scripts/seed-geocache-geonames.ts             # insert into DB
 *
 * Sources:
 *   ~/Downloads/cities15000.txt   (GeoNames cities with pop > 15k)
 *   ~/Downloads/countryInfo.txt   (GeoNames country metadata)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

// Load .env.local (consistent with db:push / db:studio scripts in package.json)
const loadEnvLocal = () => {
  try {
    const envPath = join(process.cwd(), ".env.local");
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local not found — rely on environment
  }
};

loadEnvLocal();

const CITIES_FILE = join(process.env.HOME ?? "", "Downloads", "cities15000.txt");
const COUNTRIES_FILE = join(process.env.HOME ?? "", "Downloads", "countryInfo.txt");
const DRY_RUN = process.argv.includes("--dry-run");
const INSERT_BATCH_SIZE = 1000;
const KEY_LOOKUP_BATCH_SIZE = 5000;

// ---

type GeoEntry = { key: string; lat: number; lng: number };

const normalize = (s: string) => s.trim().toLowerCase();

// ---

const parseCountryInfo = (
  filePath: string
): Map<string, { name: string; iso3: string; capital: string }> => {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const result = new Map<string, { name: string; iso3: string; capital: string }>();

  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue;
    const cols = line.split("\t");
    const iso2 = cols[0]?.trim();
    const iso3 = cols[1]?.trim() ?? "";
    const countryName = cols[4]?.trim();
    const capital = cols[5]?.trim();
    if (iso2 && countryName) {
      result.set(iso2, { name: countryName, iso3, capital: capital ?? "" });
    }
  }

  return result;
};

type CityRow = {
  name: string;
  asciiname: string;
  lat: number;
  lng: number;
  countryCode: string;
  population: number;
};

const parseCities = (filePath: string): CityRow[] => {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const result: CityRow[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");

    const name = cols[1]?.trim() ?? "";
    const asciiname = cols[2]?.trim() ?? "";
    const lat = parseFloat(cols[4] ?? "");
    const lng = parseFloat(cols[5] ?? "");
    const countryCode = cols[8]?.trim() ?? "";
    const population = parseInt(cols[14] ?? "0", 10);

    // Filter invalid coords
    if (
      isNaN(lat) ||
      isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      (lat === 0 && lng === 0)
    ) {
      continue;
    }

    result.push({ name, asciiname, lat, lng, countryCode, population });
  }

  // Sort by population desc (biggest cities win on key conflict)
  result.sort((a, b) => b.population - a.population);

  return result;
};

const buildCityEntries = (cities: CityRow[]): Map<string, GeoEntry> => {
  const entries = new Map<string, GeoEntry>();

  for (const city of cities) {
    const nameKey = normalize(city.name);
    const asciiKey = normalize(city.asciiname);

    // name key — only set if not already present (biggest city wins)
    if (nameKey && !entries.has(nameKey)) {
      entries.set(nameKey, { key: nameKey, lat: city.lat, lng: city.lng });
    }

    // asciiname key — only if different from name
    if (asciiKey && asciiKey !== nameKey && !entries.has(asciiKey)) {
      entries.set(asciiKey, { key: asciiKey, lat: city.lat, lng: city.lng });
    }
  }

  return entries;
};

const buildCountryEntries = (
  countries: Map<string, { name: string; iso3: string; capital: string }>,
  cities: CityRow[]
): { entries: Map<string, GeoEntry>; isoEntries: Map<string, GeoEntry>; skipped: string[] } => {
  const entries = new Map<string, GeoEntry>();
  const isoEntries = new Map<string, GeoEntry>();
  const skipped: string[] = [];

  for (const [iso2, { name, iso3, capital }] of countries) {
    // Find capital city in cities15000 (match by name/asciiname + country_code)
    const capitalNorm = normalize(capital);
    const capitalCity = cities.find(
      (c) =>
        c.countryCode === iso2 &&
        (normalize(c.name) === capitalNorm || normalize(c.asciiname) === capitalNorm)
    );

    if (!capitalCity) {
      skipped.push(`${iso2} — ${name} (capital: ${capital})`);
      continue;
    }

    const coords = { lat: capitalCity.lat, lng: capitalCity.lng };

    // Country name key
    const nameKey = normalize(name);
    if (nameKey && !entries.has(nameKey)) {
      entries.set(nameKey, { key: nameKey, ...coords });
    }

    // ISO2 key (lowercase, 2-letter)
    const iso2Key = normalize(iso2);
    if (iso2Key && !isoEntries.has(iso2Key)) {
      isoEntries.set(iso2Key, { key: iso2Key, ...coords });
    }

    // ISO3 key (lowercase, 3-letter)
    const iso3Key = normalize(iso3);
    if (iso3Key && iso3Key !== iso2Key && !isoEntries.has(iso3Key)) {
      isoEntries.set(iso3Key, { key: iso3Key, ...coords });
    }
  }

  return { entries, isoEntries, skipped };
};

// ---

const createPrisma = () => {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};

const filterExistingKeys = async (
  prisma: PrismaClient,
  keys: string[]
): Promise<Set<string>> => {
  const existing = new Set<string>();

  for (let i = 0; i < keys.length; i += KEY_LOOKUP_BATCH_SIZE) {
    const batch = keys.slice(i, i + KEY_LOOKUP_BATCH_SIZE);
    const rows = await prisma.geoCache.findMany({
      where: { key: { in: batch } },
      select: { key: true },
    });
    for (const row of rows) existing.add(row.key);
    process.stdout.write(
      `\r  Checking existing keys: ${Math.min(i + KEY_LOOKUP_BATCH_SIZE, keys.length)}/${keys.length}...`
    );
  }

  console.log();
  return existing;
};

const insertBatches = async (
  prisma: PrismaClient,
  entries: GeoEntry[]
): Promise<number> => {
  let totalInserted = 0;
  const totalBatches = Math.ceil(entries.length / INSERT_BATCH_SIZE);

  for (let i = 0; i < entries.length; i += INSERT_BATCH_SIZE) {
    const batch = entries.slice(i, i + INSERT_BATCH_SIZE);
    const batchNum = Math.floor(i / INSERT_BATCH_SIZE) + 1;

    const result = await prisma.geoCache.createMany({
      data: batch,
      skipDuplicates: true,
    });

    totalInserted += result.count;
    process.stdout.write(
      `\r  Batch ${batchNum}/${totalBatches} — ${totalInserted} inserted so far...`
    );
  }

  console.log();
  return totalInserted;
};

// ---

const main = async () => {
  console.log(`\n=== StarMapper Geocache Seeder (GeoNames) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "INSERT"}\n`);

  // Parse
  console.log("Parsing countryInfo.txt...");
  const countries = parseCountryInfo(COUNTRIES_FILE);
  console.log(`  ${countries.size} countries loaded`);

  console.log("Parsing cities15000.txt...");
  const cities = parseCities(CITIES_FILE);
  console.log(`  ${cities.length} cities loaded (sorted by population)`);

  // Build entries
  console.log("\nGenerating cache keys...");
  const cityEntries = buildCityEntries(cities);
  const { entries: countryEntries, isoEntries, skipped: skippedCountries } = buildCountryEntries(
    countries,
    cities
  );

  console.log(`  Cities: ${cityEntries.size} keys`);
  console.log(`  Countries (name): ${countryEntries.size} keys`);
  console.log(`  Countries (ISO2+ISO3): ${isoEntries.size} keys`);
  if (skippedCountries.length > 0) {
    console.log(`  Skipped ${skippedCountries.length} countries (capital not in cities15000):`);
    for (const s of skippedCountries) console.log(`    - ${s}`);
  }

  // Merge priority: cities > country names > ISO codes
  const allEntries = new Map<string, GeoEntry>([...isoEntries, ...countryEntries, ...cityEntries]);
  console.log(`  Total unique keys: ${allEntries.size}`);

  // Dry-run: write preview file
  if (DRY_RUN) {
    const previewPath = join(process.cwd(), "scripts", "geocache-preview.json");
    const preview: Record<string, [number, number]> = {};
    for (const [key, entry] of allEntries) {
      preview[key] = [entry.lat, entry.lng];
    }

    // Spot checks
    const checks = ["paris", "london", "tokyo", "sao paulo", "são paulo", "france", "germany", "india", "us", "fr", "de", "usa", "fra", "deu"];
    console.log("\nSpot checks:");
    for (const check of checks) {
      const entry = allEntries.get(check);
      console.log(
        `  "${check}": ${entry ? `[${entry.lat}, ${entry.lng}]` : "NOT FOUND"}`
      );
    }

    writeFileSync(previewPath, JSON.stringify(preview, null, 2));
    console.log(`\nDry-run complete. Preview written to: scripts/geocache-preview.json`);
    console.log(`Total keys: ${allEntries.size}`);
    return;
  }

  // Connect to DB
  const prisma = createPrisma();
  const allKeys = [...allEntries.keys()];

  try {
    // Count before
    const countBefore = await prisma.geoCache.count();
    console.log(`\nDB: geocache has ${countBefore} entries before seeding`);

    // Filter existing keys
    console.log("Checking existing keys in DB...");
    const existingKeys = await filterExistingKeys(prisma, allKeys);
    console.log(`  ${existingKeys.size} keys already in cache, skipping`);

    const newEntries = allKeys
      .filter((k) => !existingKeys.has(k))
      .map((k) => allEntries.get(k)!);

    console.log(`  ${newEntries.length} new keys to insert`);

    if (newEntries.length === 0) {
      console.log("\nNothing to insert. Cache is already up to date.");
      return;
    }

    // Insert
    console.log("\nInserting...");
    const inserted = await insertBatches(prisma, newEntries);

    // Count after
    const countAfter = await prisma.geoCache.count();
    console.log(`\n=== Done ===`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Geocache before: ${countBefore}`);
    console.log(`  Geocache after:  ${countAfter}`);
    console.log(`  Delta: +${countAfter - countBefore}`);

    // Spot checks
    const checks = ["paris", "london", "tokyo", "france", "germany", "us", "fr", "de", "usa", "fra", "deu"];
    console.log("\nSpot checks:");
    for (const check of checks) {
      const row = await prisma.geoCache.findUnique({ where: { key: check } });
      console.log(
        `  "${check}": ${row ? `[${row.lat}, ${row.lng}]` : "NOT IN CACHE"}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
