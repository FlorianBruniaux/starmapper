// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect, useRef, memo } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { useTheme } from "@/hooks/useTheme";

// Popular repos stargazer lat/lng sample (from DB)
const STAR_POINTS: [number, number][] = [
  [37.77, -122.42], [40.71, -74.01], [51.51, -0.13], [48.85, 2.35],
  [52.52, 13.40], [35.69, 139.69], [31.23, 121.47], [55.75, 37.62],
  [19.07, 72.88], [28.61, 77.21], [1.35, 103.82], [43.65, -79.38],
  [41.90, 12.49], [40.42, -3.70], [59.33, 18.07], [-33.87, 151.21],
  [37.57, 126.98], [25.20, 55.27], [24.47, 54.37], [-23.55, -46.63],
  [-34.61, -58.38], [6.36, 3.38], [-1.29, 36.82], [30.06, 31.25],
  [47.38, 8.54], [47.50, 19.04], [50.45, 30.52], [45.46, 9.19],
  [53.34, -6.27], [38.72, -9.14], [-26.20, 28.04], [14.69, -17.44],
  [33.89, 35.50], [32.08, 34.78], [39.93, 116.39], [22.33, 114.17],
  [13.75, 100.52], [3.14, 101.69], [10.82, 106.63], [28.66, 77.23],
  [12.97, 77.59], [17.39, 78.49], [23.73, 90.39], [6.93, 79.86],
  [33.74, -84.39], [41.85, -87.65], [47.61, -122.33], [34.05, -118.24],
  [45.52, -122.68], [30.27, -97.74], [29.76, -95.37], [42.36, -71.06],
  [38.91, -77.04], [43.70, -79.40], [45.50, -73.57], [49.25, -123.12],
  [55.68, 12.57], [60.39, 5.32], [59.91, 10.75], [60.17, 24.94],
  [56.95, 24.11], [54.69, 25.28], [53.90, 27.57], [50.08, 14.44],
  [48.21, 16.37], [47.81, 13.03], [46.95, 7.45], [46.20, 6.15],
];

type WorldTopo = Topology<{ land: GeometryCollection }>;

const toRad = (d: number) => (d * Math.PI) / 180;

const project = (
  lat: number, lon: number,
  rotY: number, cx: number, cy: number, r: number
): { x: number; y: number; visible: boolean } => {
  const φ = toRad(lat);
  const λ = toRad(lon) - rotY;
  const cosφ = Math.cos(φ);
  const visible = cosφ * Math.cos(λ) > 0;
  return {
    x: cx + r * cosφ * Math.sin(λ),
    y: cy - r * Math.sin(φ),
    visible,
  };
};

const drawLand = (
  ctx: CanvasRenderingContext2D,
  coords: [number, number][][][],
  rotY: number, cx: number, cy: number, r: number
) => {
  for (const polygon of coords) {
    ctx.beginPath();
    let drew = false;
    for (const ring of polygon) {
      // Use the ring centroid to decide visibility — checking every vertex is
      // too aggressive and silently drops large polygons (Europe, USA) that
      // have any edge point past the terminator. The clip circle contains any
      // partial overflow from polygons near the edge.
      const n = ring.length;
      let sumLon = 0, sumLat = 0;
      for (const [lon, lat] of ring) { sumLon += lon; sumLat += lat; }
      if (!project(sumLat / n, sumLon / n, rotY, cx, cy, r).visible) continue;

      const pts = ring.map(([lon, lat]) => project(lat, lon, rotY, cx, cy, r));
      let first = true;
      for (const { x, y } of pts) {
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      drew = true;
    }
    if (drew) ctx.fill();
  }
};

export const HeroGlobe = memo(() => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const rotRef = useRef(0);
  const topoRef = useRef<[number, number][][][]>([]);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const topo = (await import("world-atlas/land-110m.json")) as unknown as WorldTopo;
      const geo = feature(topo, topo.objects.land);
      const polygons: [number, number][][][] = [];
      for (const f of geo.features) {
        const g = f.geometry;
        if (g.type === "Polygon")
          polygons.push(g.coordinates as unknown as [number, number][][]);
        else if (g.type === "MultiPolygon")
          polygons.push(...(g.coordinates as unknown as [number, number][][][]).map(p => p));
      }
      if (!cancelled) topoRef.current = polygons;
    };

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let W = 0, H = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      if (!W || !H) { rafRef.current = requestAnimationFrame(draw); return; }

      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const r = Math.min(W, H) * 0.44;

      const isLight = themeRef.current === "light";

      // Outer glow
      const grd = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.1);
      grd.addColorStop(0, isLight ? "rgba(249,115,22,0.08)" : "rgba(126,184,255,0.06)");
      grd.addColorStop(1, isLight ? "rgba(249,115,22,0)" : "rgba(126,184,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // Ocean disc
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const ocean = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
      ocean.addColorStop(0, isLight ? "rgba(255,253,247,1)" : "rgba(22,27,34,1)");
      ocean.addColorStop(1, isLight ? "rgba(243,237,224,1)" : "rgba(13,17,23,1)");
      ctx.fillStyle = ocean;
      ctx.fill();

      // Land
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = isLight ? "rgba(216,207,189,0.9)" : "rgba(48,54,61,0.9)";
      if (topoRef.current.length > 0) {
        drawLand(ctx, topoRef.current, rotRef.current, cx, cy, r);
      }
      ctx.restore();

      // Globe border
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = isLight ? "rgba(74,74,74,0.4)" : "rgba(48,54,61,0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Stargazer dots
      for (const [lat, lon] of STAR_POINTS) {
        const { x, y, visible } = project(lat, lon, rotRef.current, cx, cy, r);
        if (!visible) continue;
        // depth fade based on z
        const z = Math.cos(toRad(lat)) * Math.cos(toRad(lon) - rotRef.current);
        const alpha = 0.4 + 0.6 * Math.max(0, z);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = isLight
          ? `rgba(184,84,26,${alpha.toFixed(2)})`
          : `rgba(126,184,255,${alpha.toFixed(2)})`;
        ctx.fill();
      }

      // Subtle atmosphere rim
      const rim = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r);
      rim.addColorStop(0, isLight ? "rgba(249,115,22,0)" : "rgba(126,184,255,0)");
      rim.addColorStop(1, isLight ? "rgba(249,115,22,0.10)" : "rgba(126,184,255,0.08)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = rim;
      ctx.fill();

      rotRef.current += 0.003;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      aria-hidden="true"
    />
  );
});

HeroGlobe.displayName = "HeroGlobe";
