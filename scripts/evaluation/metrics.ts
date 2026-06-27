import type { PanelRow } from "../panel/types";
import type { DirectionMetric, RangeMetric, RiskMetric, ValidationCohort } from "./types";

type DirectionSignal = (row: PanelRow) => boolean;
type RiskSignal = (row: PanelRow) => boolean;

const DIRECTION_SIGNALS: Record<string, DirectionSignal> = {
  "always-up": () => true,
  "previous-day-continuation": (row) => (row.features.return1 ?? 0) > 0,
  "five-day-momentum": (row) => (row.features.return5 ?? 0) > 0,
  "above-sma20": (row) => (row.features.smaGap20 ?? 0) > 0,
  "rsi-above-50": (row) => (row.features.rsi14 ?? 50) >= 50,
  "weather-v0.1-temperature-50": (row) => row.baseline.temperature >= 50,
};

const RISK_SIGNALS: Record<string, RiskSignal> = {
  "weather-v0.1-rain-60": (row) => row.baseline.rainChance >= 60,
  "weather-v0.1-storm": (row) => row.baseline.weather === "태풍경보",
  "atr-percentile-80": (row) => (row.features.atrPercentile252 ?? 0) >= 80,
  "realized-vol-percentile-80": (row) => (row.features.realizedVolPercentile252 ?? 0) >= 80,
  "rain-60-or-atr-80": (row) => row.baseline.rainChance >= 60 || (row.features.atrPercentile252 ?? 0) >= 80,
};

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function roundNullable(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assetGroups(rows: PanelRow[]): Map<string, PanelRow[]> {
  const groups = new Map<string, PanelRow[]>();
  rows.forEach((row) => groups.set(row.assetId, [...(groups.get(row.assetId) ?? []), row]));
  return groups;
}

function confusion(rows: PanelRow[], signal: (row: PanelRow) => boolean, actual: (row: PanelRow) => boolean) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  rows.forEach((row) => {
    const predicted = signal(row);
    const truth = actual(row);
    if (predicted && truth) tp += 1;
    else if (predicted) fp += 1;
    else if (truth) fn += 1;
    else tn += 1;
  });
  const safe = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  const precision = safe(tp, tp + fp);
  const recall = safe(tp, tp + fn);
  const specificity = safe(tn, tn + fp);
  return {
    tp, fp, tn, fn,
    accuracy: safe(tp + tn, rows.length),
    balancedAccuracy: recall !== null && specificity !== null ? (recall + specificity) / 2 : null,
    precision, recall, specificity,
    coverage: safe(tp + fp, rows.length),
    baseRate: safe(tp + fn, rows.length),
    f1: precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null,
  };
}

function assetEqual(values: Array<number | null>): number | null {
  return average(values.filter((value): value is number => value !== null && Number.isFinite(value)));
}

export function directionMetrics(rows: PanelRow[], cohort: ValidationCohort): DirectionMetric[] {
  const groups = assetGroups(rows);
  const output: DirectionMetric[] = [];
  for (const [baseline, signal] of Object.entries(DIRECTION_SIGNALS)) {
    for (const horizon of [1, 3, 5] as const) {
      const perAsset = [...groups.values()].map((assetRows) => {
        const result = confusion(assetRows, signal, (row) => row.labels[`up${horizon}`] === 1);
        const bullishReturns = assetRows.filter(signal).map((row) => row.labels[`return${horizon}`]);
        return { ...result, bullishMeanReturn: average(bullishReturns) };
      });
      output.push({
        baseline, cohort, horizon, assets: groups.size, observations: rows.length,
        accuracy: roundNullable(assetEqual(perAsset.map((metric) => metric.accuracy)) === null ? null : assetEqual(perAsset.map((metric) => metric.accuracy))! * 100),
        balancedAccuracy: roundNullable(assetEqual(perAsset.map((metric) => metric.balancedAccuracy)) === null ? null : assetEqual(perAsset.map((metric) => metric.balancedAccuracy))! * 100),
        precision: roundNullable(assetEqual(perAsset.map((metric) => metric.precision)) === null ? null : assetEqual(perAsset.map((metric) => metric.precision))! * 100),
        recall: roundNullable(assetEqual(perAsset.map((metric) => metric.recall)) === null ? null : assetEqual(perAsset.map((metric) => metric.recall))! * 100),
        specificity: roundNullable(assetEqual(perAsset.map((metric) => metric.specificity)) === null ? null : assetEqual(perAsset.map((metric) => metric.specificity))! * 100),
        bullishCoverage: roundNullable(assetEqual(perAsset.map((metric) => metric.coverage)) === null ? null : assetEqual(perAsset.map((metric) => metric.coverage))! * 100),
        bullishMeanReturn: roundNullable(assetEqual(perAsset.map((metric) => metric.bullishMeanReturn))),
      });
    }
  }
  return output;
}

