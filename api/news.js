export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "stock market";
    const requestedCount = Number(searchParams.get("count") || 8);
    const newsCount = Math.min(10, Math.max(1, Number.isFinite(requestedCount) ? requestedCount : 8));

    const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", query.slice(0, 80));
    url.searchParams.set("quotesCount", "0");
    url.searchParams.set("newsCount", String(newsCount));
    url.searchParams.set("enableFuzzyQuery", "false");

    try {
      const upstream = await fetch(url, {
        headers: {
          "user-agent": "market-weather-pwa/0.1",
          accept: "application/json",
        },
      });

      if (!upstream.ok) {
        return Response.json({ error: "market news unavailable", news: [] }, { status: upstream.status });
      }

      const payload = await upstream.json();
      const news = Array.isArray(payload.news) ? payload.news : [];

      return Response.json(
        { news, fetchedAt: Date.now() },
        {
          headers: {
            "cache-control": "s-maxage=300, stale-while-revalidate=900",
          },
        },
      );
    } catch {
      return Response.json({ error: "market news request failed", news: [] }, { status: 502 });
    }
  },
};
