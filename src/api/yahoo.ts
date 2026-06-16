import type { Candle, MarketData, MarketSymbol } from "../types/market";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { createMockCandles } from "./mockData";

interface YahooChartResponse {
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
    error?: unknown;
  };
}

function parseYahooCandles(payload: YahooChartResponse): Candle[] {
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];

  if (!quote) {
    return [];
  }

  return timestamps
    .map((time, index) => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      const volume = quote.volume?.[index] ?? 0;

      if ([open, high, low, close].some((value) => value === null || value === undefined)) {
        return null;
      }

      return {
        time: time * 1000,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    })
    .filter((candle): candle is Candle => candle !== null)
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite),
    );
}

export async function fetchYahooMarket(symbol: MarketSymbol): Promise<MarketData> {
  const url = `/api/yahoo?symbol=${encodeURIComponent(symbol.remoteSymbol)}&range=5d&interval=15m`;

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Yahoo ${response.status}`);
    }

    const payload = (await response.json()) as YahooChartResponse;
    const candles = parseYahooCandles(payload).slice(-96);
    if (candles.length < 20) {
      throw new Error("Yahoo response has too few candles");
    }

    return {
      symbol,
      candles,
      status: "live",
      sourceLabel: "Yahoo Finance",
    };
  } catch (error) {
    return {
      symbol,
      candles: createMockCandles(symbol),
      status: "mock",
      sourceLabel: "샘플 데이터",
      message: "지수 데이터 연결이 불안정해 샘플로 표시 중입니다.",
    };
  }
}
