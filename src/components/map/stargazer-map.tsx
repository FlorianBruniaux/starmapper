// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useCallback, useEffect, useRef, useState, useMemo, memo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StargazerPoint } from "@/app/api/chunk/route";
import { getStoredProjection, setStoredProjection } from "@/lib/theme";
import type { MapProjection } from "@/lib/theme";
import { fetchAndPatchStyle } from "@/lib/map-style";
import { JawgBadge } from "@/components/map/jawg-badge";
import { CLUSTER_RADIUS } from "@/components/map/constants";

type Props = {
  points: StargazerPoint[];
  comparePoints?: StargazerPoint[];
  flyTarget?: { lat: number; lng: number; login: string; zoom?: number } | null;
  onFlyDone?: () => void;
  onReady?: (controls: {
    captureCanvas: () => Promise<string | null>;
    setViewMode: (mode: "clusters" | "heatmap") => void;
    toggleProjection: () => MapProjection;
    getProjection: () => MapProjection;
  }) => void;
  clusterRadius?: number;
  // Optional: override the map tile style URL (for light/dark switching)
  styleUrl?: string;
  // When true (default), renders a self-contained 2D/3D toggle overlay button.
  // Set to false when the parent provides its own toggle UI (e.g. MapFloatingNav pill).
  // When true, renders a self-contained 2D/3D toggle overlay button inside the map.
  // Default false — parent pages typically provide their own toggle in the nav bar.
  showProjectionToggle?: boolean;
  // Initial map center [lng, lat]. In globe mode, the globe rotates to show this location.
  initialCenter?: [number, number];
};

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
const STYLE_URL = `https://api.jawg.io/styles/jawg-dark.json?access-token=${JAWG_TOKEN}`;
const CLUSTER_MAX_ZOOM = 20;
const ENABLE_GLOBE = process.env.NEXT_PUBLIC_ENABLE_GLOBE !== "false";

// Adds all clustered sources + layers — called at init and on radius rebuild
const setupClusteredSourcesAndLayers = (
  map: maplibregl.Map,
  radius: number,
  mainData: GeoJSON.FeatureCollection,
  heatData: GeoJSON.FeatureCollection,
  compareData: GeoJSON.FeatureCollection,
  heatVisible: boolean,
) => {
  map.addSource("stargazers", {
    type: "geojson",
    data: mainData,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: radius,
    maxzoom: 22,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "stargazers",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": ["step", ["get", "point_count"], "#58a6ff", 10, "#388bfd", 50, "#f85149"],
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
      "circle-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "stargazers",
    filter: ["has", "point_count"],
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 12, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] },
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "stargazers",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["step", ["get", "followers"], "#58a6ff", 100, "#ffa657", 500, "#f85149"],
      "circle-radius": ["step", ["get", "followers"], 5, 100, 7, 500, 10],
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255,255,255,0.15)",
    },
  });

  map.addSource("stargazers-heat", {
    type: "geojson",
    data: heatData,
  });

  map.addLayer({
    id: "heatmap",
    type: "heatmap",
    source: "stargazers-heat",
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "followers"], 0, 0.4, 100, 0.7, 500, 1, 5000, 2],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.2, 12, 2],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)", 0.1, "#313695", 0.3, "#4575b4", 0.5, "#74add1",
        0.6, "#abd9e9", 0.7, "#fee090", 0.85, "#f46d43", 1, "#d73027",
      ],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 4, 12, 8, 24, 12, 40],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 9, 0.7, 14, 0.3, 16, 0],
    },
    layout: { visibility: heatVisible ? "visible" : "none" },
  }, "clusters");

  map.addSource("stargazers-compare", {
    type: "geojson",
    data: compareData,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: radius,
    maxzoom: 22,
  });

  map.addLayer({
    id: "clusters-compare",
    type: "circle",
    source: "stargazers-compare",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#a371f7",
      "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 50, 32],
      "circle-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "cluster-count-compare",
    type: "symbol",
    source: "stargazers-compare",
    filter: ["has", "point_count"],
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 12, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] },
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: "unclustered-point-compare",
    type: "circle",
    source: "stargazers-compare",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#a371f7",
      "circle-radius": 5,
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255,255,255,0.15)",
    },
  });
};

