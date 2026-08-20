import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// BASE is "/" on Cloudflare Pages / Netlify / Vercel.
// For GitHub Pages the app is served from /<repo>/, so set BASE=/lift-log/ in that build.
const base = process.env.BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",          // never swap code mid-session — see docs/lift-log-design.md
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Lift Log",
        short_name: "Lift Log",
        description: "One lift a day. Five exercises, five minutes of thinking, none of it yours.",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#EDF1F6",
        theme_color: "#17539B",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        cleanupOutdatedCaches: true
      }
    })
  ]
});
