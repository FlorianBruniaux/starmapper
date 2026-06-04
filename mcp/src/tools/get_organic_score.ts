// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { fetchOrganicScore } from "../client.js";

export const GET_ORGANIC_SCORE_SCHEMA = {
  name: "get_organic_score",
  description:
    "Get the organic score for a GitHub repository: a 0-100 heuristic measuring whether star growth looks natural. Returns score, verdict, and breakdown of all signals with their weights.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: { type: "string", description: "GitHub repository owner" },
      repo:  { type: "string", description: "GitHub repository name" },
    },
    required: ["owner", "repo"],
  },
};

export const getOrganicScore = async (args: { owner: string; repo: string }): Promise<string> => {
  const data = await fetchOrganicScore(args.owner, args.repo);

  const scoreDisplay = data.score !== null ? `${data.score}/100` : "N/A";
  const pct = (v: number | null) => (v !== null ? `${(v * 100).toFixed(1)}%` : "N/A");

  const signals = [
    `Fork/star ratio:       ${pct(data.signals.forkRatio)} (weight: ${data.weights.fork_ratio}%)`,
    `Watcher/star ratio:    ${pct(data.signals.watcherRatio)} (weight: ${data.weights.watcher_ratio}%)`,
    `Zero-follower users:   ${data.signals.zeroFollowerPct !== null ? `${data.signals.zeroFollowerPct.toFixed(1)}%` : "N/A"} of ${data.signals.sampleSize.toLocaleString()} enriched users (weight: ${data.weights.zero_follower_pct}%)`,
    `Releases count:        ${data.signals.releasesCount ?? "N/A"} (weight: ${data.weights.releases_count}%)`,
  ].join("\n");

  const reasons = data.reasons.length > 0
    ? `\n### Notes\n${data.reasons.map((r) => `- ${r}`).join("\n")}`
    : "";

  return [
    `## Organic Score: ${args.owner}/${args.repo}`,
    ``,
    `Score: **${scoreDisplay}** - ${data.tierLabel}`,
    `Active signals: ${data.activeSignals.join(", ") || "none"}`,
    `Corpus calibration accuracy: ${data.corpusAccuracy}%`,
    data.computedAt ? `Last computed: ${new Date(data.computedAt).toLocaleDateString()}` : "",
    ``,
    `### Signal breakdown`,
    signals,
    reasons,
  ].filter(Boolean).join("\n");
};
