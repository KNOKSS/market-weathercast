export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol");
    const range = searchParams.get("range") || "5d";
    const interval = searchParams.get("interval") || "15m";

    if (!symbol) {
      return Response.json({ error: "symbol is required" }, { status: 400 });
    }

    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
    url.searchParams.set("range", range);
    url.searchParams.set("interval", interval);

    try {
      const upstream = await fetch(url, {
        headers: {
          "user-agent": "market-weather-pwa/0.1",
          accept: "application/json",
        },
      });

      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store, max-age=0",
          "cdn-cache-control": "no-store",
          "vercel-cdn-cache-control": "no-store",
        },
      });
    } catch {
      return Response.json({ error: "index data request failed" }, { status: 502 });
    }
  },
};
