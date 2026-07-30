// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

/**
 * Single source of truth for "features unaffected by the July 23 2026 GitHub stargazer
 * restriction". Shared by AnnouncementBanner (compact link row) and the /roadmap page
 * (full cards). Update here, both surfaces stay in sync.
 */
export type StillWorkingLink = { label: string; href: string; description: string };

export const STILL_WORKING_LINKS: readonly StillWorkingLink[] = [
  {
    label: "Contributors Map",
    href: "/rtk-ai/rtk/contributors",
    description: "Who codes a repo, mapped by location.",
  },
  {
    label: "Dependents Explorer",
    href: "/vercel/next.js/dependents",
    description: "Who depends on a repo, and where they're based.",
  },
  {
    label: "Followers map",
    href: "/FlorianBruniaux/followers",
    description: "A GitHub user's followers, mapped.",
  },
  {
    label: "Trending repos",
    href: "/trending",
    description: "Repos gaining stargazers fastest, from the pre-cutoff archive.",
  },
  {
    label: "Dev Maps",
    href: "/devs",
    description: "Explore developers by language, country, and company.",
  },
];
