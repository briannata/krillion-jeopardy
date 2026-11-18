import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The client talks to the game server on :8787. In dev, Vite proxies both the
 * REST routes and the WebSocket so the browser only ever sees one origin.
 */
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on the LAN, not just localhost: it is a party game, so the phones
    // testing it are other devices on the same Wi-Fi. Only :5173 needs exposing —
    // the game server stays on localhost behind the proxy below.
    host: true,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/ws": { target: "ws://localhost:8787", ws: true },
    },
  },
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
