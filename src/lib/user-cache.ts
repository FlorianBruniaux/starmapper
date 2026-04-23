// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import { logError } from "@/lib/api-helpers";

export type UserWritePayload = {
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  accountCreatedAt: string | null;
  lat: number;
  lng: number;
  linkedinUrl: string | null;
  countryNormalized: string | null;
  cityNormalized: string | null;
};

type StarEventInput = {
  login: string;
  owner: string;
  repo: string;
  starredAt: string;
};

// Single-query bulk upsert via UNNEST — 1 round-trip instead of N individual upserts.
// Prisma serializes each JS array as a typed PG array parameter ($1::text[], etc.).
// NULL elements are preserved by PostgreSQL array semantics.
export const bulkUpsertUsers = async (
  users: UserWritePayload[],
  health?: Awaited<ReturnType<typeof checkDbHealth>>,
): Promise<boolean> => {
  if (!users.length) return true;
  const h = health ?? (await checkDbHealth());
  if (!h.ok || (h.ok && h.usagePct >= DB_CRITICAL_PCT)) {
    if (h.ok) console.warn(`[user-cache] DB critical (${h.usagePct}%) — skipping user upserts`);
    return false;
  }

  try {
    const logins              = users.map((u) => u.login);
    const names               = users.map((u) => u.name);
    const companies           = users.map((u) => u.company);
    const locations           = users.map((u) => u.location);
    const followers           = users.map((u) => u.followers);
    const followings          = users.map((u) => u.following);
    const publicRepos         = users.map((u) => u.publicRepos);
    const createdAts          = users.map((u) => u.accountCreatedAt); // ISO string | null
    const lats                = users.map((u) => u.lat);
    const lngs                = users.map((u) => u.lng);
    const linkedinUrls        = users.map((u) => u.linkedinUrl);
    const countryNormalizeds  = users.map((u) => u.countryNormalized);
    const cityNormalizeds     = users.map((u) => u.cityNormalized);
    const now                 = new Date();

    await prisma.$queryRaw`
      INSERT INTO github_user
        (login, name, company, location, followers, following,
         "publicRepos", "accountCreatedAt", "dataVersion", lat, lng, "linkedinUrl",
         "countryNormalized", "cityNormalized", "fetchedAt")
      SELECT
        unnest(${logins}::text[]),
        unnest(${names}::text[]),
        unnest(${companies}::text[]),
        unnest(${locations}::text[]),
        unnest(${followers}::int4[]),
        unnest(${followings}::int4[]),
        unnest(${publicRepos}::int4[]),
        unnest(${createdAts}::text[])::timestamp,
        1,
        unnest(${lats}::float8[]),
        unnest(${lngs}::float8[]),
        unnest(${linkedinUrls}::text[]),
        unnest(${countryNormalizeds}::text[]),
        unnest(${cityNormalizeds}::text[]),
        ${now}
      ON CONFLICT (login) DO UPDATE SET
        name                  = EXCLUDED.name,
        company               = EXCLUDED.company,
        location              = EXCLUDED.location,
        followers             = EXCLUDED.followers,
        following             = EXCLUDED.following,
        "publicRepos"         = EXCLUDED."publicRepos",
        "accountCreatedAt"    = EXCLUDED."accountCreatedAt",
        "dataVersion"         = 1,
        lat                   = EXCLUDED.lat,
        lng                   = EXCLUDED.lng,
        "linkedinUrl"         = EXCLUDED."linkedinUrl",
        "countryNormalized"   = EXCLUDED."countryNormalized",
        "cityNormalized"      = EXCLUDED."cityNormalized",
        "fetchedAt"           = EXCLUDED."fetchedAt"
    `;
    return true;
  } catch (err) {
    logError("user-cache/bulkUpsertUsers", err);
    return false;
  }
};

// createMany + skipDuplicates → single INSERT … ON CONFLICT DO NOTHING.
// Star events are immutable (a user starred a repo at a fixed point in time),
// so skipping duplicates is semantically correct and far simpler than UPSERT.
export const bulkUpsertStarEvents = async (
  events: StarEventInput[],
  health?: Awaited<ReturnType<typeof checkDbHealth>>,
): Promise<void> => {
  if (!events.length) return;
  const h = health ?? (await checkDbHealth());
  if (!h.ok || (h.ok && h.usagePct >= DB_CRITICAL_PCT)) return;

  try {
    await prisma.starEvent.createMany({
      data: events.map((e) => ({
        login: e.login,
        owner: e.owner,
        repo: e.repo,
        starredAt: new Date(e.starredAt),
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    logError("user-cache/bulkUpsertStarEvents", err);
  }
};

export const getOrCreateGitHubUserMinimal = async (login: string): Promise<void> => {
  try {
    await prisma.gitHubUser.upsert({
      where: { login },
      update: {},
      create: { login, dataVersion: 0, source: "news", fetchedAt: new Date() },
    });
  } catch (err) {
    logError("user-cache/getOrCreateGitHubUserMinimal", err);
  }
};

export const bulkReadUsers = async (
  logins: string[],
): Promise<Map<string, { lat: number | null; lng: number | null; location: string | null; fetchedAt: Date; dataVersion: number }>> => {
  if (!logins.length) return new Map();

  try {
    const rows = await prisma.gitHubUser.findMany({
      where: { login: { in: logins } },
      select: { login: true, lat: true, lng: true, location: true, fetchedAt: true, dataVersion: true },
    });
    return new Map(rows.map((r) => [r.login, { lat: r.lat, lng: r.lng, location: r.location, fetchedAt: r.fetchedAt, dataVersion: r.dataVersion }]));
  } catch {
    return new Map();
  }
};
