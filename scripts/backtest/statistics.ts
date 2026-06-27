import {
  RAIN_BINS,
  TEMPERATURE_BINS,
  ULTRAVIOLET_BINS,
} from "./config";
import type {
  AssetDefinition,
  AssetSummary,
  BacktestObservation,
  BaselineSummary,
  ClassificationSummary,
  GroupReturnSummary,
  NumericSummary,
  ProbabilitySummary,
  RainRiskSummary,
} from "./types";

interface Bin {
  label: string;
  min: number;
  max: number;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(values: number[], probability: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function hashSeed(text: string, base: number): number {
  let hash = base >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 2654435761) >>> 0;
  }
  return hash || 1;
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bootstrapMeanCi(values: number[], samples: number, seed: number): [number, number] | null {
  if (values.length < 2) return null;
  const random = rng(seed);
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    means.push(total / values.length);
  }
  return [round(quantile(means, 0.025)), round(quantile(means, 0.975))];
}

export function numericSummary(
  rawValues: number[],
  bootstrapSamples: number,
  seed: number,
  key: string,
): NumericSummary {
  const values = rawValues.filter(Number.isFinite);
  const average = mean(values);
  const variance = average === null || values.length < 2
    ? null
    : values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return {
    n: values.length,
    mean: average === null ? null : round(average),
    median: median(values) === null ? null : round(median(values)!),
    standardDeviation: variance === null ? null : round(Math.sqrt(variance)),
    ci95: bootstrapMeanCi(values, bootstrapSamples, hashSeed(key, seed)),
  };
}

export function probabilitySummary(
  values: boolean[],
  bootstrapSamples: number,
  seed: number,
  key: string,
): ProbabilitySummary {
  const numeric = values.map((value) => value ? 1 : 0);
  const probability = mean(numeric);
  return {
    n: values.length,
    probability: probability === null ? null : round(probability),
    ci95: bootstrapMeanCi(numeric, bootstrapSamples, hashSeed(key, seed)),
  };
}

function returnValue(observation: BacktestObservation, horizon: 1 | 3 | 5): number {
  return observation.outcomes[`return${horizon}`];
}

function summarizeReturnGroup(
  group: string,
  observations: BacktestObservation[],
  bootstrapSamples: number,
  seed: number,
): GroupReturnSummary {
  return {
    group,
    count: observations.length,
    return1: numericSummary(observations.map((item) => item.outcomes.return1), bootstrapSamples, seed, `${group}-r1`),
    return3: numericSummary(observations.map((item) => item.outcomes.return3), bootstrapSamples, seed, `${group}-r3`),
    return5: numericSummary(observations.map((item) => item.outcomes.return5), bootstrapSamples, seed, `${group}-r5`),
    up1: probabilitySummary(observations.map((item) => item.outcomes.return1 > 0), bootstrapSamples, seed, `${group}-u1`),
    up3: probabilitySummary(observations.map((item) => item.outcomes.return3 > 0), bootstrapSamples, seed, `${group}-u3`),
    up5: probabilitySummary(observations.map((item) => item.outcomes.return5 > 0), bootstrapSamples, seed, `${group}-u5`),
  };
}

export function summarizeByBins(
  observations: BacktestObservation[],
  bins: readonly Bin[],
  selector: (observation: BacktestObservation) => number,
  bootstrapSamples: number,
  seed: number,
): GroupReturnSummary[] {
  return bins.map((bin) => summarizeReturnGroup(
    bin.label,
    observations.filter((item) => {
      const value = selector(item);
      return value >= bin.min && value <= bin.max;
    }),
    bootstrapSamples,
    hashSeed(bin.label, seed),
  ));
}

export function summarizeByCategory(
  observations: BacktestObservation[],
  values: string[],
  selector: (observation: BacktestObservation) => string,
  bootstrapSamples: number,
  seed: number,
): GroupReturnSummary[] {
  return values.map((value) => summarizeReturnGroup(
    value,
    observations.filter((item) => selector(item) === value),
    bootstrapSamples,
    hashSeed(value, seed),
  ));
}

