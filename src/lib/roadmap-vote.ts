// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/api-helpers";

export type Option = "A" | "B" | "C" | "D";
export const OPTIONS: readonly Option[] = ["A", "B", "C", "D"];

export type RoadmapVoteTallies = {
  tallies: Record<Option, number>;
  totalVoters: number;
};

/**
 * Tallies computed SQL-side (unnest + GROUP BY) rather than an in-app findMany + reduce, so a
 * viral repost doesn't change the query's cost profile. A vote can select multiple options, so
 * sum(tallies) > totalVoters is expected, not a bug (see roadmap-vote.test.ts).
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

// name/email are free-text/voter-supplied, escape before interpolating into the HTML email
// body, or a name like `<img src=x onerror=...>` renders unescaped in the recipient's client.
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Best-effort notification to the site owner on each vote. Never blocks or fails the vote
 * itself (Rule 1, secondary features never block a critical flow): every failure path here
 * is swallowed after logging, so a Resend outage never turns a recorded vote into an error.
 */
export const notifyVote = async (
  options: Option[],
  email?: string,
  name?: string,
  message?: string,
): Promise<void> => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  try {
    const resend = new Resend(resendKey);
    const to = process.env.DIGEST_EMAIL ?? "florian@bruniaux.com";
    const voter = email
      ? `${name ? `${escapeHtml(name)}, ` : ""}${escapeHtml(email)}`
      : "anonymous";
    const messageBlock = message
      ? `<p>Message: ${escapeHtml(message)}</p>`
      : "";
    const { error } = await resend.emails.send({
      from: process.env.DIGEST_FROM ?? "StarMapper <onboarding@resend.dev>",
      to,
      subject: `Roadmap vote: ${options.join("+")}`,
      html: `<p>Options: <strong>${options.join(", ")}</strong></p><p>Voter: ${voter}</p>${messageBlock}`,
    });
    if (error) logError("roadmap-vote notify", error);
  } catch (err) {
    logError("roadmap-vote notify", err);
  }
};
