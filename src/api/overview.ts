import type { Candle } from "../types/market";
import { fetchWithTimeout } from "./fetchWithTimeout";

export type DashboardCategory = "index" | "pulse";

export interface DashboardMarketDefinition {
  id: string;
  label: string;
  shortLabel: string;
  remoteSymbol: string;
  category: DashboardCategory;
  unit?: string;
}

export interface DashboardQuote extends DashboardMarketDefinition {
  candles: Candle[];
  currentPrice: number | null;
  dayChangePercent: number | null;
  status: "live" | "error";
}

export const DASHBOARD_MARKETS: DashboardMarketDefinition[] = [
  { id: "KOSPI", label: "KOSPI", shortLabel: "KOSPI", remoteSymbol: "^KS11", category: "index" },
  { id: "NIKKEI", label: "Nikkei 225", shortLabel: "Nikkei", remoteSymbol: "^N225", category: "index" },
  { id: "EUROSTOXX", label: "Euro Stoxx 50", shortLabel: "Stoxx 50", remoteSymbol: "^STOXX50E", category: "index" },
  { id: "DXY", label: "달러 인덱스", shortLabel: "DXY", remoteSymbol: "DX-Y.NYB", category: "pulse" },
  { id: "US10Y", label: "미국 10년물", shortLabel: "US 10Y", remoteSymbol: "^TNX", category: "pulse", unit: "%" },
  { id: "USDKRW", label: "원·달러", shortLabel: "USD/KRW", remoteSymbol: "KRW=X", category: "pulse", unit: "원" },
  { id: "GOLD", label: "금 선물", shortLabel: "Gold", remoteSymbol: "GC=F", category: "pulse" },
  { id: "WTI", label: "서부텍사스유", shortLabel: "WTI", remoteSymbol: "CL=F", category: "pulse" },
];

interface YahooDailyResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

function parseDailyCandles(payload: YahooDailyResponse): Candle[] {
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) {
    return [];
  }

  return result.timestamp.flatMap((time, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if ([open, high, low, close].some((value) => value === null || value === undefined)) {
      return [];
    }
    return [{
      time: time * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(quote.volume?.[index] ?? 0),
    }];
  });
}

export async function fetchDashboardQuote(
  definition: DashboardMarketDefinition,
): Promise<DashboardQuote> {
  const url = `/api/yahoo?symbol=${encodeURIComponent(definition.remoteSymbol)}&range=1mo&interval=1d&_=${Date.now()}`;
  try {
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) {
      throw new Error(`Yahoo ${response.status}`);
    }
    const candles = parseDailyCandles((await response.json()) as YahooDailyResponse).slice(-6);
    if (candles.length < 2) {
      throw new Error("Daily data unavailable");
    }
    const current = candles.at(-1)!.close;
    const previous = candles.at(-2)!.close;
    return {
      ...definition,
      candles,
      currentPrice: current,
      dayChangePercent: ((current - previous) / previous) * 100,
      status: "live",
    };
  } catch {
    return {
      ...definition,
      candles: [],
      currentPrice: null,
      dayChangePercent: null,
      status: "error",
    };
  }
}

export async function fetchDashboardQuotes(
  definitions: DashboardMarketDefinition[] = DASHBOARD_MARKETS,
): Promise<DashboardQuote[]> {
  const quotes: DashboardQuote[] = [];
  for (let index = 0; index < definitions.length; index += 3) {
    const batch = definitions.slice(index, index + 3);
    quotes.push(...(await Promise.all(batch.map(fetchDashboardQuote))));
    if (index + 3 < definitions.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }
  return quotes;
}