const buildHeatGeoJSON = (pts: StargazerPoint[]) => {
  return {
    type: "FeatureCollection" as const,
    features: pts.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { followers: p.followers },
    })),
  };
}

const buildGeoJSON = (pts: StargazerPoint[]) => {
  return {
    type: "FeatureCollection" as const,
    features: pts.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        login: p.login,
        name: p.name,
        bio: p.bio,
        company: p.company,
        location: p.location,
        followers: p.followers,
        avatarUrl: p.avatarUrl,
        linkedinUrl: p.linkedinUrl,
        // context + repo coords passed through for contributors popup
        context: (p as unknown as { context?: string; repoOwner?: string; repoRepo?: string }).context ?? null,
        repoOwner: (p as unknown as { repoOwner?: string }).repoOwner ?? null,
        repoRepo: (p as unknown as { repoRepo?: string }).repoRepo ?? null,
      },
    })),
  };
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Spider layout: circle for ≤ 8 points, spiral for more
const spiderPositions = (count: number, cx: number, cy: number) => {
  const pts: { x: number; y: number }[] = [];
  if (count <= 8) {
    const r = Math.max(44, 16 + count * 7);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI - Math.PI / 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  } else {
    // Leaflet.markercluster spiral algorithm
    let angle = 0;
    for (let i = 0; i < count; i++) {
      angle += 25 / (10 + i * 1.4);
      const dist = 15 + 5 * angle;
      pts.push({ x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) });
    }
  }
  return pts;
}

const clearSpider = (map: maplibregl.Map, activeRef: { current: boolean }) => {
  if (!activeRef.current) return;
  for (const id of ["spider-points", "spider-legs-glow", "spider-legs"]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ["spider-points", "spider-legs"]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  activeRef.current = false;
}

const showSpider = async (
  map: maplibregl.Map,
  activeRef: { current: boolean },
  clusterId: number,
  centerCoords: [number, number],
) => {
  clearSpider(map, activeRef);

  const source = map.getSource("stargazers") as maplibregl.GeoJSONSource;
  const leaves = await source.getClusterLeaves(clusterId, 200, 0) as GeoJSON.Feature[];

  const { x: cx, y: cy } = map.project(centerCoords as maplibregl.LngLatLike);
  const positions = spiderPositions(leaves.length, cx, cy).map((p) => map.unproject([p.x, p.y]));

  const legs = {
    type: "FeatureCollection" as const,
    features: positions.map((geo) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [centerCoords, [geo.lng, geo.lat]],
      },
      properties: {},
    })),
  };

  const spiderPts = {
    type: "FeatureCollection" as const,
    features: positions.map((geo, i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [geo.lng, geo.lat] },
      properties: (leaves[i].properties ?? {}),
    })),
  };

  map.addSource("spider-legs", { type: "geojson", data: legs });
  map.addSource("spider-points", { type: "geojson", data: spiderPts });

  // Soft glow behind legs
  map.addLayer({
    id: "spider-legs-glow",
    type: "line",
    source: "spider-legs",
    paint: { "line-color": "#58a6ff", "line-width": 4, "line-opacity": 0.12, "line-blur": 4 },
  }, "clusters");

  // Dashed legs
  map.addLayer({
    id: "spider-legs",
    type: "line",
    source: "spider-legs",
    paint: { "line-color": "#58a6ff", "line-width": 1, "line-opacity": 0.4, "line-dasharray": [3, 3] },
  }, "clusters");

  // Spider point circles
  map.addLayer({
    id: "spider-points",
    type: "circle",
    source: "spider-points",
    paint: {
      "circle-radius": ["step", ["get", "followers"], 5, 100, 7, 500, 9],
      "circle-color": ["step", ["get", "followers"], "#58a6ff", 100, "#ffa657", 500, "#f85149"],
      "circle-opacity": 0.95,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
    },
  });

  activeRef.current = true;
}

