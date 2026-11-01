import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The game server (apps/server, `pnpm dev`) listens on PORT, default 3000.
// The client calls `/api/...`; the dev proxy strips the prefix, so server
// routes stay unprefixed (`/health`, `/games/:id/ws`, ...). See decisions.md.
const server = process.env.SKIMJOB_SERVER ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: server,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, "") || "/",
      },
    },
  },
});
