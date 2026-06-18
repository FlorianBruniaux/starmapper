// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { TourId } from "@/lib/tour-storage";

export type TourStep = {
  selector: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right" | "center";
  optional?: boolean;
};

export type TourDefinition = {
  id: TourId;
  steps: TourStep[];
};

const LANDING_STEPS: TourStep[] = [
  {
    selector: "[data-tour='landing-search']",
    title: "Map any repo",
    description: "Paste a GitHub URL, type owner/repo, or just a username. StarMapper handles all three formats.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='landing-compare']",
    title: "Compare two repos",
    description: "Toggle this to add a second repo and see their stargazer audiences side by side on the same map.",
    placement: "bottom",
  },
  {
    selector: "body",
    title: "Quick search",
    description: "When you come back, press Cmd+K (or Ctrl+K) to instantly find any repo you've already mapped, no retyping needed.",
    placement: "center",
  },
  {
    selector: "[data-tour='landing-features']",
    title: "More to explore",
    description: "Dev maps show developer density by language, Language Atlas reveals the dominant language per country, and Trending surfaces the fastest-growing repos.",
    placement: "top",
  },
  {
    selector: "[data-tour='landing-community']",
    title: "Community maps",
    description: "Browse repos already mapped by other users, a good way to discover interesting projects.",
    placement: "top",
  },
];

const MAP_STEPS: TourStep[] = [
  {
    selector: "[data-tour='map-top-panel']",
    title: "Your stargazer overview",
    description: "Stars, countries, mapping ratio, and Organic Score all at a glance. Click the score pill for a detailed breakdown.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='map-find-stargazer']",
    title: "Find any stargazer",
    description: "Type a GitHub username to locate that user on the map and fly to their position.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='map-view-toggle']",
    title: "Clusters or heatmap",
    description: "Switch between cluster markers that group nearby users and a heatmap that shows density gradients across regions.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-controls']",
    title: "Filter by influence",
    description: "Adjust cluster density with the slider, or isolate a follower tier. Purple dots are the 5k+ crowd, useful for spotting where your most-followed stargazers live.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-stats']",
    title: "Deep stats",
    description: "Six tabs: top stars, countries, cities, companies, power users who starred the most repos, and geographic velocity showing which countries are accelerating.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-stargazers']",
    title: "Full stargazer list",
    description: "Browse every stargazer with their avatar, location, and follower count. Searchable and sorted by followers by default.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-growth']",
    title: "Growth chart",
    description: "Star acquisition over time as a chart. Spot launch spikes, viral moments, and whether growth is accelerating or flattening.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-watch']",
    title: "Live watch mode",
    description: "Polls GitHub every 60 seconds and shows new stars as they arrive on the map. Useful during a launch or a Hacker News post.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-history']",
    title: "Star history",
    description: "Opens star-history.com with your repo pre-loaded, a cumulative stars-over-time chart for longer-term trend analysis.",
    placement: "right",
  },
  {
    selector: "[data-tour='map-timelapse']",
    title: "Timelapse",
    description: "Replay how your repo gained stars week by week. Scrub through time or let it play automatically to see the geographic spread unfold.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-badge']",
    title: "README badge",
    description: "Add a live stargazer map image or a shield badge to your repo's README with one copy-paste. Updates automatically as new stars come in.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-share']",
    title: "Share your map",
    description: "Download a PNG screenshot, share on X or LinkedIn with a pre-filled post, or copy a deep link with your active filters.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='map-projection']",
    title: "2D or 3D globe",
    description: "Switch between a flat Mercator projection and a rotatable 3D globe to better see polar regions and the full spread of your audience.",
    placement: "bottom",
  },
];

const EXPLORE_STEPS: TourStep[] = [
  {
    selector: "[data-tour='explore-summary']",
    title: "Global stats",
    description: "Aggregate numbers across every repo ever scanned on StarMapper: total developers, tracked repos, star events, and countries covered.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='explore-tabs']",
    title: "Six leaderboards",
    description: "Top Stars ranks the most-followed developers. Power Users shows who starred the most repos. Companies, Countries, and Cities give geographic breakdowns. Around Me finds developers near any location.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='explore-filters']",
    title: "Filter and search",
    description: "Narrow by country, search by login or name, and set a minimum follower threshold. All filters sync to the URL so views are shareable.",
    placement: "bottom",
    optional: true,
  },
  {
    selector: "[data-tour='explore-map']",
    title: "Interactive map",
    description: "Switch between a choropleth (developer density by country, click any to filter the list) and a global heatmap of all stargazers. On the Around Me tab, it shows real developer scatter near your chosen location.",
    placement: "left",
  },
];

