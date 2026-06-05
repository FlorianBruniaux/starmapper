// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { gzipSync } from "zlib";
import { triggerChunk, fetchSmToken, BASE_URL } from "../client.js";

const REFRESH_EVERY = 200;

type Point = { login: string; lat: number; lng: number };
type Unmapped = { login: string; location: string | null };

const saveToCache = async (
  owner: string,
  repo: string,
  points: Point[],
  unmapped: Unmapped[],
  totalCount: number,
): Promise<void> => {
  const pointsGz = gzipSync(Buffer.from(JSON.stringify(points))).toString("base64");
  const unmappedGz = gzipSync(Buffer.from(JSON.stringify(unmapped))).toString("base64");

  const res = await fetch(`${BASE_URL}/api/stargazer-cache`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo, pointsGz, unmappedGz, totalCount }),
  });
  if (!res.ok) throw new Error(`Failed to save cache: ${res.status}`);
};

export const indexRepo = async (args: { owner: string; repo: string }): Promise<string> => {
  const { owner, repo } = args;
  const allPoints: Point[] = [];
  const allUnmapped: Unmapped[] = [];
  let cursor: string | null = null;
  let totalCount = 0;
  let chunks = 0;

  const MAX_CHUNKS = 1500; // 1500 * 100 users = 150k stars max

  try {
    let smToken = await fetchSmToken();

    do {
      if (smToken && chunks > 0 && chunks % REFRESH_EVERY === 0) {
        smToken = await fetchSmToken();
      }
      const result = await triggerChunk(owner, repo, cursor, smToken);
      allPoints.push(...result.points);
      allUnmapped.push(...result.unmapped);
      cursor = result.nextCursor;
      totalCount = result.totalCount;
      chunks++;
    } while (cursor !== null && chunks < MAX_CHUNKS);

    if (totalCount === 0) {
      return `## ${owner}/${repo}\n\n0 stars found. The repository may not exist or may be private.`;
    }

    await saveToCache(owner, repo, allPoints, allUnmapped, totalCount).catch(() => {
      // Non-critical: indexation data is in DB even if cache save fails
    });

    const mappingRate = totalCount > 0 ? Math.round((allPoints.length / totalCount) * 100) : 0;

    return [
      `## Indexation complete: ${owner}/${repo}`,
      ``,
      `Indexed ${totalCount.toLocaleString()} users in ${chunks} chunk${chunks !== 1 ? "s" : ""}`,
      `Geocoded: ${allPoints.length.toLocaleString()} (${mappingRate}% mapping rate)`,
      `Unmapped: ${allUnmapped.length.toLocaleString()} (no location or unrecognized location)`,
      ``,
      `View on StarMapper: https://starmapper.bruniaux.com/${owner}/${repo}`,
    ].join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `## Error indexing ${owner}/${repo}\n\n${message}\n\nCheck that the repository exists and StarMapper is reachable.`;
  }
};
