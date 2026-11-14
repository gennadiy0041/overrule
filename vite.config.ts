import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Where the Bun server runs in development (override with API_ORIGIN).
const API = process.env.API_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    // The server reads the manifest to link this stylesheet from server-rendered pages.
    manifest: true,
  },
  server: {
    port: 5173,
    // In development the Bun server owns the API and the server-rendered pages.
    proxy: Object.fromEntries(
      ["/api", "/will-ai-replace", "/r/", "/metrics", "/sitemap.xml", "/robots.txt", "/og"].map((path) => [path, API]),
    ),
  },
});
