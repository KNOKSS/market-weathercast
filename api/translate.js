export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") || "").trim();

    if (!query) {
      return Response.json({ error: "q is required" }, { status: 400 });
    }
    if (query.length > 260) {
      return Response.json({ error: "headline is too long" }, { status: 400 });
    }

    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", query);
    url.searchParams.set("langpair", "en|ko");

    try {
      const upstream = await fetch(url, {
        headers: {
          "user-agent": "market-weather-pwa/0.1",
          accept: "application/json",
        },
      });
      if (!upstream.ok) {
        return Response.json({ error: "translation unavailable" }, { status: upstream.status });
      }

      const payload = await upstream.json();
      const translatedText = payload?.responseData?.translatedText;
      if (typeof translatedText !== "string" || !translatedText.trim()) {
        return Response.json({ error: "empty translation" }, { status: 502 });
      }

      return Response.json(
        { translatedText: translatedText.trim() },
        { headers: { "cache-control": "s-maxage=86400, stale-while-revalidate=604800" } },
      );
    } catch {
      return Response.json({ error: "translation request failed" }, { status: 502 });
    }
  },
};
