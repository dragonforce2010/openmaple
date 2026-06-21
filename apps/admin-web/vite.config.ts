import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.MAPLE_API_PROXY_TARGET || "http://127.0.0.1:27951";
const webPort = Number(process.env.MAPLE_WEB_PORT || process.env.PORT || 8080);

export default defineConfig({
  root: "apps/admin-web",
  plugins: [react()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: webPort,
    proxy: {
      "/health": apiProxyTarget,
      "/v1": apiProxyTarget
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 8080
  }
});
