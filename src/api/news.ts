import { fetchWithTimeout } from "./fetchWithTimeout";

export type NewsCategory = "증시" | "금리·연준" | "기술·AI" | "가상자산" | "원자재" | "글로벌";

export interface MarketNewsItem {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: number;
  imageUrl: string | null;
  relatedTickers: string[];
  category: NewsCategory;
}

interface YahooNewsItem {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  relatedTickers?: string[];
  thumbnail?: {
    resolutions?: Array<{ url?: string; width?: number; height?: number }>;
  };
}

interface YahooNewsResponse {
  news?: YahooNewsItem[];
}

const NEWS_QUERIES = ["^GSPC", "^IXIC", "^TNX", "Ethereum"];
const CACHE_DURATION = 5 * 60 * 1000;
let clientCache: { items: MarketNewsItem[]; fetchedAt: number } | null = null;

function inferCategory(item: YahooNewsItem): NewsCategory {
  const text = `${item.title ?? ""} ${(item.relatedTickers ?? []).join(" ")}`.toLowerCase();
  if (/bitcoin|crypto|ethereum|blockchain|btc|eth-usd|btc-usd/.test(text)) return "가상자산";
  if (/fed|federal reserve|interest rate|treasury|bond|yield|inflation|cpi|powell/.test(text)) return "금리·연준";
  if (/artificial intelligence|\bai\b|nvidia|semiconductor|chip|technology|nasdaq/.test(text)) return "기술·AI";
  if (/oil|gold|crude|commodity|opec|natural gas/.test(text)) return "원자재";
  if (/s&p|dow|stock|equity|wall street|market/.test(text)) return "증시";
  return "글로벌";
}

function selectImage(item: YahooNewsItem): string | null {
  const images = item.thumbnail?.resolutions ?? [];
  return images.find((image) => (image.width ?? 0) >= 300)?.url ?? images[0]?.url ?? null;
}

function normalizeNews(item: YahooNewsItem): MarketNewsItem | null {
  if (!item.title || !item.link || !item.uuid) return null;
  return {
    id: item.uuid,
    title: item.title,
    publisher: item.publisher || "Market News",
    url: item.link,
    publishedAt: (item.providerPublishTime ?? 0) * 1000,
    imageUrl: selectImage(item),
    relatedTickers: (item.relatedTickers ?? []).slice(0, 4),
    category: inferCategory(item),
  };
}

async function fetchNewsQuery(query: string): Promise<MarketNewsItem[]> {
  const response = await fetchWithTimeout(
    `/api/news?q=${encodeURIComponent(query)}&count=8`,
    8000,
  );
  if (!response.ok) throw new Error(`News ${response.status}`);
  const payload = (await response.json()) as YahooNewsResponse;
  return (payload.news ?? []).flatMap((item) => {
    const normalized = normalizeNews(item);
    return normalized && normalized.category !== "글로벌" ? [normalized] : [];
  });
}

export async function fetchMarketNews(force = false): Promise<MarketNewsItem[]> {
  if (!force && clientCache && Date.now() - clientCache.fetchedAt < CACHE_DURATION) {
    return clientCache.items;
  }

  const results = await Promise.allSettled(NEWS_QUERIES.map(fetchNewsQuery));
  const unique = new Map<string, MarketNewsItem>();
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      result.value.forEach((item) => unique.set(item.id, item));
    }
  });

  const sorted = [...unique.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 16);

  if (sorted.length === 0) throw new Error("No market news available");
  clientCache = { items: sorted, fetchedAt: Date.now() };
  return sorted;
}
