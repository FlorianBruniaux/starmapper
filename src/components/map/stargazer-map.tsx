// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StargazerPoint } from "@/app/api/chunk/route";

type Props = {
  points: StargazerPoint[];
  comparePoints?: StargazerPoint[];
  flyTarget?: { lat: number; lng: number; login: string } | null;
  onFlyDone?: () => void;
  onReady?: (controls: {
    captureCanvas: () => Promise<string | null>;
    setViewMode: (mode: "clusters" | "heatmap") => void;
  }) => void;
  // Optional: override the map tile style URL (for light/dark switching)
  styleUrl?: string;
};

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
const STYLE_URL = `https://api.jawg.io/styles/jawg-dark.json?access-token=${JAWG_TOKEN}&lang=en`;
const CLUSTER_MAX_ZOOM = 12;

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
      },
    })),
  };
}

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
  topRow.innerHTML = `Top: <a href="https://github.com/${topLogin}" target="_blank" rel="noopener noreferrer" style="color:var(--color-accent-blue);text-decoration:none">@${topLogin}</a>`;
  el.appendChild(topRow);

  return el;
};

const makePopupElement = (props: Record<string, unknown>): HTMLElement => {
  const login = String(props.login ?? "");
  const name = props.name ? String(props.name) : login;
  const location = props.location ? String(props.location) : "";
  const bio = props.bio ? String(props.bio) : "";
  const company = props.company ? String(props.company) : "";

  // Synthetic grid cell point — render compact cluster popup
  if (bio.startsWith("__grid__:")) return makeGridCellPopup(bio, login);
  const avatarUrl = props.avatarUrl ? String(props.avatarUrl) : "";
  const linkedinUrl = props.linkedinUrl ? String(props.linkedinUrl) : "";

  const el = document.createElement("div");
  el.style.cssText = "padding:6px 0;min-width:260px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";

  if (avatarUrl) {
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
  const lines: string[] = [];
  if (company) lines.push(`🏢 ${company}`);
  if (location) lines.push(`📍 ${location}`);
  if (props.followers) lines.push(`👥 ${Number(props.followers).toLocaleString()} followers`);
  meta.textContent = lines.join(" · ");
  if (lines.length) el.appendChild(meta);

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

  // Tracked repos — lazy-loaded
  const reposSection = document.createElement("div");
  reposSection.style.cssText = "margin-top:8px;border-top:1px solid var(--color-border-subtle);padding-top:8px";
  const reposLoading = document.createElement("div");
  reposLoading.style.cssText = "font-size:11px;color:var(--color-muted-subtle)";
  reposLoading.textContent = "Loading tracked repos…";
  reposSection.appendChild(reposLoading);
  el.appendChild(reposSection);

  fetch(`/api/profile/${encodeURIComponent(login)}`)
    .then((r) => r.ok ? r.json() : null)
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

export const StargazerMap = ({ points, comparePoints, flyTarget, onFlyDone, onReady, styleUrl }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointsRef = useRef<StargazerPoint[]>(points);
  const comparePointsRef = useRef<StargazerPoint[]>(comparePoints ?? []);
  const spiderActiveRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    comparePointsRef.current = comparePoints ?? [];
  }, [comparePoints]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      if (!containerRef.current) return;

      const resolvedStyleUrl = styleUrl ?? STYLE_URL;
      let style: string | StyleSpecification = resolvedStyleUrl;
      try {
        const res = await fetch(resolvedStyleUrl);
        if (res.ok) {
          const json = await res.json() as StyleSpecification;
          if (!json.projection) json.projection = { type: "mercator" };
          if (json.glyphs && JAWG_TOKEN) {
            json.glyphs = json.glyphs.includes("access-token")
              ? json.glyphs
              : `${json.glyphs}${json.glyphs.includes("?") ? "&" : "?"}access-token=${JAWG_TOKEN}`;
          }
          // Jawg doesn't serve "Noto Sans Bold" — replace with Open Sans Bold in all layers
          for (const layer of json.layers ?? []) {
            const fonts = (layer as { layout?: { "text-font"?: string[] } }).layout?.["text-font"];
            if (fonts) {
              for (let i = 0; i < fonts.length; i++) {
                if (fonts[i].includes("Noto Sans")) fonts[i] = fonts[i].replace("Noto Sans", "Open Sans");
              }
            }
          }

          // Remove ocean / marine / water-body label layers (noisy, not useful)
          json.layers = (json.layers ?? []).filter((layer) => {
            const sl = (layer as { "source-layer"?: string })["source-layer"];
            if (sl === "water_name" || sl === "marine") return false;
            const id = layer.id ?? "";
            if (/^(ocean|marine|water.?name)/i.test(id)) return false;
            return true;
          });

          // Force English label names if Jawg lang param isn't enough
          const fixed = JSON.parse(
            JSON.stringify(json).replace(/"name:fr"/g, '"name:en"'),
          ) as StyleSpecification;
          Object.assign(json, fixed);

          style = json;
        }
      } catch { /* fall back to URL */ }

      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [10, 30],
        zoom: 2,
        minZoom: 1,
      });

      // Expose controls: canvas capture + view mode toggle (cluster / heatmap)
      const captureCanvas = () => new Promise<string | null>((resolve) => {
        map.once("render", () => {
          try { resolve(map.getCanvas().toDataURL("image/png")); }
          catch { resolve(null); }
        });
        map.triggerRepaint();
      });

      const setViewMode = (mode: "clusters" | "heatmap") => {
        const clusterLayers = ["clusters", "cluster-count", "unclustered-point"];
        if (mode === "heatmap") {
          for (const id of clusterLayers) map.setLayoutProperty(id, "visibility", "none");
          map.setLayoutProperty("heatmap", "visibility", "visible");
          clearSpider(map, spiderActiveRef);
        } else {
          for (const id of clusterLayers) map.setLayoutProperty(id, "visibility", "visible");
          map.setLayoutProperty("heatmap", "visibility", "none");
        }
      };

      onReady?.({ captureCanvas, setViewMode });

      map.addControl(new maplibregl.NavigationControl(), "bottom-right");

      map.on("load", () => {
        map.addSource("stargazers", {
          type: "geojson",
          data: buildGeoJSON(pointsRef.current),
          cluster: true,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterRadius: 50,
        });

        // Cluster circles
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

        // Cluster count labels
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "stargazers",
          filter: ["has", "point_count"],
          layout: { "text-field": "{point_count_abbreviated}", "text-size": 12, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] },
          paint: { "text-color": "#ffffff" },
        });

        // Individual points
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

        // Heatmap source (non-clustered, stripped properties for memory efficiency)
        map.addSource("stargazers-heat", {
          type: "geojson",
          data: buildHeatGeoJSON(pointsRef.current),
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
          layout: { visibility: "none" },
        }, "clusters");

        // Compare repo overlay (purple)
        map.addSource("stargazers-compare", {
          type: "geojson",
          data: buildGeoJSON(comparePointsRef.current),
          cluster: true,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterRadius: 50,
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
                map.easeTo({ center: coords, zoom });
              }
            })
            .catch(() => {});
        });

        // Click on unclustered point → popup
        map.on("click", "unclustered-point", (e) => {
          const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!props) return;
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
          new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "320px" })
            .setLngLat(coords)
            .setDOMContent(makePopupElement(props))
            .addTo(map);
        });

        // Click on spider point → popup
        map.on("click", "spider-points", (e) => {
          const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!props) return;
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
          new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "320px" })
            .setLngLat(coords)
            .setDOMContent(makePopupElement(props))
            .addTo(map);
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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("stargazers") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(buildGeoJSON(points));
    const heatSrc = map.getSource("stargazers-heat") as maplibregl.GeoJSONSource | undefined;
    if (heatSrc) heatSrc.setData(buildHeatGeoJSON(points));
  }, [points, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("stargazers-compare") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(buildGeoJSON(comparePoints ?? []));
  }, [comparePoints, mapReady]);

  useEffect(() => {
    if (!flyTarget || !mapRef.current || !mapReady) return;
    mapRef.current.flyTo({ center: [flyTarget.lng, flyTarget.lat], zoom: 12, duration: 1200 });
    onFlyDone?.();
  }, [flyTarget, onFlyDone, mapReady]);

  return <div ref={containerRef} className="w-full h-full" />;
}
