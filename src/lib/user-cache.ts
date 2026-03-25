import { prisma } from "@/lib/db";
import { checkDbHealth, DB_CRITICAL_PCT } from "@/lib/db-health";
import type { StargazerPoint } from "@/app/api/chunk/route";

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
  points: StargazerPoint[],
  health?: Awaited<ReturnType<typeof checkDbHealth>>,
): Promise<void> => {
  const h = health ?? (await checkDbHealth());
  if (!h.ok || (h.ok && h.usagePct >= DB_CRITICAL_PCT)) {
    if (h.ok) console.warn(`[user-cache] DB critical (${h.usagePct}%) — skipping user upserts`);
    return;
  }

  try {
    await concurrentMap(points, (p) =>
      prisma.gitHubUser.upsert({
        where: { login: p.login },
        create: {
          login: p.login,
          name: p.name ?? null,
          company: p.company ?? null,
          location: p.location ?? null,
          followers: p.followers,
          lat: p.lat,
          lng: p.lng,
          fetchedAt: new Date(),
        },
        update: {
          name: p.name ?? null,
          company: p.company ?? null,
          location: p.location ?? null,
          followers: p.followers,
          lat: p.lat,
          lng: p.lng,
          fetchedAt: new Date(),
        },
      }),
    );
  } catch (err) {
    console.error("[user-cache] bulkUpsertUsers failed:", err);
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
): Promise<Map<string, { lat: number | null; lng: number | null; location: string | null; fetchedAt: Date }>> => {
  if (!logins.length) return new Map();

  try {
    const rows = await prisma.gitHubUser.findMany({
      where: { login: { in: logins } },
      select: { login: true, lat: true, lng: true, location: true, fetchedAt: true },
    });
    return new Map(rows.map((r) => [r.login, { lat: r.lat, lng: r.lng, location: r.location, fetchedAt: r.fetchedAt }]));
  } catch {
    return new Map(); // DB unavailable — fallback to full geocoding
  }
};
