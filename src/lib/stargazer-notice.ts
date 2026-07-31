// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Single source of truth for the "GitHub restricted stargazer access" notice, shared by the
 * announcement banner, the landing modal and the repo-page message. Update the copy here and
 * every surface stays in sync.
 *
 * Context: since 2026-07-23 GitHub restricts the Repository.stargazers connection (GraphQL,
 * REST and the /stargazers web view). New scans return empty stargazer lists. Cached repos
 * still render from data captured before the cutoff. See
 * claudedocs/github-stargazers-restriction.md for the full investigation.
 */

export type NoticeLink = { label: string; href: string };

export const STARGAZER_NOTICE_HEADLINE =
  "GitHub restricted public access to stargazer lists";

export const STARGAZER_NOTICE_SHORT =
  "New repo scans can't fetch stargazers right now. Already-mapped repos still work.";

/** Paragraphs for the explanatory modal, kept plain so they can be rendered as-is. */
export const STARGAZER_NOTICE_BODY: readonly string[] = [
  "On June 30 2026 GitHub announced restrictions on public API endpoints and UI views. Since July 23 the restriction reached the stargazers list: the GraphQL connection, the REST endpoint and the github.com/owner/repo/stargazers page all return empty or 404, for everyone, on every repo.",
  "StarMapper builds its map from that exact list, who starred a repo and where they live. Without it, a fresh scan finds no one to place. This is a GitHub-side decision, not a bug on our end, and there is currently no API that returns the same data.",
  "Repos already mapped before the cutoff keep working, they render from cached data. You can still add a new repo below, we save what we can and show the map the moment access returns.",
  "I'm actively analysing what StarMapper can do next, including rebuilding the map from the user side rather than the repo side. Follow the links below for the official sources.",
];

/** Paragraphs shown when a repo falls back to reconstructed or engaged data instead of a full scan. */
export const STARGAZER_NOTICE_DEGRADED_BODY: readonly string[] = [
  "On June 30 2026 GitHub announced restrictions on public API endpoints and UI views. Since July 23 the restriction reached the stargazers list.",
  "This repo's map is not from a fresh stargazers scan. It's reconstructed from data StarMapper already holds, or built from the engaged community (forkers, contributors, issue and PR authors) instead. Both recover a slice of the real audience, not the full list.",
  "Follow the links below for the official sources, or see the open options at /roadmap.",
];

export const STARGAZER_NOTICE_LINKS: readonly NoticeLink[] = [
  {
    label: "GitHub changelog (June 30 2026)",
    href: "https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/",
  },
  {
    label: "Community discussion #202114",
    href: "https://github.com/orgs/community/discussions/202114",
  },
  {
    label: "Community discussion #201209",
    href: "https://github.com/orgs/community/discussions/201209",
  },
  {
    label: "Independent confirmation (daily-stars-explorer #363)",
    href: "https://github.com/emanuelef/daily-stars-explorer/issues/363",
  },
];
