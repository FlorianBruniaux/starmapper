// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StarMapper — GitHub Stargazers Map",
    short_name: "StarMapper",
    description:
      "Map your GitHub stargazers worldwide. Country breakdowns, influential developer finder, and Organic Score to detect fake stars.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    icons: [
      { src: "/logo128.png", sizes: "128x128", type: "image/png" },
      { src: "/logo256.png", sizes: "256x256", type: "image/png" },
      { src: "/logo512.png", sizes: "512x512", type: "image/png" },
      { src: "/logo.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