const RISK_TARGETS = {
  "historical-tail-1d": (row: PanelRow) => row.labels.historicalTailEvent1 === 1,
  "drop-2pct-1d": (row: PanelRow) => row.labels.drop2 === 1,
  "surprise-drawdown-1atr-3d": (row: PanelRow) => row.labels.correction1AtrWithin3 === 1,
} as const;

export function riskMetrics(rows: PanelRow[], cohort: ValidationCohort): RiskMetric[] {
  const groups = assetGroups(rows);
  const output: RiskMetric[] = [];
  for (const [baseline, signal] of Object.entries(RISK_SIGNALS)) {
    for (const [target, actual] of Object.entries(RISK_TARGETS) as Array<[keyof typeof RISK_TARGETS, (row: PanelRow) => boolean]>) {
      const perAsset = [...groups.values()].map((assetRows) => confusion(assetRows, signal, actual));
      const precision = assetEqual(perAsset.map((metric) => metric.precision));
      const baseRate = assetEqual(perAsset.map((metric) => metric.baseRate));
      output.push({
        baseline, target, cohort, assets: groups.size, observations: rows.length,
        alertRate: roundNullable(assetEqual(perAsset.map((metric) => metric.coverage)) === null ? null : assetEqual(perAsset.map((metric) => metric.coverage))! * 100),
        precision: roundNullable(precision === null ? null : precision * 100),
        recall: roundNullable(assetEqual(perAsset.map((metric) => metric.recall)) === null ? null : assetEqual(perAsset.map((metric) => metric.recall))! * 100),
        f1: roundNullable(assetEqual(perAsset.map((metric) => metric.f1)) === null ? null : assetEqual(perAsset.map((metric) => metric.f1))! * 100),
        baseRate: roundNullable(baseRate === null ? null : baseRate * 100),
        lift: roundNullable(precision !== null && baseRate ? precision / baseRate : null),
      });
    }
  }
  return output;
}

function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array(values.length).fill(0) as number[];
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[cursor].value) end += 1;
    const rank = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) output[sorted[index].index] = rank;
    cursor = end + 1;
  }
  return output;
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = average(left)!; const rightMean = average(right)!;
  let numerator = 0; let leftScale = 0; let rightScale = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] - leftMean; const r = right[index] - rightMean;
    numerator += l * r; leftScale += l ** 2; rightScale += r ** 2;
  }
  return leftScale && rightScale ? numerator / Math.sqrt(leftScale * rightScale) : null;
}

function spearman(left: number[], right: number[]): number | null {
  return pearson(ranks(left), ranks(right));
}

export function rangeMetrics(rows: PanelRow[], cohort: ValidationCohort): RangeMetric[] {
  const predictors: Record<string, (row: PanelRow) => number | null> = {
    "weather-v0.1-rain": (row) => row.baseline.rainChance,
    "atr14-percent": (row) => row.features.atr14Percent,
    "atr-percentile-252": (row) => row.features.atrPercentile252,
    "realized-vol-percentile-252": (row) => row.features.realizedVolPercentile252,
  };
  const groups = assetGroups(rows);
  return Object.entries(predictors).map(([predictor, select]) => {
    const perAsset = [...groups.values()].map((assetRows) => {
      const pairs = assetRows.flatMap((row) => {
        const value = select(row);
        return value === null ? [] : [{ value, range: row.labels.nextDayTrueRange }];
      });
      const correlation = spearman(pairs.map((pair) => pair.value), pairs.map((pair) => pair.range));
      const sorted = [...pairs].sort((a, b) => b.value - a.value);
      const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.2)));
      const topMean = average(top.map((pair) => pair.range));
      const baseMean = average(pairs.map((pair) => pair.range));
      return { correlation, lift: topMean !== null && baseMean ? topMean / baseMean : null };
    });
    return {
      predictor, cohort, assets: groups.size, observations: rows.length,
      assetEqualSpearman: roundNullable(assetEqual(perAsset.map((metric) => metric.correlation))),
      topQuintileRangeLift: roundNullable(assetEqual(perAsset.map((metric) => metric.lift))),
    };
  });
}
