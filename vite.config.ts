import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const symbol = url.searchParams.get("symbol") ?? "^GSPC";
          const range = url.searchParams.get("range") ?? "5d";
          const interval = url.searchParams.get("interval") ?? "15m";
          return `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(
            range,
          )}&interval=${encodeURIComponent(interval)}`;
        },
      },
      "/api/search": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const query = url.searchParams.get("q") ?? "";
          return `/v1/finance/search?q=${encodeURIComponent(
            query,
          )}&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
        },
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
