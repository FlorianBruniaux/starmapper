// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { prisma } from "@/lib/db";

export type Option = "A" | "B" | "C" | "D";
export const OPTIONS: readonly Option[] = ["A", "B", "C", "D"];

export type RoadmapVoteTallies = {
  tallies: Record<Option, number>;
  totalVoters: number;
};

/**
 * Tallies computed SQL-side (unnest + GROUP BY) rather than an in-app findMany + reduce, so a
 * viral repost doesn't change the query's cost profile. A vote can select multiple options, so
 * sum(tallies) > totalVoters is expected, not a bug — see roadmap-vote.test.ts.
 */
export const getTallies = async (): Promise<RoadmapVoteTallies> => {
  const [rows, totalVoters] = await Promise.all([
    prisma.$queryRaw<Array<{ option: string; count: bigint }>>`
      SELECT unnest(options) AS option, count(*) AS count
      FROM roadmap_vote
      GROUP BY option
    `,
    prisma.roadmapVote.count(),
  ]);

  const tallies = OPTIONS.reduce(
    (acc, option) => ({ ...acc, [option]: 0 }),
    {} as Record<Option, number>,
  );
  for (const row of rows) {
    if ((OPTIONS as readonly string[]).includes(row.option)) {
      tallies[row.option as Option] = Number(row.count);
    }
  }

  return { tallies, totalVoters };
};