export function summarizeRain(
  observations: BacktestObservation[],
  bootstrapSamples: number,
  seed: number,
): RainRiskSummary[] {
  return RAIN_BINS.map((bin) => {
    const items = observations.filter((item) => item.score.rainChance >= bin.min && item.score.rainChance <= bin.max);
    return {
      group: bin.label,
      count: items.length,
      nextDayRange: numericSummary(items.map((item) => item.nextDayRange), bootstrapSamples, seed, `${bin.label}-range`),
      nextDayTrueRange: numericSummary(items.map((item) => item.nextDayTrueRange), bootstrapSamples, seed, `${bin.label}-true-range`),
      down1: probabilitySummary(items.map((item) => item.outcomes.return1 <= -1), bootstrapSamples, seed, `${bin.label}-d1`),
      down2: probabilitySummary(items.map((item) => item.outcomes.return1 <= -2), bootstrapSamples, seed, `${bin.label}-d2`),
      down3: probabilitySummary(items.map((item) => item.outcomes.return1 <= -3), bootstrapSamples, seed, `${bin.label}-d3`),
    };
  });
}

function rank(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[cursor].value) end += 1;
    const averageRank = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) result[sorted[index].index] = averageRank;
    cursor = end + 1;
  }
  return result;
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = mean(left)!;
  const rightMean = mean(right)!;
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? null : round(numerator / denominator);
}

export function spearman(left: number[], right: number[]): number | null {
  return pearson(rank(left), rank(right));
}

function classification(
  event: string,
  observations: BacktestObservation[],
  predicted: (item: BacktestObservation) => boolean,
  actual: (item: BacktestObservation) => boolean,
): ClassificationSummary {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  observations.forEach((item) => {
    const prediction = predicted(item);
    const outcome = actual(item);
    if (prediction && outcome) truePositive += 1;
    else if (prediction) falsePositive += 1;
    else if (outcome) falseNegative += 1;
    else trueNegative += 1;
  });
  const alerts = truePositive + falsePositive;
  const events = truePositive + falseNegative;
  const precision = alerts ? truePositive / alerts : null;
  const recall = events ? truePositive / events : null;
  const specificity = trueNegative + falsePositive ? trueNegative / (trueNegative + falsePositive) : null;
  const falsePositiveRate = specificity === null ? null : 1 - specificity;
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  const baseRate = observations.length ? events / observations.length : null;
  const alertEventRate = precision;
  return {
    event,
    sampleSize: observations.length,
    alerts,
    events,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision: precision === null ? null : round(precision),
    recall: recall === null ? null : round(recall),
    specificity: specificity === null ? null : round(specificity),
    falsePositiveRate: falsePositiveRate === null ? null : round(falsePositiveRate),
    f1: f1 === null ? null : round(f1),
    baseRate: baseRate === null ? null : round(baseRate),
    alertEventRate: alertEventRate === null ? null : round(alertEventRate),
    lift: baseRate && alertEventRate !== null ? round(alertEventRate / baseRate) : null,
  };
}

function baseline(
  name: string,
  description: string,
  observations: BacktestObservation[],
  prediction: (item: BacktestObservation, index: number) => boolean,
): BaselineSummary {
  if (!observations.length) return { name, description, n: 0, accuracy: null, bullishCoverage: null, bullishMeanReturn: null };
  let correct = 0;
  const bullishReturns: number[] = [];
  observations.forEach((item, index) => {
    const bullish = prediction(item, index);
    if (bullish === (item.outcomes.return1 > 0)) correct += 1;
    if (bullish) bullishReturns.push(item.outcomes.return1);
  });
  return {
    name,
    description,
    n: observations.length,
    accuracy: round(correct / observations.length),
    bullishCoverage: round(bullishReturns.length / observations.length),
    bullishMeanReturn: mean(bullishReturns) === null ? null : round(mean(bullishReturns)!),
  };
}