const makeGridCellPopup = (bio: string, login: string): HTMLElement => {
  // bio format: "__grid__:{count}:{topLogin}"
  const parts = bio.split(":");
  const count = parseInt(parts[1] ?? "0", 10);
  const topLogin = parts[2] ?? login;

  const el = document.createElement("div");
  el.style.cssText = "padding:6px 0;min-width:200px";

  const heading = document.createElement("div");
  heading.style.cssText = "font-weight:600;font-size:15px;color:var(--color-foreground);margin-bottom:6px";
  heading.textContent = `${count.toLocaleString()} developer${count !== 1 ? "s" : ""}`;
  el.appendChild(heading);

  const sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:var(--color-muted)";
  sub.textContent = "in this area";
  el.appendChild(sub);

  const topRow = document.createElement("div");
  topRow.style.cssText = "margin-top:8px;font-size:12px;color:var(--color-muted)";
  const topLabel = document.createTextNode("Top: ");
  const topLink = document.createElement("a");
  topLink.href = `/profile/${encodeURIComponent(topLogin)}`;
  topLink.target = "_blank";
  topLink.rel = "noopener noreferrer";
  topLink.style.cssText = "color:var(--color-accent-blue);text-decoration:none";
  topLink.textContent = `@${topLogin}`;
  topRow.appendChild(topLabel);
  topRow.appendChild(topLink);
  el.appendChild(topRow);

  return el;
};

// Profile fetch dedup — same login = same Promise, avoids duplicate network calls on repeated clicks.
// Capped at 300 entries to prevent unbounded growth during long sessions.
const profileFetchCache = new Map<string, Promise<{ ownedRepos?: { owner: string; repo: string }[] } | null>>();
const PROFILE_CACHE_MAX = 300;

// Defense-in-depth: strip any HTML tags from user-controlled strings before
// passing to the DOM. The popup uses .textContent (already XSS-safe), but this
// ensures any future refactor to .innerHTML can't accidentally introduce XSS.
const sanitizeText = (s: string): string => String(s).replace(/<[^>]*>/g, "").trim();

