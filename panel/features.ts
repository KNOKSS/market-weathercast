import { atrPercent, rsi, sma, volumeRatio } from "../../src/engine/indicators";
import { scoreAt } from "../backtest/replay";
import type { HistoricalCandle } from "../backtest/types";
import type { DatasetAssetDefinition } from "../dataset/types";
import type { BaseSnapshot, FeatureDefinition, NumericFeatures } from "./types";

export const PANEL_WARMUP = 300;

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function percentChange(current: number, previous: number): number {
  return previous === 0 ? 0 : (current / previous - 1) * 100;
}

function change(candles: HistoricalCandle[], index: number, lookback: number): number | null {
  return index >= lookback ? percentChange(candles[index].close, candles[index - lookback].close) : null;
}

function movingAverageGap(candles: HistoricalCandle[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  const movingAverage = sma(candles.slice(index - period + 1, index + 1).map((candle) => candle.close), period);
  return movingAverage ? percentChange(candles[index].close, movingAverage) : null;
}

function realizedVolatility(candles: HistoricalCandle[], index: number, period: number, periodsPerYear: number, downside = false): number | null {
  if (index < period) return null;
  const returns: number[] = [];
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const value = candles[cursor].close / candles[cursor - 1].close - 1;
    returns.push(downside ? Math.min(value, 0) : value);
  }
  const deviation = standardDeviation(returns);
  return deviation === null ? null : deviation * Math.sqrt(periodsPerYear) * 100;
}

function drawdown(candles: HistoricalCandle[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  const peak = Math.max(...candles.slice(index - period + 1, index + 1).map((candle) => candle.close));
  return percentChange(candles[index].close, peak);
}

function historicalValues(snapshots: BaseSnapshot[], index: number, key: string, lookback = 252): number[] {
  return snapshots
    .slice(Math.max(0, index - lookback), index)
    .map((snapshot) => snapshot.features[key])
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function percentile(current: number | null, history: number[]): number | null {
  if (current === null || history.length < 252) return null;
  return history.filter((value) => value <= current).length / history.length * 100;
}

function zScore(current: number | null, history: number[]): number | null {
  if (current === null || history.length < 252) return null;
  const mean = average(history)!;
  const deviation = standardDeviation(history);
  return deviation && deviation > 0 ? (current - mean) / deviation : null;
}

function quantile(values: number[], probability: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[lower + 1] * weight;
}

export function computeBaseSeries(asset: DatasetAssetDefinition, candles: HistoricalCandle[]): BaseSnapshot[] {
  const snapshots: BaseSnapshot[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const recent = candles.slice(Math.max(0, index - 299), index + 1);
    const return1 = change(candles, index, 1);
    const atr14 = atrPercent(recent, 14);
    const vol20 = realizedVolatility(candles, index, 20, asset.periodsPerYear);
    const volume20 = volumeRatio(recent, 20);
    const features: NumericFeatures = {
      return1,
      return5: change(candles, index, 5),
      return20: change(candles, index, 20),
      smaGap5: movingAverageGap(candles, index, 5),
      smaGap20: movingAverageGap(candles, index, 20),
      smaGap50: movingAverageGap(candles, index, 50),
      smaGap200: movingAverageGap(candles, index, 200),
      rsi14: rsi(recent, 14),
      atr14Percent: atr14,
      realizedVol20Percent: vol20,
      downsideVol20Percent: realizedVolatility(candles, index, 20, asset.periodsPerYear, true),
      drawdown63Percent: drawdown(candles, index, 63),
      volumeRatio20: volume20,
      closePercentile252: null,
      return1Z252: null,
      atrPercentile252: null,
      realizedVolPercentile252: null,
      volumePercentile252: null,
      sma20GapPercentile252: null,
      historicalReturn10thPercentile756: null,
    };
    const placeholder: BaseSnapshot = { date: candles[index].date, index, close: candles[index].close, features, baseline: null };
    snapshots.push(placeholder);

    features.return1Z252 = zScore(return1, historicalValues(snapshots, index, "return1"));
    features.closePercentile252 = percentile(
      candles[index].close,
      candles.slice(Math.max(0, index - 252), index).map((candle) => candle.close),
    );
    features.atrPercentile252 = percentile(atr14, historicalValues(snapshots, index, "atr14Percent"));
    features.realizedVolPercentile252 = percentile(vol20, historicalValues(snapshots, index, "realizedVol20Percent"));
    features.volumePercentile252 = percentile(volume20, historicalValues(snapshots, index, "volumeRatio20"));
    features.sma20GapPercentile252 = percentile(features.smaGap20, historicalValues(snapshots, index, "smaGap20"));
    features.historicalReturn10thPercentile756 = quantile(historicalValues(snapshots, index, "return1", 756), 0.1);

    if (index >= 29) {
      const score = scoreAt(asset, candles, index);
      placeholder.baseline = {
        engine: "weatherScore-v0.1-daily-replay",
        temperature: score.temperature,
        rainChance: score.rainChance,
        ultraviolet: score.ultraviolet,
        weather: score.label,
        wind: score.wind,
        trendScore: score.trendScore,
        momentumScore: score.momentumScore,
        volatilityScore: score.volatilityScore,
        activityScore: score.activityScore,
      };
    }
    Object.keys(features).forEach((key) => {
      const value = features[key];
      if (value !== null) features[key] = round(value);
    });
  }
  return snapshots;
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  { name: "return1/5/20", group: "own", unit: "%", description: "자산 자체의 1·5·20기간 종가 수익률", timing: "t 종가 포함", required: true },
  { name: "smaGap5/20/50/200", group: "own", unit: "%", description: "현재 종가와 이동평균의 거리", timing: "t 종가 포함", required: true },
  { name: "rsi14", group: "own", unit: "0-100", description: "14기간 RSI", timing: "t까지", required: true },
  { name: "atr14Percent", group: "own", unit: "%", description: "종가 대비 14기간 ATR", timing: "t까지", required: true },
  { name: "realizedVol20Percent/downsideVol20Percent", group: "own", unit: "% annualized", description: "20기간 전체·하방 실현변동성", timing: "t까지", required: true },
  { name: "drawdown63Percent", group: "own", unit: "%", description: "63기간 고점 대비 낙폭", timing: "t까지", required: true },
  { name: "volumeRatio20", group: "own", unit: "ratio", description: "직전 20기간 평균 대비 t 거래량", timing: "t 종가 확정 후", required: true },
  { name: "*Percentile252 / return1Z252", group: "own", unit: "percentile/z", description: "현재 자산의 직전 252기간 분포로만 정규화", timing: "비교 분포는 t-1까지", required: true },
  { name: "weatherScoreV01", group: "baseline", unit: "mixed", description: "동결 v0.1 일봉 재생 결과; 신규 모델의 기준선일 뿐 정답이 아님", timing: "t까지", required: true },
  { name: "SPY/VIX/rates/credit/USD/gold/commodity", group: "context", unit: "mixed", description: "장 마감 시점에 이용 가능한 시장 국면 특징", timing: "target t보다 늦지 않은 관측", required: false },
  { name: "btcPriorDay*", group: "context", unit: "mixed", description: "미국 장 마감 후에도 완전히 닫힌 BTC 일봉만 사용", timing: "source date < target t", required: false },
  { name: "sectorBreadth*", group: "breadth", unit: "%", description: "11개 장기 섹터 프록시 중 상승·SMA20 상회 비율", timing: "target t보다 늦지 않은 관측", required: false },
];