function randomBaseline(
  observations: BacktestObservation[],
  runs: number,
  seed: number,
): BaselineSummary {
  if (!observations.length) return { name: "random-50", description: "50/50 seeded random direction", n: 0, accuracy: null, bullishCoverage: null, bullishMeanReturn: null };
  const accuracies: number[] = [];
  const coverages: number[] = [];
  const bullishMeans: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const random = rng(seed + run * 7919);
    const result = baseline("random", "", observations, () => random() >= 0.5);
    if (result.accuracy !== null) accuracies.push(result.accuracy);
    if (result.bullishCoverage !== null) coverages.push(result.bullishCoverage);
    if (result.bullishMeanReturn !== null) bullishMeans.push(result.bullishMeanReturn);
  }
  return {
    name: "random-50",
    description: `50/50 seeded random direction, ${runs} repetitions`,
    n: observations.length,
    accuracy: round(mean(accuracies) ?? 0),
    bullishCoverage: round(mean(coverages) ?? 0),
    bullishMeanReturn: round(mean(bullishMeans) ?? 0),
  };
}

export function summarizeAsset(
  asset: AssetDefinition,
  observations: BacktestObservation[],
  bootstrapSamples: number,
  randomRuns: number,
  seed: number,
): AssetSummary {
  const train = observations.filter((item) => item.split === "train");
  const test = observations.filter((item) => item.split === "test");
  const trueRange80 = quantile(train.map((item) => item.nextDayTrueRange), 0.8);
  const maxDrawdown3Worst20 = quantile(train.map((item) => item.outcomes.maxDrawdown3), 0.2);
  const atr80 = quantile(train.flatMap((item) => item.score.atrPercent == null ? [] : [item.score.atrPercent]), 0.8);
  const storm = (item: BacktestObservation) => item.score.weather === "태풍경보";

  const yearly = new Map<number, BacktestObservation[]>();
  observations.forEach((item) => {
    const year = Number(item.date.slice(0, 4));
    yearly.set(year, [...(yearly.get(year) ?? []), item]);
  });
  const walkForward = [...yearly.keys()].sort((left, right) => left - right).flatMap((year) => {
    const prior = observations.filter((item) => Number(item.date.slice(0, 4)) < year);
    const currentYear = yearly.get(year) ?? [];
    if (prior.length < 750 || currentYear.length < 50) return [];
    const priorTrueRange80 = quantile(prior.map((item) => item.nextDayTrueRange), 0.8);
    const stormMetrics = classification(
      `walk-forward ${year} storm range`,
      currentYear,
      (item) => item.score.weather === "태풍경보",
      (item) => item.nextDayTrueRange >= priorTrueRange80,
    );
    return [{
      testYear: year,
      trainCount: prior.length,
      testCount: currentYear.length,
      trueRange80FromPriorData: round(priorTrueRange80),
      temperatureToReturn1Spearman: spearman(currentYear.map((item) => item.score.temperature), currentYear.map((item) => item.outcomes.return1)),
      rainToTrueRangeSpearman: spearman(currentYear.map((item) => item.score.rainChance), currentYear.map((item) => item.nextDayTrueRange)),
      stormTrueRangePrecision: stormMetrics.precision,
      stormTrueRangeRecall: stormMetrics.recall,
      stormTrueRangeLift: stormMetrics.lift,
    }];
  });

  const randomSeed = hashSeed(asset.id, seed);
  return {
    asset,
    sample: {
      train: train.length,
      validation: observations.filter((item) => item.split === "validation").length,
      test: test.length,
    },
    dateRange: { first: observations[0]?.date ?? "", last: observations.at(-1)?.date ?? "" },
    thresholdsFromTraining: {
      trueRange80: round(trueRange80),
      maxDrawdown3Worst20: round(maxDrawdown3Worst20),
      atr80: round(atr80),
    },
    test: {
      temperatureBins: summarizeByBins(test, TEMPERATURE_BINS, (item) => item.score.temperature, bootstrapSamples, randomSeed),
      rainBins: summarizeRain(test, bootstrapSamples, randomSeed),
      ultravioletBins: summarizeByBins(test, ULTRAVIOLET_BINS, (item) => item.score.ultraviolet, bootstrapSamples, randomSeed + 1),
      wind: summarizeByCategory(test, ["잔잔함", "보통", "강함", "돌풍"], (item) => item.score.wind, bootstrapSamples, randomSeed + 2),
      weather: summarizeByCategory(test, ["쾌청", "맑음", "구름 조금", "흐림", "소나기", "태풍경보"], (item) => item.score.weather, bootstrapSamples, randomSeed + 3),
      stormAlerts: [
        classification("태풍경보 → 다음 1일 -2% 이하", test, storm, (item) => item.outcomes.return1 <= -2),
        classification(`태풍경보 → 다음 1일 True Range 상위 20% (훈련 기준 ${round(trueRange80, 2)}% 이상)`, test, storm, (item) => item.nextDayTrueRange >= trueRange80),
        classification(`태풍경보 → 향후 3일 최대낙폭 하위 20% (훈련 기준 ${round(maxDrawdown3Worst20, 2)}% 이하)`, test, storm, (item) => item.outcomes.maxDrawdown3 <= maxDrawdown3Worst20),
        classification(`ATR 단독 기준선 → 다음 1일 True Range 상위 20% (ATR ${round(atr80, 2)} 이상)`, test, (item) => (item.score.atrPercent ?? -Infinity) >= atr80, (item) => item.nextDayTrueRange >= trueRange80),
      ],
      ultravioletHigh: {
        threshold: 70,
        count: test.filter((item) => item.score.ultraviolet >= 70).length,
        negativeReturn3: probabilitySummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.return3 < 0), bootstrapSamples, randomSeed, "uv-neg3"),
        negativeReturn5: probabilitySummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.return5 < 0), bootstrapSamples, randomSeed, "uv-neg5"),
        drawdown1Within3: probabilitySummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.maxDrawdown3 <= -1), bootstrapSamples, randomSeed, "uv-dd1-3"),
        drawdown2Within5: probabilitySummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.maxDrawdown5 <= -2), bootstrapSamples, randomSeed, "uv-dd2-5"),
        maxDrawdown3: numericSummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.maxDrawdown3), bootstrapSamples, randomSeed, "uv-mdd3"),
        maxDrawdown5: numericSummary(test.filter((item) => item.score.ultraviolet >= 70).map((item) => item.outcomes.maxDrawdown5), bootstrapSamples, randomSeed, "uv-mdd5"),
      },
      correlations: {
        temperatureToReturn1Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return1)),
        temperatureToReturn3Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return3)),
        temperatureToReturn5Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return5)),
        rainToTrueRangeSpearman: spearman(test.map((item) => item.score.rainChance), test.map((item) => item.nextDayTrueRange)),
        ultravioletToMaxDrawdown3Spearman: spearman(test.map((item) => item.score.ultraviolet), test.map((item) => item.outcomes.maxDrawdown3)),
        ultravioletToMaxDrawdown5Spearman: spearman(test.map((item) => item.score.ultraviolet), test.map((item) => item.outcomes.maxDrawdown5)),
      },
      baselines: [
        baseline("weather-temperature", "temperature >= 50 predicts next bar up", test, (item) => item.score.temperature >= 50),
        baseline("always-up", "unconditional positive-return base-rate prediction", test, () => true),
        randomBaseline(test, randomRuns, randomSeed),
        baseline("previous-day-continuation", "previous daily return sign continues", test, (item) => item.previousDayReturn >= 0),
        baseline("sma20", "close above SMA20 predicts up", test, (item) => item.aboveSma20),
        baseline("momentum5", "positive five-bar momentum predicts up", test, (item) => item.momentum5 >= 0),
        baseline("rsi50", "RSI >= 50 predicts up", test, (item) => (item.score.rsi ?? 50) >= 50),
      ],
    },
    stability: [...yearly.entries()].sort(([left], [right]) => left - right).map(([year, items]) => ({
      year,
      count: items.length,
      temperatureToReturn1Spearman: spearman(items.map((item) => item.score.temperature), items.map((item) => item.outcomes.return1)),
      rainToTrueRangeSpearman: spearman(items.map((item) => item.score.rainChance), items.map((item) => item.nextDayTrueRange)),
      meanReturn1: mean(items.map((item) => item.outcomes.return1)) === null ? null : round(mean(items.map((item) => item.outcomes.return1))!),
    })),
    walkForward,
  };
}

