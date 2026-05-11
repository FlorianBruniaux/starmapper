import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: "chrome107",
    outDir: "dist",
    emptyOutDir: true,
    // Inline small assets to avoid separate chunk files
    assetsInlineLimit: 0,
  },
});
