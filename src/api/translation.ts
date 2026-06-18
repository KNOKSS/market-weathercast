import { fetchWithTimeout } from "./fetchWithTimeout";
import type { MarketNewsItem } from "./news";

interface TranslationResponse {
  translatedText?: string;
  responseData?: {
    translatedText?: string;
  };
}

const TRANSLATION_CACHE_KEY = "market-weather-news-translations-v1";
const memoryCache = new Map<string, string>();

function loadStoredTranslations() {
  if (memoryCache.size > 0) return;
  try {
    const stored = JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || "{}") as Record<string, string>;
    Object.entries(stored).forEach(([title, translation]) => memoryCache.set(title, translation));
  } catch {
    // Corrupted browser cache should never block the news desk.
  }
}

function saveStoredTranslations() {
  try {
    const recent = [...memoryCache.entries()].slice(-80);
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // Storage may be unavailable in private browsing; memory cache still works.
  }
}

function isUsableTranslation(original: string, translated: string | undefined): translated is string {
  if (!translated) return false;
  const trimmed = translated.trim();
  return (
    trimmed.length > 2 &&
    trimmed.toLowerCase() !== original.trim().toLowerCase() &&
    !/mymemory warning|quota|translated\.net/i.test(trimmed) &&
    /[가-힣]/.test(trimmed)
  );
}

async function translateHeadline(title: string): Promise<string | null> {
  loadStoredTranslations();
  const cached = memoryCache.get(title);
  if (cached) return cached;
  if (/[가-힣]/.test(title)) return title;

  try {
    const response = await fetchWithTimeout(`/api/translate?q=${encodeURIComponent(title.slice(0, 260))}`, 9000);
    if (!response.ok) return null;
    const payload = (await response.json()) as TranslationResponse;
    const translated = payload.translatedText ?? payload.responseData?.translatedText;
    if (!isUsableTranslation(title, translated)) return null;
    const cleaned = translated.trim();
    memoryCache.set(title, cleaned);
    saveStoredTranslations();
    return cleaned;
  } catch {
    return null;
  }
}

export async function translateNewsHeadlines(items: MarketNewsItem[]): Promise<Record<string, string>> {
  const translations: Record<string, string> = {};
  const candidates = items.slice(0, 12);

  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index, index + 4);
    const results = await Promise.all(batch.map(async (item) => ({
      id: item.id,
      translation: await translateHeadline(item.title),
    })));
    results.forEach(({ id, translation }) => {
      if (translation) translations[id] = translation;
    });
  }

  return translations;
}
