import type { HistoricalCandle } from "../backtest/types";
import type { AssetQualityAudit, DatasetAssetDefinition, LoadedDatasetAsset, QualityIssue, RedundancyPair, RegimeCoverage } from "./types";

export const QUALITY_POLICY = {
  targetMinimumYears: 8,
  minimumCalendarCoveragePercent: 97,
  maximumMissingVolumePercent: 1,
  extremeMoveThresholdPercent: 25,
} as const;

const DAY = 24 * 60 * 60 * 1000;
const REGIMES = [
  { id: "dotcom", label: "닷컴 붕괴·회복(2000-2003)", start: "2000-01-01", end: "2003-12-31", minimum: 250 },
  { id: "gfc", label: "글로벌 금융위기(2007-2009)", start: "2007-07-01", end: "2009-06-30", minimum: 200 },
  { id: "euro", label: "유럽 재정위기·미국 신용등급 충격(2011)", start: "2011-05-01", end: "2011-12-31", minimum: 100 },
  { id: "covid", label: "코로나 충격·반등(2020)", start: "2020-02-01", end: "2020-12-31", minimum: 150 },
  { id: "inflation", label: "인플레이션·긴축장(2022)", start: "2022-01-01", end: "2022-12-31", minimum: 180 },
  { id: "recent", label: "최근 국면(2024-현재)", start: "2024-01-01", end: "2026-12-31", minimum: 250 },
] as const;

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function dailyReturns(candles: HistoricalCandle[]): number[] {
  const output: number[] = [];
  for (let index = 1; index < candles.length; index += 1) output.push(candles[index].close / candles[index - 1].close - 1);
  return output;
}

function maximumDrawdown(candles: HistoricalCandle[]): number | null {
  if (!candles.length) return null;
  let peak = candles[0].close;
  let worst = 0;
  for (const candle of candles) {
    peak = Math.max(peak, candle.close);
    worst = Math.min(worst, candle.close / peak - 1);
  }
  return worst * 100;
}

function maximumCalendarGap(candles: HistoricalCandle[]): number {
  let maximum = 0;
  for (let index = 1; index < candles.length; index += 1) {
    maximum = Math.max(maximum, Math.round((candles[index].time - candles[index - 1].time) / DAY));
  }
  return maximum;
}

function regimeCoverage(candles: HistoricalCandle[]): RegimeCoverage[] {
  return REGIMES.map((regime) => {
    const observations = candles.filter((candle) => candle.date >= regime.start && candle.date <= regime.end).length;
    return { id: regime.id, label: regime.label, observations, covered: observations >= regime.minimum };
  });
}

function expectedCalendarDates(asset: DatasetAssetDefinition, candles: HistoricalCandle[], spyDates: Set<string>): number {
  const start = candles[0].date;
  const end = candles.at(-1)!.date;
  if (asset.calendar === "US") return [...spyDates].filter((date) => date >= start && date <= end).length;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
}