const FEEDS_STEPS: TourStep[] = [
  {
    selector: "[data-tour='feeds-header']",
    title: "Activity feeds",
    description: "Announcements from developers you follow, aggregated in one place. New releases, blog posts, and project news, fetched fresh every time you visit.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='feeds-cards']",
    title: "Developer cards",
    description: "Each card shows the two latest news items for that developer. Click the avatar or the footer link to open their full profile, or hit the X to unfollow.",
    placement: "bottom",
    optional: true,
  },
];

const PROFILE_STEPS: TourStep[] = [
  {
    selector: "[data-tour='profile-map']",
    title: "Stargazer map",
    description: "All repos tracked on StarMapper for this developer, combined on one map. Each dot is a stargazer. Pin anyone from the nearby list to highlight them here.",
    placement: "bottom",
    optional: true,
  },
  {
    selector: "[data-tour='profile-card']",
    title: "Profile card",
    description: "GitHub stats, languages, company, and location at a glance. Use Refresh to pull the latest data from GitHub, or Contact to find their email and socials.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='profile-news']",
    title: "News & Follow",
    description: "Recent announcements from this developer: new releases, blog posts, project news. Hit Follow to add them to your Feeds so their updates land in one place.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='profile-github-repos']",
    title: "GitHub repos",
    description: "All public repos from this developer. Click Map a repo to run a full stargazer scan on any of them and see where their audience lives on the world map.",
    placement: "top",
  },
  {
    selector: "[data-tour='profile-starred-repos']",
    title: "Starred repos on StarMapper",
    description: "Repos this developer has starred that were also scanned on StarMapper. Sorted by recency, stars, or mapping ratio. A quick way to discover what they find interesting.",
    placement: "top",
    optional: true,
  },
  {
    selector: "[data-tour='profile-repos']",
    title: "Repos on StarMapper",
    description: "Every repo from this developer that has been mapped. Stars, mapping ratio, and language visible at a glance. Click any card to open its stargazer map.",
    placement: "right",
    optional: true,
  },
  {
    selector: "[data-tour='profile-nearby']",
    title: "Developers nearby",
    description: "Other developers in the StarMapper database within the same geographic area. Pin them on the map above to compare locations, or click to visit their profile.",
    placement: "left",
    optional: true,
  },
];

const CONTRIBUTORS_STEPS: TourStep[] = [
  {
    selector: "body",
    title: "Contributors map",
    description: "This page maps the people who built this repo. Each dot is a contributor placed at their location. Dot size reflects commit count — bigger means more commits.",
    placement: "center",
  },
  {
    selector: "[data-tour='contributors-controls']",
    title: "Run the scan",
    description: "Click Map contributors to fetch contributor data from GitHub and geocode their locations. A GitHub token speeds things up significantly for large repos.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='contributors-count']",
    title: "Mapping progress",
    description: "Shows mapped contributors vs total. Only contributors who filled in a location on GitHub can be placed on the map — the rest appear in the Unmapped tab of the panel.",
    placement: "bottom",
    optional: true,
  },
  {
    selector: "[data-tour='contributors-panel']",
    title: "Contributor list",
    description: "Browse all contributors sorted by commit count. Click the pin icon next to any name to fly the map to their location. Switch to Unmapped to see who couldn't be geocoded.",
    placement: "right",
    optional: true,
  },
];

export const TOUR_DEFINITIONS: Record<TourId, TourDefinition> = {
  landing: { id: "landing", steps: LANDING_STEPS },
  map: { id: "map", steps: MAP_STEPS },
  explore: { id: "explore", steps: EXPLORE_STEPS },
  feeds: { id: "feeds", steps: FEEDS_STEPS },
  profile: { id: "profile", steps: PROFILE_STEPS },
  contributors: { id: "contributors", steps: CONTRIBUTORS_STEPS },
};
