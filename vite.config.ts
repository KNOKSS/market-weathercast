import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api/yahoo": {
        target: "https://market-weathercast.vercel.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const symbol = url.searchParams.get("symbol") ?? "^GSPC";
          const range = url.searchParams.get("range") ?? "5d";
          const interval = url.searchParams.get("interval") ?? "15m";
          return `/api/yahoo?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(
            range,
          )}&interval=${encodeURIComponent(interval)}`;
        },
      },
      "/api/search": {
        target: "https://market-weathercast.vercel.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const query = url.searchParams.get("q") ?? "";
          return `/api/search?q=${encodeURIComponent(
            query,
          )}`;
        },
      },
      "/api/news": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        secure: true,
        headers: {
          "user-agent": "market-weather-pwa/0.1",
          accept: "application/json",
        },
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const query = url.searchParams.get("q") ?? "stock market";
          const count = url.searchParams.get("count") ?? "8";
          return `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${encodeURIComponent(count)}&enableFuzzyQuery=false`;
        },
      },
      "/api/translate": {
        target: "https://api.mymemory.translated.net",
        changeOrigin: true,
        secure: true,
        headers: {
          "user-agent": "market-weather-pwa/0.1",
          accept: "application/json",
        },
        rewrite: (path) => {
          const url = new URL(path, "http://localhost");
          const query = url.searchParams.get("q") ?? "";
          return `/get?q=${encodeURIComponent(query)}&langpair=en%7Cko`;
        },
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
