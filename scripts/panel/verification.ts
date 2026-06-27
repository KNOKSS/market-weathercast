import type { HistoricalCandle } from "../backtest/types";
import type { DatasetAssetDefinition } from "../dataset/types";
import { computeBaseSeries } from "./features";
import type { BaseSnapshot, PanelRow } from "./types";

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}

export function verifyAssetPanel(
  asset: DatasetAssetDefinition,
  candles: HistoricalCandle[],
  snapshots: BaseSnapshot[],
  rows: PanelRow[],
): Record<string, boolean | number | string> {
  const prefix = asset.id;
  const candleIndex = new Map(candles.map((candle, index) => [candle.date, index]));
  const labelAlignment = rows.every((row) => {
    const index = candleIndex.get(row.date);
    if (index === undefined) return false;
    const expected = (candles[index + 1].close / candles[index].close - 1) * 100;
    return closeEnough(expected, row.labels.return1);
  });
  const chronology = rows.every((row, index) => index === 0 || row.date > rows[index - 1].date);
  const contextTiming = rows.every((row) => Object.entries(row.contextAsOf).every(([id, sourceDate]) => {
    if (sourceDate === null) return true;
    if (id === "BTCUSDT_PRIOR") return sourceDate < row.date;
    return sourceDate <= row.date;
  }));
  const finiteOwnFeatures = rows.every((row) => Object.entries(row.features)
    .filter(([key]) => !["spy", "vix", "tlt", "ief", "hyg", "uup", "gld", "dbc", "btc", "sector", "context"].some((prefixKey) => key.toLowerCase().startsWith(prefixKey)))
    .every(([, value]) => value === null || Number.isFinite(value)));
  const selected = rows[Math.floor(rows.length / 2)];
  let truncationInvariant = false;
  if (selected) {
    const index = candleIndex.get(selected.date)!;
    const truncated = computeBaseSeries(asset, candles.slice(0, index + 1));
    const recomputed = truncated.at(-1)!;
    truncationInvariant = JSON.stringify(recomputed.features) === JSON.stringify(snapshots[index].features)
      && JSON.stringify(recomputed.baseline) === JSON.stringify(snapshots[index].baseline);
  }
  return {
    [`${prefix}.rows`]: rows.length,
    [`${prefix}.chronological`]: chronology,
    [`${prefix}.tPlus1LabelAlignment`]: labelAlignment,
    [`${prefix}.contextNeverAfterTarget`]: contextTiming,
    [`${prefix}.featuresFiniteOrExplicitNull`]: finiteOwnFeatures,
    [`${prefix}.pastOnlyTruncationInvariant`]: truncationInvariant,
  };
}
