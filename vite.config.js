import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    /* The list of every file the build produced, at a plain address the
       service worker can read (`public/sw.js`) to keep them all for offline
       use — including the screens that load on demand. */
    manifest: "asset-manifest.json",
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://api:3001",
        changeOrigin: true,
      },
    },
  },
});