const makePopupElement = (props: Record<string, unknown>): HTMLElement => {
  const login = sanitizeText(String(props.login ?? ""));
  const name = props.name ? sanitizeText(String(props.name)) : login;
  const location = props.location ? sanitizeText(String(props.location)) : "";
  const bio = props.bio ? sanitizeText(String(props.bio)) : "";
  const company = props.company ? sanitizeText(String(props.company)) : "";

  // Synthetic grid cell point — render compact cluster popup
  if (bio.startsWith("__grid__:")) return makeGridCellPopup(bio, login);
  const avatarUrl = props.avatarUrl ? String(props.avatarUrl) : "";
  const linkedinUrl = props.linkedinUrl ? String(props.linkedinUrl) : "";

  const el = document.createElement("div");
  el.style.cssText = "padding:6px 0;min-width:260px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";

  if (avatarUrl && avatarUrl.startsWith("https://")) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "";
    img.style.cssText = "width:44px;height:44px;border-radius:50%;flex-shrink:0;border:1px solid var(--color-border-subtle)";
    header.appendChild(img);
  }

  const nameBlock = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.style.cssText = "font-weight:600;font-size:15px;color:var(--color-foreground);line-height:1.3";
  nameEl.textContent = name;

  const link = document.createElement("a");
  link.href = `https://github.com/${login}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "color:var(--color-accent-blue);text-decoration:none;font-size:13px";
  link.textContent = `@${login}`;

  nameBlock.appendChild(nameEl);
  nameBlock.appendChild(link);
  header.appendChild(nameBlock);
  el.appendChild(header);

  if (bio) {
    const bioEl = document.createElement("div");
    bioEl.style.cssText = "font-size:12px;color:var(--color-muted);margin-bottom:6px;line-height:1.5;font-style:italic";
    bioEl.textContent = bio;
    el.appendChild(bioEl);
  }

  const meta = document.createElement("div");
  meta.style.cssText = "font-size:12px;color:var(--color-muted);line-height:1.9";
  const metaParts: (string | HTMLElement)[] = [];
  if (company) metaParts.push(company);
  if (location) metaParts.push(location);
  if (props.followers) {
    const isContributors = props.context === "contributors";
    const commitCount = Number(props.followers);
    const repoOwner = props.repoOwner ? String(props.repoOwner) : null;
    const repoRepo = props.repoRepo ? String(props.repoRepo) : null;
    const countLink = document.createElement("a");
    if (isContributors && repoOwner && repoRepo) {
      countLink.href = `https://github.com/${repoOwner}/${repoRepo}/commits?author=${login}`;
    } else if (isContributors) {
      countLink.href = `https://github.com/${login}`;
    } else {
      countLink.href = `/${login}/followers`;
    }
    if (isContributors) {
      countLink.target = "_blank";
      countLink.rel = "noopener noreferrer";
    }
    countLink.style.cssText = "color:var(--color-muted);text-decoration:none;border-bottom:1px dotted currentColor;cursor:pointer";
    countLink.textContent = isContributors
      ? `${commitCount.toLocaleString()} ${commitCount === 1 ? "commit" : "commits"}`
      : `${commitCount.toLocaleString()} followers`;
    countLink.addEventListener("mouseenter", () => {
      countLink.style.color = "var(--color-accent-blue)";
    });
    countLink.addEventListener("mouseleave", () => {
      countLink.style.color = "var(--color-muted)";
    });
    metaParts.push(countLink);
  }
  metaParts.forEach((part, i) => {
    if (i > 0) meta.appendChild(document.createTextNode(" · "));
    if (typeof part === "string") meta.appendChild(document.createTextNode(part));
    else meta.appendChild(part);
  });
  if (metaParts.length) el.appendChild(meta);

  const safeLinkedinUrl = typeof linkedinUrl === "string" && linkedinUrl.startsWith("https://") ? linkedinUrl : null;
  if (safeLinkedinUrl) {
    const liLink = document.createElement("a");
    liLink.href = safeLinkedinUrl;
    liLink.target = "_blank";
    liLink.rel = "noopener noreferrer";
    liLink.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:12px;color:var(--color-accent-blue);text-decoration:none;font-weight:500";
    liLink.textContent = "LinkedIn →";
    el.appendChild(liLink);
  }

  // View profile / contributors button
  const isContributorsCtx = props.context === "contributors";
  const ctxRepoOwner = props.repoOwner ? String(props.repoOwner) : null;
  const ctxRepoRepo = props.repoRepo ? String(props.repoRepo) : null;
  const btnStyle = [
    "display:block",
    "margin-top:10px",
    "padding:5px 10px",
    "border-radius:6px",
    "border:1px solid var(--color-border)",
    "background:var(--color-surface-alt)",
    "color:var(--color-foreground)",
    "text-decoration:none",
    "font-size:12px",
    "font-weight:500",
    "text-align:center",
    "transition:border-color 0.15s,background 0.15s",
  ].join(";");

  if (isContributorsCtx && ctxRepoOwner && ctxRepoRepo) {
    // Primary: view their commits to this repo
    const commitsBtn = document.createElement("a");
    commitsBtn.href = `https://github.com/${ctxRepoOwner}/${ctxRepoRepo}/commits?author=${login}`;
    commitsBtn.target = "_blank";
    commitsBtn.rel = "noopener noreferrer";
    commitsBtn.style.cssText = btnStyle;
    commitsBtn.textContent = "View commits →";
    commitsBtn.addEventListener("mouseenter", () => {
      commitsBtn.style.borderColor = "var(--color-accent-blue)";
      commitsBtn.style.background = "var(--color-surface)";
    });
    commitsBtn.addEventListener("mouseleave", () => {
      commitsBtn.style.borderColor = "var(--color-border)";
      commitsBtn.style.background = "var(--color-surface-alt)";
    });
    el.appendChild(commitsBtn);

    // Secondary: contributor graph
    const graphBtn = document.createElement("a");
    graphBtn.href = `https://github.com/${ctxRepoOwner}/${ctxRepoRepo}/graphs/contributors`;
    graphBtn.target = "_blank";
    graphBtn.rel = "noopener noreferrer";
    graphBtn.style.cssText = btnStyle + ";margin-top:4px;color:var(--color-muted)";
    graphBtn.textContent = "Contributor graph →";
    graphBtn.addEventListener("mouseenter", () => {
      graphBtn.style.borderColor = "var(--color-accent-blue)";
      graphBtn.style.color = "var(--color-foreground)";
    });
    graphBtn.addEventListener("mouseleave", () => {
      graphBtn.style.borderColor = "var(--color-border)";
      graphBtn.style.color = "var(--color-muted)";
    });
    el.appendChild(graphBtn);
  } else {
    const profileBtn = document.createElement("a");
    profileBtn.href = `/profile/${login}`;
    profileBtn.style.cssText = btnStyle;
    profileBtn.textContent = "View StarMapper profile →";
    profileBtn.addEventListener("mouseenter", () => {
      profileBtn.style.borderColor = "var(--color-accent-blue)";
      profileBtn.style.background = "var(--color-surface)";
    });
    profileBtn.addEventListener("mouseleave", () => {
      profileBtn.style.borderColor = "var(--color-border)";
      profileBtn.style.background = "var(--color-surface-alt)";
    });
    el.appendChild(profileBtn);
  }

  // Tracked repos — lazy-loaded
  const reposSection = document.createElement("div");
  reposSection.style.cssText = "margin-top:8px;border-top:1px solid var(--color-border-subtle);padding-top:8px";
  const reposLoading = document.createElement("div");
  reposLoading.setAttribute("aria-live", "polite");
  reposLoading.style.cssText = "font-size:11px;color:var(--color-muted-subtle)";
  reposLoading.textContent = "Loading tracked repos…";
  reposSection.appendChild(reposLoading);
  el.appendChild(reposSection);

  if (!profileFetchCache.has(login)) {
    if (profileFetchCache.size >= PROFILE_CACHE_MAX) {
    const oldest = profileFetchCache.keys().next().value;
    if (oldest !== undefined) profileFetchCache.delete(oldest);
  }
    profileFetchCache.set(login, fetch(`/api/profile/${encodeURIComponent(login)}`)
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null));
  }
  // "Wrong location?" button — only shown when user has a location string
  if (location) {
    const reportBtn = document.createElement("button");
    reportBtn.style.cssText =
      "display:block;margin-top:8px;font-size:11px;color:var(--color-muted-subtle);background:none;border:none;padding:0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:2px";
    reportBtn.textContent = "Wrong location?";
    reportBtn.addEventListener("click", () => {
      reportBtn.disabled = true;
      reportBtn.textContent = "Recalculating…";
      fetch("/api/recalculate-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      })
        .then((r) => r.json())
        .then((data: { lat?: number; lng?: number; unmapped?: boolean; error?: string }) => {
          if (data.error) {
            reportBtn.textContent = "Error. Try again.";
            reportBtn.disabled = false;
          } else if (data.unmapped) {
            reportBtn.textContent = "No location found";
            reportBtn.style.color = "var(--color-muted)";
          } else {
            reportBtn.textContent = `✓ Recalculated (${data.lat?.toFixed(2)}, ${data.lng?.toFixed(2)})`;
            reportBtn.style.color = "var(--color-accent-green, #3fb950)";
          }
        })
        .catch(() => {
          reportBtn.textContent = "Error. Try again.";
          reportBtn.disabled = false;
        });
    });
    el.appendChild(reportBtn);
  }

  profileFetchCache.get(login)!
    .then((data: { ownedRepos?: { owner: string; repo: string }[] } | null) => {
      const repos = data?.ownedRepos ?? [];
      reposSection.innerHTML = "";
      if (!repos.length) {
        reposSection.style.display = "none";
        return;
      }
      const badge = document.createElement("div");
      badge.style.cssText = "font-size:11px;color:var(--color-muted);margin-bottom:5px;font-weight:500";
      badge.textContent = `📦 ${repos.length} repo${repos.length > 1 ? "s" : ""} on StarMapper`;
      reposSection.appendChild(badge);
      for (const r of repos.slice(0, 5)) {
        const link = document.createElement("a");
        link.href = `/${r.owner}/${r.repo}`;
        link.style.cssText = "display:block;font-size:12px;color:var(--color-accent-blue);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.8";
        link.textContent = `${r.owner}/${r.repo}`;
        reposSection.appendChild(link);
      }
      if (repos.length > 5) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:11px;color:var(--color-muted-subtle);margin-top:2px";
        more.textContent = `+${repos.length - 5} more`;
        reposSection.appendChild(more);
      }
    })
    .catch(() => { reposSection.style.display = "none"; });

  return el;
}

