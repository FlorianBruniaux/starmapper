import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";

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
};

// Run promises with a max concurrency to avoid thundering herd on Neon
async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit = 10,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

type StarEventInput = {
  login: string;
  owner: string;
  repo: string;
  starredAt: string;
};

export const bulkUpsertUsers = async (
  users: UserWritePayload[],
  health?: Awaited<ReturnType<typeof checkDbHealth>>,
): Promise<boolean> => {
  const h = health ?? (await checkDbHealth());
  if (!h.ok || (h.ok && h.usagePct >= DB_CRITICAL_PCT)) {
    if (h.ok) console.warn(`[user-cache] DB critical (${h.usagePct}%) — skipping user upserts`);
    return false;
  }


  try {
    await concurrentMap(users, (u) =>
      prisma.gitHubUser.upsert({
        where: { login: u.login },
        create: {
          login: u.login,
          name: u.name ?? null,
          company: u.company ?? null,
          location: u.location ?? null,
          followers: u.followers,
          following: u.following,
          publicRepos: u.publicRepos,
          accountCreatedAt: u.accountCreatedAt ? new Date(u.accountCreatedAt) : null,
          dataVersion: 1,
          lat: u.lat,
          lng: u.lng,
          linkedinUrl: u.linkedinUrl ?? null,
          fetchedAt: new Date(),
        },
        update: {
          name: u.name ?? null,
          company: u.company ?? null,
          location: u.location ?? null,
          followers: u.followers,
          following: u.following,
          publicRepos: u.publicRepos,
          accountCreatedAt: u.accountCreatedAt ? new Date(u.accountCreatedAt) : null,
          dataVersion: 1,
          lat: u.lat,
          lng: u.lng,
          linkedinUrl: u.linkedinUrl ?? null,
          fetchedAt: new Date(),
        },
      }),
    );
    return true;
  } catch (err) {
    console.error("[user-cache] bulkUpsertUsers failed:", err);
    return false;
  }
};

export const bulkUpsertStarEvents = async (
  events: StarEventInput[],
  health?: Awaited<ReturnType<typeof checkDbHealth>>,
): Promise<void> => {
  const h = health ?? (await checkDbHealth());
  if (!h.ok || (h.ok && h.usagePct >= DB_CRITICAL_PCT)) return;

  try {
    await concurrentMap(events, (e) =>
      prisma.starEvent.upsert({
        where: { login_owner_repo: { login: e.login, owner: e.owner, repo: e.repo } },
        create: {
          login: e.login,
          owner: e.owner,
          repo: e.repo,
          starredAt: new Date(e.starredAt),
        },
        update: {
          starredAt: new Date(e.starredAt),
        },
      }),
    );
  } catch (err) {
    console.error("[user-cache] bulkUpsertStarEvents failed:", err);
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
    return new Map(); // DB unavailable — fallback to full geocoding
  }
};
