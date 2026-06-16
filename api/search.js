export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query) {
      return Response.json({ error: "q is required" }, { status: 400 });
    }

    const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", "10");
    url.searchParams.set("newsCount", "0");
    url.searchParams.set("enableFuzzyQuery", "true");

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
          "cache-control": "s-maxage=120, stale-while-revalidate=600",
        },
      });
    } catch {
      return Response.json({ error: "symbol search failed" }, { status: 502 });
    }
  },
};