const StargazerMapInner = ({ points, comparePoints, flyTarget, onFlyDone, onReady, styleUrl, clusterRadius, showProjectionToggle = false, initialCenter }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointsRef = useRef<StargazerPoint[]>(points);
  const comparePointsRef = useRef<StargazerPoint[]>(comparePoints ?? []);
  const spiderActiveRef = useRef(false);
  const clusterRadiusRef = useRef(clusterRadius ?? CLUSTER_RADIUS.default);
  const hasInitializedRef = useRef(false);
  const appliedStyleUrlRef = useRef<string>("");
  const projectionRef = useRef<MapProjection>("mercator");
  const [projectionState, setProjectionState] = useState<MapProjection>("mercator");
  // Throttle refs: prevent MapLibre setData from firing on every chunk during progressive loading.
  // Leading call fires immediately; subsequent calls within the window are batched (trailing wins).
  const setDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // F11: store a boolean flag instead of pre-computed GeoJSON — compute lazily at setData time
  const pendingSetDataRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  // compareGeoJSON kept as useMemo — compare updates are infrequent (user-triggered, not per-chunk)
  const compareGeoJSON = useMemo(() => buildGeoJSON(comparePoints ?? []), [comparePoints]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    comparePointsRef.current = comparePoints ?? [];
  }, [comparePoints]);

  useEffect(() => {
    clusterRadiusRef.current = clusterRadius ?? CLUSTER_RADIUS.default;
  }, [clusterRadius]);

  const rebuildClusteredSources = useCallback((radius: number) => {
    const map = mapRef.current;
    if (!map || !hasInitializedRef.current) return;
    clearSpider(map, spiderActiveRef);
    const heatVisible = map.getLayoutProperty("heatmap", "visibility") === "visible";
    for (const id of ["unclustered-point-compare", "cluster-count-compare", "clusters-compare",
                       "unclustered-point", "cluster-count", "clusters", "heatmap"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of ["stargazers", "stargazers-heat", "stargazers-compare"]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    setupClusteredSourcesAndLayers(
      map, radius,
      buildGeoJSON(pointsRef.current),
      buildHeatGeoJSON(pointsRef.current),
      buildGeoJSON(comparePointsRef.current),
      heatVisible,
    );
  }, []);

  useEffect(() => {
    if (!hasInitializedRef.current) return;
    rebuildClusteredSources(clusterRadius ?? CLUSTER_RADIUS.default);
  }, [clusterRadius, rebuildClusteredSources]);


  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      if (!containerRef.current) return;

      const isMobile =
        typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches &&
        window.innerWidth < 768;
      const stored = getStoredProjection();
      // Explicit user preference wins over auto-detection
      const projection: MapProjection = stored ?? (ENABLE_GLOBE && !isMobile ? "globe" : "mercator");
      projectionRef.current = projection;
      setProjectionState(projection);

      const resolvedStyleUrl = styleUrl ?? STYLE_URL;
      const style = await fetchAndPatchStyle(resolvedStyleUrl, projection);

      if (cancelled || !containerRef.current || mapRef.current) return;
      appliedStyleUrlRef.current = resolvedStyleUrl;

      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: initialCenter ?? [10, 30],
          zoom: 2,
          minZoom: 1,
          maxPitch: 85,
        });
      } catch {
        setWebglError(true);
        return;
      }

      // Expose controls: canvas capture + view mode toggle (cluster / heatmap)
      const captureCanvas = () => new Promise<string | null>((resolve) => {
        map.once("render", () => {
          try { resolve(map.getCanvas().toDataURL("image/png")); }
          catch { resolve(null); }
        });
        map.triggerRepaint();
      });

      const setViewMode = (mode: "clusters" | "heatmap") => {
        const m = mapRef.current;
        if (!m || !hasInitializedRef.current) return;
        const clusterLayers = ["clusters", "cluster-count", "unclustered-point"];
        if (mode === "heatmap") {
          for (const id of clusterLayers) m.setLayoutProperty(id, "visibility", "none");
          m.setLayoutProperty("heatmap", "visibility", "visible");
          clearSpider(m, spiderActiveRef);
        } else {
          for (const id of clusterLayers) m.setLayoutProperty(id, "visibility", "visible");
          m.setLayoutProperty("heatmap", "visibility", "none");
        }
      };

      const toggleProjection = (): MapProjection => {
        const newProj: MapProjection = projectionRef.current === "globe" ? "mercator" : "globe";
        projectionRef.current = newProj;
        setProjectionState(newProj);
        setStoredProjection(newProj);
        map.setProjection({ type: newProj });
        return newProj;
      };
      const getProjection = (): MapProjection => projectionRef.current;

      onReady?.({ captureCanvas, setViewMode, toggleProjection, getProjection });

      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
        "bottom-right",
      );

      map.on("load", () => {
        setupClusteredSourcesAndLayers(
          map,
          clusterRadiusRef.current,
          buildGeoJSON(pointsRef.current),
          buildHeatGeoJSON(pointsRef.current),
          buildGeoJSON(comparePointsRef.current),
          false,
        );

        // Click cluster → zoom or spiderify
        map.on("click", "clusters", (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          if (!features.length) return;
          const clusterId = features[0].properties?.cluster_id as number;
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];

          (map.getSource("stargazers") as maplibregl.GeoJSONSource)
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => {
              // If expansion zoom reaches cluster max, points can't separate further → spiderify
              if (zoom >= CLUSTER_MAX_ZOOM) {
                showSpider(map, spiderActiveRef, clusterId, coords).catch(() => {});
              } else {
                clearSpider(map, spiderActiveRef);
                map.easeTo({ center: coords, zoom, ...(prefersReducedMotion() && { duration: 0 }) });
              }
            })
            .catch(() => {});
        });

        // Click on unclustered point → popup
        map.on("click", "unclustered-point", (e) => {
          const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!props) return;
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
          const popup = new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "320px" })
            .setLngLat(coords)
            .setDOMContent(makePopupElement(props))
            .addTo(map);
          popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-close-button")
            ?.setAttribute("aria-label", "Close popup");
        });

        // Click on spider point → popup
        map.on("click", "spider-points", (e) => {
          const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!props) return;
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
          const popup = new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "320px" })
            .setLngLat(coords)
            .setDOMContent(makePopupElement(props))
            .addTo(map);
          popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-close-button")
            ?.setAttribute("aria-label", "Close popup");
          e.originalEvent.stopPropagation();
        });

        // Click elsewhere → clear spider
        map.on("click", (e) => {
          const onSpider = spiderActiveRef.current
            ? map.queryRenderedFeatures(e.point, { layers: ["spider-points"] })
            : [];
          const onCluster = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          if (!onSpider.length && !onCluster.length) clearSpider(map, spiderActiveRef);
        });

        // Zoom → clear spider
        map.on("zoomstart", () => clearSpider(map, spiderActiveRef));

        // Signal that the map and all sources/layers are ready
        setMapReady(true);
        hasInitializedRef.current = true;

        // Cursor pointers
        for (const layer of ["clusters", "unclustered-point"] as const) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }
        map.on("mouseenter", "spider-points", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "spider-points", () => { map.getCanvas().style.cursor = ""; });
      });

      mapRef.current = map;
    }

    initMap();

    return () => {
      cancelled = true;
      hasInitializedRef.current = false;
      if (setDataTimerRef.current) { clearTimeout(setDataTimerRef.current); setDataTimerRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  // Map init must run once — initialCenter/styleUrl/onReady are stable on mount; re-init
  // on prop change would destroy and rebuild the entire map (unacceptable UX regression).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // F11: compute GeoJSON inside the throttle window, not on every points change.
    // buildGeoJSON only runs on leading edge + trailing edge (every 2s), not per-chunk.
    const applyFromRefs = () => {
      if (!map.isStyleLoaded()) return;
      const src = map.getSource("stargazers") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(buildGeoJSON(pointsRef.current));
      const hSrc = map.getSource("stargazers-heat") as maplibregl.GeoJSONSource | undefined;
      if (hSrc) hSrc.setData(buildHeatGeoJSON(pointsRef.current));
    };

    // Throttle: fire immediately on leading edge, batch trailing calls within a 2s window.
    // Prevents MapLibre from rebuilding the clustering index on every chunk during a scan.
    if (setDataTimerRef.current === null) {
      applyFromRefs();
      setDataTimerRef.current = setTimeout(() => {
        setDataTimerRef.current = null;
        if (pendingSetDataRef.current) {
          pendingSetDataRef.current = false;
          applyFromRefs();
        }
      }, 2000);
    } else {
      pendingSetDataRef.current = true;
    }
  }, [points, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("stargazers-compare") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(compareGeoJSON);
  }, [compareGeoJSON, mapReady]);

  useEffect(() => {
    if (!flyTarget || !mapRef.current || !mapReady) return;
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: flyTarget.zoom ?? 12, duration: prefersReducedMotion() ? 0 : 1200 });
    onFlyDone?.();
  }, [flyTarget, onFlyDone, mapReady]);

  // Live style swap — swap Jawg base tiles when theme changes.
  // diff:false avoids a MapLibre crash when diffing incompatible style specs.
  // setTimeout(100) gives MapLibre time to flush before re-adding sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const newUrl = styleUrl ?? STYLE_URL;
    if (newUrl === appliedStyleUrlRef.current) return;
    appliedStyleUrlRef.current = newUrl;

    const onStyleData = () => {
      map.off("styledata", onStyleData);
      setTimeout(() => {
        setupClusteredSourcesAndLayers(
          map,
          clusterRadiusRef.current,
          buildGeoJSON(pointsRef.current),
          buildHeatGeoJSON(pointsRef.current),
          buildGeoJSON(comparePointsRef.current),
          false,
        );
      }, 100);
    };
    map.on("styledata", onStyleData);

    // Re-patch style with current projection so globe/mercator persists across theme swaps
    fetchAndPatchStyle(newUrl, projectionRef.current).then((patchedStyle) => {
      map.setStyle(patchedStyle, { diff: false });
    });

    return () => { map.off("styledata", onStyleData); };
  }, [styleUrl, mapReady]);

  if (webglError) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-muted text-sm text-center px-6 gap-3">
        <p className="text-foreground font-medium">Map unavailable: WebGL is disabled</p>
        <p>
          Enable hardware acceleration in your browser settings, then reload the page.
        </p>
        <ul className="text-xs text-muted-subtle space-y-1 text-left">
          <li><span className="text-foreground">Chrome / Edge:</span> Settings → System → &quot;Use hardware acceleration when available&quot;</li>
          <li><span className="text-foreground">Firefox:</span> Settings → General → Performance → &quot;Use hardware acceleration when available&quot;</li>
        </ul>
      </div>
    );
  }

  return (
    <div role="region" aria-label={`Stargazer map — ${points.length.toLocaleString()} developers mapped`} className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <JawgBadge />
      {showProjectionToggle && ENABLE_GLOBE && (
        <button
          onClick={() => {
            const map = mapRef.current;
            if (!map || !mapReady) return;
            const newProj: MapProjection = projectionRef.current === "globe" ? "mercator" : "globe";
            projectionRef.current = newProj;
            setProjectionState(newProj);
            setStoredProjection(newProj);
            map.setProjection({ type: newProj });
          }}
          title={projectionState === "globe" ? "Switch to flat map" : "Switch to globe"}
          aria-label={projectionState === "globe" ? "Switch to flat map" : "Switch to globe"}
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-xs bg-surface/90 backdrop-blur-md border border-border rounded-full px-3 py-1.5 shadow-sm text-muted hover:text-foreground transition-colors"
        >
          {projectionState === "globe" ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="1" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="9" y1="6" x2="9" y2="18" />
              <line x1="15" y1="6" x2="15" y2="18" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="3.5" ry="9" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          )}
          <span>{projectionState === "globe" ? "2D" : "3D"}</span>
        </button>
      )}
    </div>
  );
};

export const StargazerMap = memo(StargazerMapInner);
// Re-export so callers can import CLUSTER_RADIUS from this module without
// pulling in the maplibre-gl bundle directly (the value lives in constants.ts).
export { CLUSTER_RADIUS };