export function pooledObservationSummary(
  observations: BacktestObservation[],
  bootstrapSamples: number,
  seed: number,
) {
  const test = observations.filter((item) => item.split === "test" && item.role !== "risk-proxy");
  return {
    temperatureBins: summarizeByBins(test, TEMPERATURE_BINS, (item) => item.score.temperature, bootstrapSamples, seed),
    rainBins: summarizeRain(test, bootstrapSamples, seed),
    weather: summarizeByCategory(test, ["쾌청", "맑음", "구름 조금", "흐림", "소나기", "태풍경보"], (item) => item.score.weather, bootstrapSamples, seed),
    correlations: {
      temperatureToReturn1Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return1)),
      temperatureToReturn3Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return3)),
      temperatureToReturn5Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return5)),
      rainToTrueRangeSpearman: spearman(test.map((item) => item.score.rainChance), test.map((item) => item.nextDayTrueRange)),
      ultravioletToMaxDrawdown3Spearman: spearman(test.map((item) => item.score.ultraviolet), test.map((item) => item.outcomes.maxDrawdown3)),
      ultravioletToMaxDrawdown5Spearman: spearman(test.map((item) => item.score.ultraviolet), test.map((item) => item.outcomes.maxDrawdown5)),
    },
  };
}

function equalAssetRows(
  assets: AssetSummary[],
  key: "temperatureBins" | "weather",
): Array<Record<string, string | number | null>> {
  const groups = [...new Set(assets.flatMap((asset) => asset.test[key].map((group) => group.group)))];
  return groups.map((group) => {
    const rows = assets.flatMap((asset) => {
      const match = asset.test[key].find((item) => item.group === group);
      return match && match.count >= 20 ? [match] : [];
    });
    const averageMetric = (selector: (row: GroupReturnSummary) => number | null) => {
      const values = rows.flatMap((row) => selector(row) == null ? [] : [selector(row)!]);
      return values.length ? round(mean(values)!) : null;
    };
    return {
      group,
      assets: rows.length,
      meanReturn1: averageMetric((row) => row.return1.mean),
      meanReturn3: averageMetric((row) => row.return3.mean),
      meanReturn5: averageMetric((row) => row.return5.mean),
      upProbability1: averageMetric((row) => row.up1.probability),
      upProbability3: averageMetric((row) => row.up3.probability),
      upProbability5: averageMetric((row) => row.up5.probability),
    };
  });
}

