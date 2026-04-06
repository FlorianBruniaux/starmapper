// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, memo } from "react";
import maplibregl from "maplibre-gl";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { fetchAndPatchStyle } from "@/lib/map-style";
import { useTheme } from "@/hooks/useTheme";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { toGeoName } from "@/lib/country-geo-names";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const topoData = require("world-atlas/countries-110m.json") as Topology;

type Props = {
  countryData: [string, number][];
  onCountryClick?: (country: string) => void;
};

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";

/**
 * Normalize a polygon ring so no two adjacent vertices differ by >180° in longitude.
 * This prevents MapLibre from drawing straight lines across the antimeridian (Russia, Fiji…).
 */
const normalizeRing = (ring: number[][]): number[][] => {
  if (ring.length === 0) return ring;
  const out: number[][] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let lng = ring[i][0];
    const prevLng = out[i - 1][0];
    while (lng - prevLng > 180) lng -= 360;
    while (prevLng - lng > 180) lng += 360;
    out.push([lng, ring[i][1]]);
  }
  return out;
};

const normalizeGeometry = (geom: GeoJSON.Geometry): GeoJSON.Geometry => {
  if (geom.type === "Polygon") {
    return { ...geom, coordinates: geom.coordinates.map(normalizeRing) };
  }
  if (geom.type === "MultiPolygon") {
    return { ...geom, coordinates: geom.coordinates.map((poly) => poly.map(normalizeRing)) };
  }
  return geom;
};

/** Build a GeoJSON FeatureCollection from world-atlas, annotated with dev counts. */
const buildChoroplethGeoJSON = (countryData: [string, number][]) => {
  const countMap = new Map(countryData.map(([name, n]) => [toGeoName(name), n]));
  const maxCount = Math.max(...countryData.map(([, n]) => n), 1);

  const geoJson = feature(
    topoData,
    topoData.objects.countries as GeometryCollection,
  );

  return {
    ...geoJson,
    features: geoJson.features.map((f) => {
      const count = countMap.get((f.properties as { name: string } | null)?.name ?? "") ?? 0;
      return {
        ...f,
        geometry: normalizeGeometry(f.geometry),
        properties: {
          ...f.properties,
          count,
          intensity: count / maxCount,
        },
      };
    }),
  };
};

export const CountryChoropleth = memo(({ countryData, onCountryClick }: Props) => {
  const { theme } = useTheme();
  const styleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tooltipRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      if (!containerRef.current) return;
      const patchedStyle = await fetchAndPatchStyle(styleUrl);
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: patchedStyle,
        center: [15, 20],
        zoom: 1.4,
        attributionControl: false,
      });
      mapRef.current = map;

      tooltipRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "choropleth-tooltip",
      });

      const geoJson = buildChoroplethGeoJSON(countryData);

      map.on("load", () => {
        if (cancelled) return;
        map.addSource("countries", { type: "geojson", data: geoJson });

        // Fill layer — color driven by intensity
        map.addLayer({
          id: "countries-fill",
          type: "fill",
          source: "countries",
          paint: {
            "fill-color": [
              "interpolate",
              ["linear"],
              ["get", "intensity"],
              0,    "rgba(88, 166, 255, 0.08)",
              0.05, "rgba(88, 166, 255, 0.35)",
              0.2,  "rgba(255, 166, 87, 0.65)",
              0.5,  "rgba(255, 100, 50, 0.80)",
              1.0,  "rgba(248, 81, 73, 0.95)",
            ],
            "fill-opacity": [
              "case",
              [">", ["get", "count"], 0], 1,
              0.15,
            ],
          },
        });

        // Border layer
        map.addLayer({
          id: "countries-border",
          type: "line",
          source: "countries",
          paint: {
            "line-color": "rgba(255, 255, 255, 0.12)",
            "line-width": 0.5,
          },
        });

        // Hover highlight layer — initially shows nothing
        map.addLayer({
          id: "countries-hover",
          type: "fill",
          source: "countries",
          paint: {
            "fill-color": "rgba(255, 255, 255, 0.08)",
            "fill-opacity": 0,
          },
          filter: ["==", ["get", "name"], ""],
        });
      });

      // Hover
      map.on("mousemove", "countries-fill", (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const props = e.features[0].properties as { name: string; count: number };
        const name = props.name;
        const count = props.count;

        map.setFilter("countries-hover", ["==", ["get", "name"], name]);
        map.setPaintProperty("countries-hover", "fill-opacity", 0.15);

        tooltipRef.current
          ?.setLngLat(e.lngLat)
          .setHTML(
            `<div class="choropleth-tip">
              <strong>${name}</strong>
              <span>${count > 0 ? count.toLocaleString() + " developers" : "no data"}</span>
            </div>`,
          )
          .addTo(map);
      });

      map.on("mouseleave", "countries-fill", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("countries-hover", ["==", ["get", "name"], ""]);
        map.setPaintProperty("countries-hover", "fill-opacity", 0);
        tooltipRef.current?.remove();
      });

      // Click
      map.on("click", "countries-fill", (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties as { name: string; count: number };
        if (props.count > 0 && onCountryClick) {
          const geoName = props.name;
          const entry = countryData.find(([sm]) => toGeoName(sm) === geoName);
          const smName = entry ? entry[0] : geoName;
          onCountryClick(smName);
        }
      });
    };

    void initMap();

    return () => {
      cancelled = true;
      tooltipRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // styleUrl triggers a full map rebuild (simplest + most reliable approach for theme swap)
  // countryData + onCountryClick are stable refs — not needed in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // Update source data when countryData changes (without rebuilding the map)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    src?.setData(buildChoroplethGeoJSON(countryData));
  }, [countryData]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

CountryChoropleth.displayName = "CountryChoropleth";
