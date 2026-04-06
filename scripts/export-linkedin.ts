// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { neon } from "@neondatabase/serverless";
import { writeFileSync, readFileSync } from "fs";

// Parse .env.local manually
const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
}

const run = async () => {
  const sql = neon(process.env.DATABASE_URL!);

  const rows = await sql`
    SELECT
      login, name, company, location, followers, following,
      "publicRepos",
      "linkedinUrl",
      "cityNormalized",
      "countryNormalized"
    FROM github_user
    WHERE "linkedinUrl" IS NOT NULL AND "linkedinUrl" != ''
      AND followers > 50
      AND "countryNormalized" ILIKE '%france%'
    ORDER BY followers DESC
  `;

  type Row = Record<string, unknown>;

  const headers = [
    "login", "name", "company", "location",
    "followers", "following", "publicRepos",
    "linkedinUrl", "cityNormalized", "countryNormalized",
  ];

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as Row)[h])).join(",")),
  ];

  writeFileSync("claudedocs/exports/linkedin-france-50plus-followers.csv", lines.join("\n"), "utf-8");
  console.log(`Done: ${rows.length} rows → claudedocs/exports/linkedin-france-50plus-followers.csv`);
};

run().catch(console.error);
