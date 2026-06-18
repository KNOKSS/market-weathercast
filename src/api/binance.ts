import type { Candle, MarketData, MarketSymbol } from "../types/market";
import { fetchWithTimeout } from "./fetchWithTimeout";
import { createMockCandles } from "./mockData";

const BINANCE_BASE_URL = "https://api.binance.com/api/v3";

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

function parseBinanceCandles(rows: BinanceKline[]): Candle[] {
  return rows
    .map((row) => ({
      time: row[0],
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite),
    );
}

export async function fetchBinanceMarket(symbol: MarketSymbol): Promise<MarketData> {
  const url = `${BINANCE_BASE_URL}/klines?symbol=${encodeURIComponent(
    symbol.remoteSymbol,
  )}&interval=1m&limit=96`;

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Binance ${response.status}`);
    }

    const rows = (await response.json()) as BinanceKline[];
    const candles = parseBinanceCandles(rows);
    if (candles.length < 30) {
      return {
        symbol,
        candles: createMockCandles(symbol),
        status: "mock",
        sourceLabel: "샘플 데이터",
        message: "Binance 데이터가 부족해 샘플로 표시 중입니다.",
      };
    }

    return {
      symbol,
      candles,
      status: "live",
      sourceLabel: "Binance",
    };
  } catch (error) {
    return {
      symbol,
      candles: createMockCandles(symbol),
      status: "mock",
      sourceLabel: "샘플 데이터",
      message: "Binance 연결이 불안정해 샘플로 표시 중입니다.",
    };
  }
}
