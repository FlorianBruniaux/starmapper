// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

"use client";

import { useEffect } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

const sendVital = (metric: Metric) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[CWV] ${metric.name}`, Math.round(metric.value), metric.rating);
  }
  // 10% sampling in production to keep log volume low
  if (process.env.NODE_ENV === "production" && Math.random() > 0.1) return;

  void fetch("/api/vitals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: metric.name,
      value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
      rating: metric.rating,
      delta: Math.round(metric.delta),
      id: metric.id,
      navigationType: metric.navigationType,
      path: window.location.pathname,
    }),
    keepalive: true,
  });
};

export const VitalsReporter = () => {
  useEffect(() => {
    onCLS(sendVital);
    onFCP(sendVital);
    onINP(sendVital);
    onLCP(sendVital);
    onTTFB(sendVital);
  }, []);

  return null;
};
