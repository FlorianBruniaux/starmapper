"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StargazerPoint } from "@/app/api/chunk/route";

interface Props {
  points: StargazerPoint[];
  comparePoints?: StargazerPoint[];
  flyTarget?: { lat: number; lng: number; login: string } | null;
  onFlyDone?: () => void;
  onReady?: (captureCanvas: () => Promise<string | null>) => void;
}

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";
const STYLE_URL = `https://api.jawg.io/styles/jawg-dark.json?access-token=${JAWG_TOKEN}&lang=en`;
const CLUSTER_MAX_ZOOM = 12;

function buildGeoJSON(pts: StargazerPoint[]) {
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
      },
    })),
  };
}

// Spider layout: circle for ≤ 8 points, spiral for more
function spiderPositions(count: number, cx: number, cy: number) {
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

function clearSpider(map: maplibregl.Map, activeRef: { current: boolean }) {
  if (!activeRef.current) return;
  for (const id of ["spider-points", "spider-legs-glow", "spider-legs"]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ["spider-points", "spider-legs"]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  activeRef.current = false;
}

async function showSpider(
  map: maplibregl.Map,
  activeRef: { current: boolean },
  clusterId: number,
  centerCoords: [number, number],
) {
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
      "circle-stroke-color": "#0d1117",
    },
  });

  activeRef.current = true;
}

function makePopupElement(props: Record<string, unknown>): HTMLElement {
  const login = String(props.login ?? "");
  const name = props.name ? String(props.name) : login;
  const location = props.location ? String(props.location) : "";
  const bio = props.bio ? String(props.bio) : "";
  const company = props.company ? String(props.company) : "";
  const avatarUrl = props.avatarUrl ? String(props.avatarUrl) : "";

  const el = document.createElement("div");
  el.style.cssText = "padding:4px 0;min-width:200px";

  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";

  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "";
    img.style.cssText = "width:36px;height:36px;border-radius:50%;flex-shrink:0;border:1px solid rgba(255,255,255,0.1)";
    header.appendChild(img);
  }

  const nameBlock = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.style.cssText = "font-weight:600;font-size:13px;color:#f0f6fc;line-height:1.3";
  nameEl.textContent = name;

  const link = document.createElement("a");
  link.href = `https://github.com/${login}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = "color:#58a6ff;text-decoration:none;font-size:11px";
  link.textContent = `@${login}`;

  nameBlock.appendChild(nameEl);
  nameBlock.appendChild(link);
  header.appendChild(nameBlock);
  el.appendChild(header);

  if (bio) {
    const bioEl = document.createElement("div");
    bioEl.style.cssText = "font-size:11px;color:#c9d1d9;margin-bottom:6px;line-height:1.5;font-style:italic";
    bioEl.textContent = bio;
    el.appendChild(bioEl);
  }

  const meta = document.createElement("div");
  meta.style.cssText = "font-size:11px;color:#8b949e;line-height:1.9";
  const lines: string[] = [];
  if (company) lines.push(`🏢 ${company}`);
  if (location) lines.push(`📍 ${location}`);
  if (props.followers) lines.push(`👥 ${Number(props.followers).toLocaleString()} followers`);
  meta.textContent = lines.join(" · ");
  if (lines.length) el.appendChild(meta);

  return el;
}

export function StargazerMap({ points, comparePoints, flyTarget, onFlyDone, onReady }: Props) {
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

    async function initMap() {
      if (!containerRef.current) return;

      let style: string | StyleSpecification = STYLE_URL;
      try {
        const res = await fetch(STYLE_URL);
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

      // Expose async capture: triggers a repaint and grabs the canvas during
      // the render event (before WebGL swaps the buffer — no preserveDrawingBuffer needed)
      onReady?.(() => new Promise<string | null>((resolve) => {
        map.once("render", () => {
          try { resolve(map.getCanvas().toDataURL("image/png")); }
          catch { resolve(null); }
        });
        map.triggerRepaint();
      }));

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
          new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "260px" })
            .setLngLat(coords)
            .setDOMContent(makePopupElement(props))
            .addTo(map);
        });

        // Click on spider point → popup
        map.on("click", "spider-points", (e) => {
          const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
          if (!props) return;
          const coords = (e.features![0].geometry as GeoJSON.Point).coordinates as [number, number];
          new maplibregl.Popup({ className: "starmapper-popup", maxWidth: "260px" })
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
    if (!source) return;
    source.setData(buildGeoJSON(points));
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