function equalAssetRainRows(assets: AssetSummary[]): Array<Record<string, string | number | null>> {
  const groups = [...new Set(assets.flatMap((asset) => asset.test.rainBins.map((group) => group.group)))];
  return groups.map((group) => {
    const rows = assets.flatMap((asset) => {
      const match = asset.test.rainBins.find((item) => item.group === group);
      return match && match.count >= 20 ? [match] : [];
    });
    const averageMetric = (selector: (row: RainRiskSummary) => number | null) => {
      const values = rows.flatMap((row) => selector(row) == null ? [] : [selector(row)!]);
      return values.length ? round(mean(values)!) : null;
    };
    return {
      group,
      assets: rows.length,
      meanTrueRange: averageMetric((row) => row.nextDayTrueRange.mean),
      downProbability1: averageMetric((row) => row.down1.probability),
      downProbability2: averageMetric((row) => row.down2.probability),
      downProbability3: averageMetric((row) => row.down3.probability),
    };
  });
}

function equalAssetCorrelations(assets: AssetSummary[]): AssetSummary["test"]["correlations"] {
  const keys: Array<keyof AssetSummary["test"]["correlations"]> = [
    "temperatureToReturn1Spearman",
    "temperatureToReturn3Spearman",
    "temperatureToReturn5Spearman",
    "rainToTrueRangeSpearman",
    "ultravioletToMaxDrawdown3Spearman",
    "ultravioletToMaxDrawdown5Spearman",
  ];
  return Object.fromEntries(keys.map((key) => {
    const values = assets.flatMap((asset) => asset.test.correlations[key] == null ? [] : [asset.test.correlations[key]!]);
    return [key, values.length ? round(mean(values)!) : null];
  })) as AssetSummary["test"]["correlations"];
}

