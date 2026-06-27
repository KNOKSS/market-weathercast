import { scoreMarket } from "../../src/engine/weatherScore";
import { rsi, sma } from "../../src/engine/indicators";
import type { MarketData, MarketSymbol, WeatherScore } from "../../src/types/market";
import type {
  AssetDefinition,
  BacktestObservation,
  BacktestSplit,
  HistoricalCandle,
} from "./types";

function percentChange(current: number, previous: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function splitForIndex(index: number, total: number, train: number, validation: number): BacktestSplit {
  if (index < Math.floor(total * train)) return "train";
  if (index < Math.floor(total * (train + validation))) return "validation";
  return "test";
}

function marketSymbol(asset: AssetDefinition): MarketSymbol {
  return {
    id: asset.id,
    label: asset.label,
    shortLabel: asset.id,
    kind: asset.kind,
    source: asset.source,
    remoteSymbol: asset.remoteSymbol,
    description: "Historical daily replay",
  };
}

export function scoreAt(
  asset: AssetDefinition,
  candles: HistoricalCandle[],
  index: number,
): WeatherScore {
  const intradayProxy = candles.slice(Math.max(0, index - 95), index + 1);
  const dailyWindow = candles.slice(Math.max(0, index - 29), index + 1);
  const previous = candles[index - 1];
  const current = candles[index];
  const data: MarketData = {
    symbol: marketSymbol(asset),
    candles: intradayProxy,
    dailyCandles: dailyWindow,
    dayChangePercent: previous ? percentChange(current.close, previous.close) : null,
    status: "live",
    sourceLabel: `${asset.source} historical daily replay`,
  };
  return scoreMarket(data);
}

function maxDrawdown(candles: HistoricalCandle[], index: number, horizon: number): number {
  const base = candles[index].close;
  const futureLow = Math.min(...candles.slice(index + 1, index + horizon + 1).map((candle) => candle.low));
  return percentChange(futureLow, base);
}

export function replayAsset(
  asset: AssetDefinition,
  candles: HistoricalCandle[],
  minimumHistory: number,
  split: { train: number; validation: number; test: number },
): BacktestObservation[] {
  const raw: Omit<BacktestObservation, "split">[] = [];
  const lastUsableIndex = candles.length - 6;

  for (let index = minimumHistory - 1; index <= lastUsableIndex; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const next = candles[index + 1];
    const closes20 = candles.slice(Math.max(0, index - 19), index + 1).map((candle) => candle.close);
    const historyForRsi = candles.slice(Math.max(0, index - 30), index + 1);
    const score = scoreAt(asset, candles, index);
    const movingAverage20 = sma(closes20, 20) ?? current.close;
    const nextTrueRange = Math.max(
      next.high - next.low,
      Math.abs(next.high - current.close),
      Math.abs(next.low - current.close),
    );

    raw.push({
      assetId: asset.id,
      assetLabel: asset.label,
      role: asset.role,
      date: current.date,
      close: round(current.close),
      previousDayReturn: round(percentChange(current.close, previous.close)),
      momentum5: round(percentChange(current.close, candles[index - 5].close)),
      aboveSma20: current.close >= movingAverage20,
      score: {
        temperature: score.temperature,
        rainChance: score.rainChance,
        ultraviolet: score.ultraviolet,
        wind: score.wind,
        weather: score.label,
        rsi: score.rsi ?? rsi(historyForRsi),
        atrPercent: score.atrPercent,
        volumeRatio: score.volumeRatio,
        trendScore: score.trendScore,
        momentumScore: score.momentumScore,
        volatilityScore: score.volatilityScore,
        activityScore: score.activityScore,
        daily5Change: score.daily5Change,
        daily20Change: score.daily20Change,
        confidence: score.confidence,
      },
      outcomes: {
        return1: round(percentChange(candles[index + 1].close, current.close)),
        return3: round(percentChange(candles[index + 3].close, current.close)),
        return5: round(percentChange(candles[index + 5].close, current.close)),
        maxDrawdown3: round(maxDrawdown(candles, index, 3)),
        maxDrawdown5: round(maxDrawdown(candles, index, 5)),
      },
      nextDayRange: round(((next.high - next.low) / current.close) * 100),
      nextDayTrueRange: round((nextTrueRange / current.close) * 100),
    });
  }

  return raw.map((observation, index) => ({
    ...observation,
    split: splitForIndex(index, raw.length, split.train, split.validation),
  }));
}

