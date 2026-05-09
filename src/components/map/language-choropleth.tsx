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
import { LANGUAGE_COLORS, NO_DATA_COLOR } from "@/lib/language-colors";
import type { AtlasCountry } from "@/app/api/devs/atlas/route";

export type SelectedCountry = {
  country: string;   // StarMapper normalized name (smCountry)
  geoName: string;   // world-atlas name
  topLang: string;
  topCnt: number;
  total: number;
};

type Props = {
  countries: AtlasCountry[];
  onCountryClick?: (selected: SelectedCountry) => void;
};

const JAWG_TOKEN = process.env.NEXT_PUBLIC_JAWGMAP_ACCESS_TOKEN ?? "";

/**
 * Pre-normalize polygon rings so no two adjacent vertices differ by >180° in longitude.
 * Prevents MapLibre from drawing straight lines across the antimeridian (Russia, Fiji…).
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

/** Build MapLibre match expression: ["match", ["get", "topLang"], "Python", "#3572A5", ..., fallback] */
const buildMatchExpression = (): unknown[] => {
  const expr: unknown[] = ["match", ["get", "topLang"]];
  for (const [lang, color] of Object.entries(LANGUAGE_COLORS)) {
    expr.push(lang, color);
  }
  expr.push(NO_DATA_COLOR);
  return expr;
};

// Stable expression — computed once, shared across re-renders
const FILL_COLOR_EXPRESSION = buildMatchExpression();

type BaseFeature = GeoJSON.Feature & { geometry: GeoJSON.Geometry };

/** Annotate each world feature with atlas country data. */
const buildAtlasGeoJSON = (
  baseFeatures: BaseFeature[],
  countries: AtlasCountry[],
) => {
  const dataMap = new Map(
    countries.map((c) => [toGeoName(c.country), c]),
  );

  return {
    type: "FeatureCollection" as const,
    features: baseFeatures.map((f) => {
      const geoName = (f.properties as { name: string } | null)?.name ?? "";
      const data = dataMap.get(geoName);
      return {
        ...f,
        properties: {
          ...f.properties,
          topLang: data?.topLang ?? "",
          topCnt: data?.topCnt ?? 0,
          total: data?.total ?? 0,
          smCountry: data?.country ?? "",
        },
      };
    }),
  };
};

export const LanguageChoropleth = memo(({ countries, onCountryClick }: Props) => {
  const { theme } = useTheme();
  const styleUrl = theme === "light" ? MAP_STYLE_LIGHT(JAWG_TOKEN) : MAP_STYLE_DARK(JAWG_TOKEN);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tooltipRef = useRef<maplibregl.Popup | null>(null);

  const [topoData, setTopoData] = useState<Topology | null>(null);

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
    })) as BaseFeature[];
  }, [topoData]);

  const geoJson = useMemo(
    () => (baseFeatures ? buildAtlasGeoJSON(baseFeatures, countries) : null),
    [baseFeatures, countries],
  );

  // Keep a ref so the map-init closure can read the latest geoJson without being in its deps
  const geoJsonRef = useRef(geoJson);
  useEffect(() => { geoJsonRef.current = geoJson; }, [geoJson]);

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
        attributionControl: {},
      });
      mapRef.current = map;

      tooltipRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "choropleth-tooltip",
      });

      map.on("load", () => {
        if (cancelled) return;
        const data = geoJsonRef.current;
        if (!data) return;
        map.addSource("lang-countries", { type: "geojson", data });

        // Categorical fill driven by topLang → linguist color
        map.addLayer({
          id: "lang-countries-fill",
          type: "fill",
          source: "lang-countries",
          paint: {
            "fill-color": FILL_COLOR_EXPRESSION as maplibregl.ExpressionSpecification,
            "fill-opacity": [
              "case",
              [">", ["get", "total"], 0], 0.85,
              0.15,
            ],
          },
        });

        map.addLayer({
          id: "lang-countries-border",
          type: "line",
          source: "lang-countries",
          paint: {
            "line-color": "rgba(255, 255, 255, 0.12)",
            "line-width": 0.5,
          },
        });

        // Hover highlight — initially nothing
        map.addLayer({
          id: "lang-countries-hover",
          type: "fill",
          source: "lang-countries",
          paint: {
            "fill-color": "rgba(255, 255, 255, 0.10)",
            "fill-opacity": 0,
          },
          filter: ["==", ["get", "name"], ""],
        });
      });

      // Hover: tooltip + highlight
      map.on("mousemove", "lang-countries-fill", (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      ) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";

        const props = e.features[0].properties as {
          name: string;
          topLang: string;
          topCnt: number;
          total: number;
        };

        map.setFilter("lang-countries-hover", ["==", ["get", "name"], props.name]);
        map.setPaintProperty("lang-countries-hover", "fill-opacity", 0.15);

        const pct = props.total > 0
          ? Math.round((props.topCnt / props.total) * 100)
          : 0;
        const dotColor = props.topLang ? (LANGUAGE_COLORS[props.topLang] ?? "#8b949e") : "#8b949e";

        const tipEl = document.createElement("div");
        tipEl.className = "choropleth-tip";

        const nameEl = document.createElement("strong");
        nameEl.textContent = props.name;
        tipEl.appendChild(nameEl);

        if (props.total > 0) {
          const langEl = document.createElement("span");
          langEl.className = "tip-lang";
          const dot = document.createElement("span");
          dot.className = "tip-lang-dot";
          dot.style.background = dotColor;
          const langText = document.createTextNode(` ${props.topLang} — ${pct}% of local devs`);
          langEl.appendChild(dot);
          langEl.appendChild(langText);
          tipEl.appendChild(langEl);

          const subEl = document.createElement("span");
          subEl.className = "tip-sub";
          subEl.textContent = `${props.topCnt.toLocaleString()} / ${props.total.toLocaleString()} developers`;
          tipEl.appendChild(subEl);
        } else {
          const subEl = document.createElement("span");
          subEl.className = "tip-sub";
          subEl.textContent = "No data (fewer than 10 developers)";
          tipEl.appendChild(subEl);
        }

        tooltipRef.current
          ?.setLngLat(e.lngLat)
          .setDOMContent(tipEl)
          .addTo(map);
      });

      map.on("mouseleave", "lang-countries-fill", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("lang-countries-hover", ["==", ["get", "name"], ""]);
        map.setPaintProperty("lang-countries-hover", "fill-opacity", 0);
        tooltipRef.current?.remove();
      });

      // Click: open country modal via parent callback
      map.on("click", "lang-countries-fill", (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      ) => {
        if (!e.features?.length) return;
        const props = e.features[0].properties as {
          name: string;
          topLang: string;
          topCnt: number;
          total: number;
          smCountry: string;
        };
        if (props.total > 0 && onCountryClick) {
          onCountryClick({
            country: props.smCountry || props.name,
            geoName: props.name,
            topLang: props.topLang,
            topCnt: props.topCnt,
            total: props.total,
          });
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
  // styleUrl triggers full map rebuild on theme swap — intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  // Update source data when countries prop changes (no full map rebuild)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !geoJson) return;
    const src = map.getSource("lang-countries") as maplibregl.GeoJSONSource | undefined;
    src?.setData(geoJson);
  }, [geoJson]);

  // Don't render the map container until topo data is ready
  if (!geoJson) {
    return <div className="relative w-full h-full bg-background" />;
  }

  return (
    <div role="region" aria-label={`Language atlas map — ${countries.length} countries mapped`} className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      <JawgBadge />
    </div>
  );
});

LanguageChoropleth.displayName = "LanguageChoropleth";
