import type { HistoricalCandle } from "../backtest/types";
import type { DatasetAssetDefinition } from "../dataset/types";
import { contextAt, type ContextEnvironment } from "./context";
import { PANEL_WARMUP } from "./features";
import type { BaseSnapshot, InferenceRow, PanelLabels, PanelRow, ShadowResolvedRow } from "./types";

const REQUIRED_OWN_FEATURES = ["return1", "return5", "return20", "smaGap20", "smaGap200", "rsi14", "atr14Percent", "realizedVol20Percent", "downsideVol20Percent", "drawdown63Percent", "volumeRatio20", "return1Z252", "atrPercentile252", "realizedVolPercentile252", "volumePercentile252", "sma20GapPercentile252", "historicalReturn10thPercentile756"];

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentChange(current: number, previous: number): number {
  return previous === 0 ? 0 : (current / previous - 1) * 100;
}

function futureReturn(candles: HistoricalCandle[], index: number, horizon: number): number {
  return percentChange(candles[index + horizon].close, candles[index].close);
}

function maxDrawdown(candles: HistoricalCandle[], index: number, horizon: number): number {
  const futureLow = Math.min(...candles.slice(index + 1, index + horizon + 1).map((candle) => candle.low));
  return percentChange(futureLow, candles[index].close);
}

function futureSpyReturn(spyCandles: HistoricalCandle[], date: string, horizon: number): number | null {
  const index = spyCandles.findIndex((candle) => candle.date === date);
  return index >= 0 && index + horizon < spyCandles.length ? futureReturn(spyCandles, index, horizon) : null;
}

function binary(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function buildInferenceRow(
  asset: DatasetAssetDefinition,
  snapshot: BaseSnapshot,
  environment: ContextEnvironment,
): InferenceRow | null {
  if (!snapshot.baseline || !REQUIRED_OWN_FEATURES.every((key) => snapshot.features[key] !== null && Number.isFinite(snapshot.features[key]))) return null;
  const context = contextAt(asset, snapshot.date, environment);
  return {
    assetId: asset.id,
    date: snapshot.date,
    forecastPolicy: asset.calendar === "24/7" ? "UTC_DAILY_CLOSE" : "US_CLOSE",
    assetClass: asset.assetClass,
    sector: asset.sector,
    fullContextReady: context.fullContextReady,
    contextAsOf: context.contextAsOf,
    features: { ...snapshot.features, ...context.features },
    baseline: snapshot.baseline,
  };
}

export function buildRecentShadowRows(
  asset: DatasetAssetDefinition,
  candles: HistoricalCandle[],
  snapshots: BaseSnapshot[],
  environment: ContextEnvironment,
  lookback = 400,
): ShadowResolvedRow[] {
  const rows: ShadowResolvedRow[] = [];
  const firstIndex = Math.max(PANEL_WARMUP, candles.length - lookback - 1);
  for (let index = firstIndex; index < candles.length - 1; index += 1) {
    const row = buildInferenceRow(asset, snapshots[index], environment);
    if (!row) continue;
    const next = candles[index + 1];
    const nextTrueRange = Math.max(next.high - next.low, Math.abs(next.high - candles[index].close), Math.abs(next.low - candles[index].close));
    const return1 = percentChange(next.close, candles[index].close);
    rows.push({
      ...row,
      labels: {
        up1: binary(return1 > 0),
        nextDayTrueRange: round(nextTrueRange / candles[index].close * 100),
        historicalTailEvent1: binary(return1 <= snapshots[index].features.historicalReturn10thPercentile756!),
      },
    });
  }
  return rows;
}

export function buildPanelRows(
  asset: DatasetAssetDefinition,
  candles: HistoricalCandle[],
  snapshots: BaseSnapshot[],
  environment: ContextEnvironment,
  spyCandles: HistoricalCandle[],
): PanelRow[] {
  const rows: PanelRow[] = [];
  const lastIndex = candles.length - 6;
  for (let index = PANEL_WARMUP; index <= lastIndex; index += 1) {
    const snapshot = snapshots[index];
    if (!snapshot.baseline) continue;
    if (!REQUIRED_OWN_FEATURES.every((key) => snapshot.features[key] !== null && Number.isFinite(snapshot.features[key]))) continue;
    const context = contextAt(asset, snapshot.date, environment);
    const return1 = futureReturn(candles, index, 1);
    const return3 = futureReturn(candles, index, 3);
    const return5 = futureReturn(candles, index, 5);
    const spy1 = asset.calendar === "US" ? futureSpyReturn(spyCandles, snapshot.date, 1) : null;
    const spy3 = asset.calendar === "US" ? futureSpyReturn(spyCandles, snapshot.date, 3) : null;
    const spy5 = asset.calendar === "US" ? futureSpyReturn(spyCandles, snapshot.date, 5) : null;
    const next = candles[index + 1];
    const nextTrueRange = Math.max(next.high - next.low, Math.abs(next.high - candles[index].close), Math.abs(next.low - candles[index].close));
    const drawdown3 = maxDrawdown(candles, index, 3);
    const drawdown5 = maxDrawdown(candles, index, 5);
    const atr = snapshot.features.atr14Percent!;
    const tailThreshold = snapshot.features.historicalReturn10thPercentile756!;
    const labels: PanelLabels = {
      return1: round(return1), return3: round(return3), return5: round(return5),
      up1: binary(return1 > 0), up3: binary(return3 > 0), up5: binary(return5 > 0),
      spyExcessReturn1: spy1 === null ? null : round(return1 - spy1),
      spyExcessReturn3: spy3 === null ? null : round(return3 - spy3),
      spyExcessReturn5: spy5 === null ? null : round(return5 - spy5),
      nextDayRange: round((next.high - next.low) / candles[index].close * 100),
      nextDayTrueRange: round(nextTrueRange / candles[index].close * 100),
      maxDrawdown3: round(drawdown3), maxDrawdown5: round(drawdown5),
      drop1: binary(return1 <= -1), drop2: binary(return1 <= -2), drop3: binary(return1 <= -3),
      historicalTailEvent1: binary(return1 <= tailThreshold),
      correction1AtrWithin3: binary(drawdown3 <= -atr),
      correction1AtrWithin5: binary(drawdown5 <= -atr),
    };
    rows.push({
      assetId: asset.id,
      date: snapshot.date,
      forecastPolicy: asset.calendar === "24/7" ? "UTC_DAILY_CLOSE" : "US_CLOSE",
      assetClass: asset.assetClass,
      sector: asset.sector,
      fullContextReady: context.fullContextReady,
      contextAsOf: context.contextAsOf,
      features: { ...snapshot.features, ...context.features },
      baseline: snapshot.baseline,
      labels,
    });
  }
  return rows;
}