export function auditAsset(loaded: LoadedDatasetAsset, spyDates: Set<string>, asOfDate: string): AssetQualityAudit {
  const { definition: asset, data } = loaded;
  const { candles } = data;
  const issues: QualityIssue[] = [];
  const first = candles[0];
  const last = candles.at(-1)!;
  const returns = dailyReturns(candles);
  const expected = expectedCalendarDates(asset, candles, spyDates);
  // Some indices publish a value on a date when SPY is closed. Calendar coverage
  // is a completeness ratio, so those legitimate extra rows must not exceed 100%.
  const coverage = expected ? Math.min(100, candles.length / expected * 100) : null;
  const historyYears = (last.time - first.time) / (365.25 * DAY);
  const zeroVolumePercent = candles.filter((candle) => candle.volume <= 0).length / candles.length * 100;
  const unchangedClosePercent = returns.filter((value) => value === 0).length / Math.max(1, returns.length) * 100;
  const extremeMoveCount = returns.filter((value) => Math.abs(value) * 100 >= QUALITY_POLICY.extremeMoveThresholdPercent).length;
  const maxGap = maximumCalendarGap(candles);
  const staleDays = Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / DAY);
  const expectedMinimum = asset.minimumYears * (asset.calendar === "24/7" ? 330 : 200);

  if (candles.length < expectedMinimum) issues.push({ severity: "error", code: "INSUFFICIENT_HISTORY", message: `필요 ${asset.minimumYears}년에 비해 관측치가 ${candles.length}개뿐입니다.` });
  if (coverage !== null && coverage < QUALITY_POLICY.minimumCalendarCoveragePercent) issues.push({ severity: "error", code: "LOW_CALENDAR_COVERAGE", message: `기준 거래달력 대비 커버리지가 ${coverage.toFixed(2)}%입니다.` });
  if (asset.volumeExpected && zeroVolumePercent > QUALITY_POLICY.maximumMissingVolumePercent) issues.push({ severity: "error", code: "MISSING_VOLUME", message: `거래량 0인 관측치가 ${zeroVolumePercent.toFixed(2)}%입니다.` });
  if (maxGap > (asset.calendar === "24/7" ? 2 : 10)) issues.push({ severity: "error", code: "LONG_DATA_GAP", message: `최대 ${maxGap}일의 비정상적인 데이터 공백이 있습니다.` });
  if (staleDays > (asset.calendar === "24/7" ? 1 : 4)) issues.push({ severity: "error", code: "STALE_DATA", message: `최신 관측일이 기준일보다 ${staleDays}일 늦습니다.` });
  if (extremeMoveCount > 0) issues.push({ severity: "info", code: "EXTREME_MOVES", message: `절대 일간수익률 ${QUALITY_POLICY.extremeMoveThresholdPercent}% 이상이 ${extremeMoveCount}회 있어 원자료 점검 대상입니다.` });
  const regimes = regimeCoverage(candles);
  const missingRegimes = regimes.filter((regime) => !regime.covered).map((regime) => regime.id);
  if (missingRegimes.length) issues.push({ severity: "info", code: "REGIME_NOT_COVERED", message: `상품 상장 시점상 미포함 국면: ${missingRegimes.join(", ")}` });
  if (asset.modelUse === "locked-holdout") issues.push({ severity: "info", code: "LOCKED_HOLDOUT", message: "공식 전이성 검증 전까지 특징 선택·튜닝·임계값 결정에 사용할 수 없습니다." });

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const volatility = standardDeviation(returns);
  const drawdown = maximumDrawdown(candles);
  return {
    assetId: asset.id,
    label: asset.label,
    cohort: asset.cohort,
    modelUse: asset.modelUse,
    sector: asset.sector,
    startDate: first.date,
    endDate: last.date,
    observations: candles.length,
    calendarCoveragePercent: coverage === null ? null : round(coverage, 3),
    historyYears: round(historyYears, 2),
    annualizedVolatilityPercent: volatility === null ? null : round(volatility * Math.sqrt(asset.periodsPerYear) * 100, 3),
    maximumDrawdownPercent: drawdown === null ? null : round(drawdown, 3),
    zeroVolumePercent: round(zeroVolumePercent, 3),
    unchangedClosePercent: round(unchangedClosePercent, 3),
    extremeMoveCount,
    maximumCalendarGapDays: maxGap,
    regimeCoverage: regimes,
    qualityGate: hasError ? "fail" : hasWarning ? "review" : "pass",
    issues,
  };
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  let numerator = 0;
  let leftScale = 0;
  let rightScale = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] - leftMean;
    const r = right[index] - rightMean;
    numerator += l * r;
    leftScale += l ** 2;
    rightScale += r ** 2;
  }
  return leftScale && rightScale ? numerator / Math.sqrt(leftScale * rightScale) : null;
}

function returnMap(candles: HistoricalCandle[]): Map<string, number> {
  const output = new Map<string, number>();
  for (let index = 1; index < candles.length; index += 1) output.set(candles[index].date, candles[index].close / candles[index - 1].close - 1);
  return output;
}

export function findRedundancy(assets: LoadedDatasetAsset[]): RedundancyPair[] {
  const eligible = assets.filter((asset) => asset.definition.modelUse !== "context");
  const maps = new Map(eligible.map((asset) => [asset.definition.id, returnMap(asset.data.candles)]));
  const output: RedundancyPair[] = [];
  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const leftId = eligible[leftIndex].definition.id;
      const rightId = eligible[rightIndex].definition.id;
      const leftMap = maps.get(leftId)!;
      const rightMap = maps.get(rightId)!;
      const dates = [...leftMap.keys()].filter((date) => rightMap.has(date));
      if (dates.length < 252) continue;
      const correlation = pearson(dates.map((date) => leftMap.get(date)!), dates.map((date) => rightMap.get(date)!));
      if (correlation !== null && correlation >= 0.92) output.push({ left: leftId, right: rightId, alignedDays: dates.length, returnCorrelation: round(correlation, 5), interpretation: correlation >= 0.98 ? "near-duplicate" : "high-overlap" });
    }
  }
  return output.sort((a, b) => b.returnCorrelation - a.returnCorrelation);
}
