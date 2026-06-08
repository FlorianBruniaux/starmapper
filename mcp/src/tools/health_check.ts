// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>
import { BASE_URL, hasGhToken } from "../client.js";

export const healthCheck = async (): Promise<string> => {
  let apiStatus: "ok" | "unreachable" = "unreachable";
  let latencyMs: number | null = null;

  try {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/api/repo-info?owner=vercel&repo=next.js`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    latencyMs = Math.round(performance.now() - start);
    if (res.ok || res.status === 404) apiStatus = "ok";
  } catch {
    // timeout or network error
  }

  const tokenStatus = hasGhToken()
    ? "set (your own GitHub quota)"
    : "not set — uses StarMapper shared quota (5,000 pts/hr). Add GITHUB_TOKEN to mcp.json.";

  const lines = [
    `## StarMapper MCP health check`,
    ``,
    `API (${BASE_URL}): ${apiStatus === "ok" ? `ok (${latencyMs}ms)` : "unreachable — check your network or STARMAPPER_BASE_URL"}`,
    `GITHUB_TOKEN: ${tokenStatus}`,
    `STARMAPPER_BASE_URL: ${process.env.STARMAPPER_BASE_URL ? process.env.STARMAPPER_BASE_URL : "default (https://starmapper.bruniaux.com)"}`,
  ];

  if (apiStatus === "unreachable") {
    lines.push(``, `Tip: override the endpoint with STARMAPPER_BASE_URL=http://localhost:3000 for local dev.`);
  }

  return lines.join("\n");
};