export function assetEqualSummary(assetSummaries: AssetSummary[]) {
  const included = assetSummaries.filter((asset) => asset.asset.role !== "risk-proxy");
  return {
    temperatureBins: equalAssetRows(included, "temperatureBins"),
    rainBins: equalAssetRainRows(included),
    weather: equalAssetRows(included, "weather"),
    correlations: equalAssetCorrelations(included),
  };
}

export function summarizeVixAgainstSp500(
  observations: BacktestObservation[],
  bootstrapSamples: number,
  seed: number,
) {
  const sp500 = new Map(observations.filter((item) => item.assetId === "SP500").map((item) => [item.date, item]));
  const matched = observations.filter((item) => item.assetId === "VIX").flatMap((vix) => {
    const sp = sp500.get(vix.date);
    if (!sp) return [];
    return [{
      ...sp,
      assetId: "VIX_WEATHER_TO_SP500",
      assetLabel: "VIX weather evaluated against S&P 500 outcomes",
      role: "risk-proxy" as const,
      score: vix.score,
    }];
  });
  const train = matched.filter((item) => item.split === "train");
  const test = matched.filter((item) => item.split === "test");
  const trueRange80 = quantile(train.map((item) => item.nextDayTrueRange), 0.8);
  const storm = (item: BacktestObservation) => item.score.weather === "태풍경보";
  return {
    matchedObservations: matched.length,
    testObservations: test.length,
    temperatureBins: summarizeByBins(test, TEMPERATURE_BINS, (item) => item.score.temperature, bootstrapSamples, seed + 101),
    rainBins: summarizeRain(test, bootstrapSamples, seed + 102),
    weather: summarizeByCategory(test, ["쾌청", "맑음", "구름 조금", "흐림", "소나기", "태풍경보"], (item) => item.score.weather, bootstrapSamples, seed + 103),
    correlations: {
      temperatureToSp500Return1Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return1)),
      temperatureToSp500Return3Spearman: spearman(test.map((item) => item.score.temperature), test.map((item) => item.outcomes.return3)),
      rainToSp500TrueRangeSpearman: spearman(test.map((item) => item.score.rainChance), test.map((item) => item.nextDayTrueRange)),
    },
    stormAlerts: [
      classification("VIX 태풍경보 → S&P 500 다음 1일 -2% 이하", test, storm, (item) => item.outcomes.return1 <= -2),
      classification(`VIX 태풍경보 → S&P 500 True Range train 상위 20% (${round(trueRange80, 2)}% 이상)`, test, storm, (item) => item.nextDayTrueRange >= trueRange80),
    ],
    note: "VIX 자체의 상승을 좋은 수익으로 보지 않고, 같은 날짜 VIX 날씨가 이후 S&P 500 하락·변동폭을 탐지하는지 평가합니다.",
  };
}
