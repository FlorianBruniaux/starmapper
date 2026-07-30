// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { Option } from "@/lib/roadmap-vote";

export type RoadmapOptionStatus = "decided" | "evaluating";

export type RoadmapOptionCopy = {
  option: Option;
  status: RoadmapOptionStatus;
  statusLabel: string;
  label: string;
  sentence: string;
};

// Order: lead with what's already moving (A, C, D), land on the real question (B).
export const ROADMAP_OPTIONS: readonly RoadmapOptionCopy[] = [
  {
    option: "A",
    status: "decided",
    statusLabel: "Already shipping",
    label: "Map the engaged community, not just stargazers",
    sentence:
      "A pipeline already crawls forks, issues, PRs and mentions instead of the closed stargazers list. Early runs recovered 6-16% of a repo's stargazer count, with 57-89% of those accounts carrying a usable location.",
  },
  {
    option: "C",
    status: "decided",
    statusLabel: "Already live",
    label: "Lead with contributors and dependents, not stars",
    sentence:
      "Contributors Map and Dependents Explorer, both linked above, read from a different GitHub endpoint and were never touched by the July 23 restriction. They just need to stop being an afterthought on the homepage.",
  },
  {
    option: "D",
    status: "decided",
    statusLabel: "Already planned",
    label: "Freeze the pre-cutoff data as a citable archive",
    sentence:
      "Every repo scanned before July 23 2026 is a snapshot GitHub can't reproduce anymore. Publishing it as a dated, citable dataset is a documentation decision, not new engineering.",
  },
  {
    option: "B",
    status: "evaluating",
    statusLabel: "Under evaluation",
    label: "Owner-verified dashboard: connect your GitHub, get your repo's live data",
    sentence:
      "This is the one real fork. It means StarMapper's first-ever login, storing a third-party GitHub token, and the same compliance exposure that reportedly got a comparable project's token pool flagged by GitHub.",
  },
];

const KEY = "starmapper:roadmap-vote";

/** Reads the visitor's last-submitted vote, or null if they haven't voted (or storage is unavailable). */
export const getStoredVote = (): Option[] | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Option[]) : null;
  } catch {
    return null;
  }
};

/** Persists the visitor's vote so the page can skip straight to the results view on return. */
export const saveStoredVote = (options: Option[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // localStorage unavailable (private browsing, etc.), non-fatal, vote still recorded server-side
  }
};
