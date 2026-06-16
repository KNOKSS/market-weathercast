import type { Candle, MarketSymbol } from "../types/market";
import { hashText } from "../utils/math";

const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 105000,
  ETHUSDT: 3600,
  SOLUSDT: 165,
  SP500: 5900,
  NASDAQ: 19000,
};

export function createMockCandles(symbol: MarketSymbol, count = 96): Candle[] {
  const seed = hashText(symbol.id);
  const base = BASE_PRICE[symbol.id] ?? 100;
  const now = Date.now();
  const interval = 15 * 60 * 1000;
  let price = base * (0.97 + (seed % 12) / 100);
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin((index + seed) / 8) * 0.005;
    const pulse = Math.cos((index + seed) / 17) * 0.003;
    const drift = ((seed % 7) - 3) * 0.00018;
    const move = wave + pulse + drift;
    const open = price;
    const close = Math.max(0.01, open * (1 + move));
    const spread = Math.max(open, close) * (0.0025 + ((seed + index) % 9) / 9000);
    const high = Math.max(open, close) + spread;
    const low = Math.max(0.01, Math.min(open, close) - spread);
    const volumeBase = symbol.kind === "crypto" ? 100000 : 800000;
    const volume = volumeBase * (1 + Math.abs(Math.sin((seed + index) / 5)) * 1.6);

    candles.push({
      time: now - (count - index) * interval,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return candles;
}
