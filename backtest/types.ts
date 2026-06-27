import type { Candle, MarketKind, WeatherLabel, WindLevel } from "../../src/types/market";

export type BacktestSource = "yahoo" | "binance";
export type BacktestSplit = "train" | "validation" | "test";
export type AssetRole = "equity" | "crypto" | "risk-proxy";

export interface AssetDefinition {
  id: string;
  label: string;
  kind: MarketKind;
  source: BacktestSource;
  remoteSymbol: string;
  startDate: string;
  role: AssetRole;
}

export interface HistoricalCandle extends Candle {
  date: string;
}

export interface CachedAssetData {
  schemaVersion: 1;
  asset: AssetDefinition;
  fetchedAt: string;
  sourceUrl: string;
  adjustment: string;
  candles: HistoricalCandle[];
}

export interface HorizonOutcomes {
  return1: number;
  return3: number;
  return5: number;
  maxDrawdown3: number;
  maxDrawdown5: number;
}

export interface ScoreSnapshot {
  temperature: number;
  rainChance: number;
  ultraviolet: number;
  wind: WindLevel;
  weather: WeatherLabel;
  rsi: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  trendScore: number;
  momentumScore: number;
  volatilityScore: number;
  activityScore: number;
  daily5Change: number | null;
  daily20Change: number | null;
  confidence: number;
}

export interface BacktestObservation {
  assetId: string;
  assetLabel: string;
  role: AssetRole;
  date: string;
  split: BacktestSplit;
  close: number;
  previousDayReturn: number;
  momentum5: number;
  aboveSma20: boolean;
  score: ScoreSnapshot;
  outcomes: HorizonOutcomes;
  nextDayRange: number;
  nextDayTrueRange: number;
}

export interface DataManifestEntry {
  assetId: string;
  source: BacktestSource;
  remoteSymbol: string;
  startDate: string;
  endDate: string;
  observations: number;
  sha256: string;
  cacheFile: string;
  adjustment: string;
}

export interface NumericSummary {
  n: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  ci95: [number, number] | null;
}

export interface ProbabilitySummary {
  n: number;
  probability: number | null;
  ci95: [number, number] | null;
}

export interface GroupReturnSummary {
  group: string;
  count: number;
  return1: NumericSummary;
  return3: NumericSummary;
  return5: NumericSummary;
  up1: ProbabilitySummary;
  up3: ProbabilitySummary;
  up5: ProbabilitySummary;
}

export interface RainRiskSummary {
  group: string;
  count: number;
  nextDayRange: NumericSummary;
  nextDayTrueRange: NumericSummary;
  down1: ProbabilitySummary;
  down2: ProbabilitySummary;
  down3: ProbabilitySummary;
}

export interface ClassificationSummary {
  event: string;
  sampleSize: number;
  alerts: number;
  events: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  falsePositiveRate: number | null;
  f1: number | null;
  baseRate: number | null;
  alertEventRate: number | null;
  lift: number | null;
}

export interface BaselineSummary {
  name: string;
  description: string;
  n: number;
  accuracy: number | null;
  bullishCoverage: number | null;
  bullishMeanReturn: number | null;
}

export interface AssetSummary {
  asset: AssetDefinition;
  sample: Record<BacktestSplit, number>;
  dateRange: { first: string; last: string };
  thresholdsFromTraining: {
    trueRange80: number;
    maxDrawdown3Worst20: number;
    atr80: number;
  };
  test: {
    temperatureBins: GroupReturnSummary[];
    rainBins: RainRiskSummary[];
    ultravioletBins: GroupReturnSummary[];
    wind: GroupReturnSummary[];
    weather: GroupReturnSummary[];
    stormAlerts: ClassificationSummary[];
    ultravioletHigh: {
      threshold: number;
      count: number;
      negativeReturn3: ProbabilitySummary;
      negativeReturn5: ProbabilitySummary;
      drawdown1Within3: ProbabilitySummary;
      drawdown2Within5: ProbabilitySummary;
      maxDrawdown3: NumericSummary;
      maxDrawdown5: NumericSummary;
    };
    correlations: {
      temperatureToReturn1Spearman: number | null;
      temperatureToReturn3Spearman: number | null;
      temperatureToReturn5Spearman: number | null;
      rainToTrueRangeSpearman: number | null;
      ultravioletToMaxDrawdown3Spearman: number | null;
      ultravioletToMaxDrawdown5Spearman: number | null;
    };
    baselines: BaselineSummary[];
  };
  stability: Array<{
    year: number;
    count: number;
    temperatureToReturn1Spearman: number | null;
    rainToTrueRangeSpearman: number | null;
    meanReturn1: number | null;
  }>;
  walkForward: Array<{
    testYear: number;
    trainCount: number;
    testCount: number;
    trueRange80FromPriorData: number;
    temperatureToReturn1Spearman: number | null;
    rainToTrueRangeSpearman: number | null;
    stormTrueRangePrecision: number | null;
    stormTrueRangeRecall: number | null;
    stormTrueRangeLift: number | null;
  }>;
}

export interface BacktestConfigSnapshot {
  experimentId: string;
  engineVersion: string;
  replayMode: string;
  generatedAt: string;
  endDate: string;
  minimumHistory: number;
  horizons: number[];
  split: { train: number; validation: number; test: number };
  bootstrapSamples: number;
  randomBaselineRuns: number;
  randomSeed: number;
  engineSource: { file: string; sha256: string };
  assets: AssetDefinition[];
  warnings: string[];
}

export interface BacktestSummary {
  config: BacktestConfigSnapshot;
  dataManifest: DataManifestEntry[];
  verification: Record<string, boolean | number | string>;
  assets: AssetSummary[];
  pooled: {
    includedAssets: string[];
    excludedFromDirectionalPool: string[];
    observationWeighted: {
      temperatureBins: GroupReturnSummary[];
      rainBins: RainRiskSummary[];
      weather: GroupReturnSummary[];
      correlations: AssetSummary["test"]["correlations"];
    };
    assetEqual: {
      temperatureBins: Array<Record<string, string | number | null>>;
      rainBins: Array<Record<string, string | number | null>>;
      weather: Array<Record<string, string | number | null>>;
      correlations: AssetSummary["test"]["correlations"];
    };
  };
  crossAsset: {
    vixWeatherAgainstSp500: {
      matchedObservations: number;
      testObservations: number;
      temperatureBins: GroupReturnSummary[];
      rainBins: RainRiskSummary[];
      weather: GroupReturnSummary[];
      correlations: {
        temperatureToSp500Return1Spearman: number | null;
        temperatureToSp500Return3Spearman: number | null;
        rainToSp500TrueRangeSpearman: number | null;
      };
      stormAlerts: ClassificationSummary[];
      note: string;
    };
  };
}
