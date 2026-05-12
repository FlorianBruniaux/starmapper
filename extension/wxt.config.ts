import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "StarMapper",
    description: "Map the stargazers of any GitHub repository on an interactive world map.",
    version: "1.0.0",
    permissions: ["tabs", "contextMenus", "storage"],
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
