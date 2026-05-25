// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "StarMapper",
    description: "Map the stargazers of any GitHub repository on an interactive world map.",
    version: "1.1.0",
    permissions: ["activeTab", "contextMenus", "storage"],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    host_permissions: ["https://github.com/*"],
    icons: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
    action: {
      default_title: "StarMapper",
      default_icon: {
        16: "icons/icon16.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
      },
    },
  },
});
