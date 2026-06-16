import type { Candle } from "../types/market";
import { average } from "../utils/math";

export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) {
    return null;
  }

  return average(values.slice(-period));
}

export function rsi(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) {
    return null;
  }

  const closes = candles.map((candle) => candle.close);
  let gains = 0;
  let losses = 0;

  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

export function atrPercent(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) {
    return null;
  }

  const trueRanges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    );
  }

  const lastClose = candles.at(-1)?.close;
  if (!lastClose) {
    return null;
  }

  return (average(trueRanges) / lastClose) * 100;
}

export function changePercent(candles: Candle[], lookback: number): number | null {
  if (candles.length <= lookback) {
    return null;
  }

  const current = candles.at(-1)?.close;
  const previous = candles.at(-1 - lookback)?.close;
  if (!current || !previous) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

export function volumeRatio(candles: Candle[], period = 20): number | null {
  if (candles.length <= period) {
    return null;
  }

  const recentVolume = candles.at(-1)?.volume ?? 0;
  const baseline = average(candles.slice(-period - 1, -1).map((candle) => candle.volume));
  if (baseline <= 0) {
    return null;
  }

  return recentVolume / baseline;
}

export function consecutiveGreenCandles(candles: Candle[], limit = 8): number {
  const recent = candles.slice(-limit);
  let count = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].close > recent[index].open) {
      count += 1;
    } else {
      break;
    }
  }

  return count;
}
