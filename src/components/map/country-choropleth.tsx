// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, useState, useMemo, memo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/theme";
import { fetchAndPatchStyle } from "@/lib/map-style";
import { JawgBadge } from "@/components/map/jawg-badge";
import { useTheme } from "@/hooks/useTheme";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { toGeoName } from "@/lib/country-geo-names";

type Props = {
  countryData: [string, number][];
  selectedCountry?: string;
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

export const CountryChoropleth = memo(({ countryData, selectedCountry, onCountryClick }: Props) => {
  const { theme } = useTheme();
  const styleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tooltipRef = useRef<maplibregl.Popup | null>(null);

  const [topoData, setTopoData] = useState<Topology | null>(null);
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => r.json())
      .then((data) => setTopoData(data as Topology))
      .catch(() => {});
  }, []);

  const baseFeatures = useMemo(() => {
    if (!topoData) return null;
    return feature(
      topoData,
      topoData.objects.countries as GeometryCollection,
    ).features.map((f) => ({
      ...f,
      geometry: normalizeGeometry(f.geometry),
    }));
  }, [topoData]);

  const geoJson = useMemo(() => {
    if (!baseFeatures) return null;
    const countMap = new Map(countryData.map(([name, n]) => [toGeoName(name), n]));
    const maxCount = Math.max(...countryData.map(([, n]) => n), 1);
    return {
      type: "FeatureCollection" as const,
      features: baseFeatures.map((f) => {
        const count = countMap.get((f.properties as { name: string } | null)?.name ?? "") ?? 0;
        return {
          ...f,
          properties: {
            ...f.properties,
            count,
            intensity: count / maxCount,
          },
        };
      }),
    };
  }, [baseFeatures, countryData]);

  // Keep refs so map-init closures can read latest values without being in their deps
  const geoJsonRef = useRef(geoJson);
  useEffect(() => { geoJsonRef.current = geoJson; }, [geoJson]);
  const selectedCountryRef = useRef(selectedCountry);
  useEffect(() => { selectedCountryRef.current = selectedCountry; }, [selectedCountry]);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const addLayers = (map: maplibregl.Map, data: NonNullable<typeof geoJson>) => {
      map.addSource("countries", { type: "geojson", data });
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
      map.addLayer({
        id: "countries-border",
        type: "line",
        source: "countries",
        paint: { "line-color": "rgba(255, 255, 255, 0.12)", "line-width": 0.5 },
      });
      map.addLayer({
        id: "countries-hover",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "rgba(255, 255, 255, 0.08)", "fill-opacity": 0 },
        filter: ["==", ["get", "name"], ""],
      });
      const sel = selectedCountryRef.current ? toGeoName(selectedCountryRef.current) : "";
      map.addLayer({
        id: "countries-selected-fill",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "rgba(88, 166, 255, 0.35)" },
        filter: ["==", ["get", "name"], sel],
      });
      map.addLayer({
        id: "countries-selected",
        type: "line",
        source: "countries",
        paint: { "line-color": "rgba(255, 255, 255, 0.9)", "line-width": 2.5 },
        filter: ["==", ["get", "name"], sel],
      });
    };

    const initMap = async () => {
      if (!containerRef.current) return;
      const patchedStyle = await fetchAndPatchStyle(styleUrl);
      if (cancelled || !containerRef.current) return;

      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style: patchedStyle,
          center: [15, 20],
          zoom: 1.4,
          attributionControl: {},
        });
      } catch {
        setWebglError(true);
        return;
      }
      mapRef.current = map;

      tooltipRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "choropleth-tooltip",
      });

      map.on("load", () => {
        if (cancelled) return;
        const data = geoJsonRef.current;
        // If topoData loaded before style, add layers now.
        // If not, useEffect([geoJson]) will add them when data arrives.
        if (data) addLayers(map, data);
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

        const tipEl = document.createElement("div");
        tipEl.className = "choropleth-tip";
        const strong = document.createElement("strong");
        strong.textContent = name;
        const span = document.createElement("span");
        span.textContent = count > 0 ? `${count.toLocaleString()} developers` : "no data";
        tipEl.append(strong, span);

        tooltipRef.current
          ?.setLngLat(e.lngLat)
          .setDOMContent(tipEl)
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

  // Update source data when geoJson becomes available or changes.
  // If the map "load" event fired while topoData was still loading (geoJsonRef was null),
  // the source was never added — add it now. Otherwise just update the existing source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geoJson) return;
    if (!map.isStyleLoaded()) return; // load event will call addLayers via geoJsonRef
    const src = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geoJson);
    } else {
      // Source was never created — geoJson wasn't ready when "load" fired
      map.addSource("countries", { type: "geojson", data: geoJson });
      map.addLayer({
        id: "countries-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "intensity"],
            0, "rgba(88, 166, 255, 0.08)", 0.05, "rgba(88, 166, 255, 0.35)",
            0.2, "rgba(255, 166, 87, 0.65)", 0.5, "rgba(255, 100, 50, 0.80)",
            1.0, "rgba(248, 81, 73, 0.95)",
          ],
          "fill-opacity": ["case", [">", ["get", "count"], 0], 1, 0.15],
        },
      });
      map.addLayer({
        id: "countries-border",
        type: "line",
        source: "countries",
        paint: { "line-color": "rgba(255, 255, 255, 0.12)", "line-width": 0.5 },
      });
      map.addLayer({
        id: "countries-hover",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "rgba(255, 255, 255, 0.08)", "fill-opacity": 0 },
        filter: ["==", ["get", "name"], ""],
      });
      const sel = selectedCountryRef.current ? toGeoName(selectedCountryRef.current) : "";
      map.addLayer({
        id: "countries-selected-fill",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "rgba(88, 166, 255, 0.35)" },
        filter: ["==", ["get", "name"], sel],
      });
      map.addLayer({
        id: "countries-selected",
        type: "line",
        source: "countries",
        paint: { "line-color": "rgba(255, 255, 255, 0.9)", "line-width": 2.5 },
        filter: ["==", ["get", "name"], sel],
      });
    }
  }, [geoJson]);

  // Update selected-country highlight when selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const geoName = selectedCountry ? toGeoName(selectedCountry) : "";
    if (map.getLayer("countries-selected-fill")) map.setFilter("countries-selected-fill", ["==", ["get", "name"], geoName]);
    if (map.getLayer("countries-selected")) map.setFilter("countries-selected", ["==", ["get", "name"], geoName]);
  }, [selectedCountry]);

  if (webglError) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-muted text-sm text-center px-6 gap-3">
        <p className="text-foreground font-medium">Map unavailable — WebGL is disabled</p>
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
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <JawgBadge />
    </div>
  );
});

CountryChoropleth.displayName = "CountryChoropleth";
