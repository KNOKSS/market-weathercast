import type { DatasetAssetDefinition } from "../dataset/types";

export type NumericFeatures = Record<string, number | null>;

export interface BaselineSnapshot {
  engine: "weatherScore-v0.1-daily-replay";
  temperature: number;
  rainChance: number;
  ultraviolet: number;
  weather: string;
  wind: string;
  trendScore: number;
  momentumScore: number;
  volatilityScore: number;
  activityScore: number;
}

export interface BaseSnapshot {
  date: string;
  index: number;
  close: number;
  features: NumericFeatures;
  baseline: BaselineSnapshot | null;
}

export interface PanelLabels {
  return1: number;
  return3: number;
  return5: number;
  up1: 0 | 1;
  up3: 0 | 1;
  up5: 0 | 1;
  spyExcessReturn1: number | null;
  spyExcessReturn3: number | null;
  spyExcessReturn5: number | null;
  nextDayRange: number;
  nextDayTrueRange: number;
  maxDrawdown3: number;
  maxDrawdown5: number;
  drop1: 0 | 1;
  drop2: 0 | 1;
  drop3: 0 | 1;
  historicalTailEvent1: 0 | 1;
  correction1AtrWithin3: 0 | 1;
  correction1AtrWithin5: 0 | 1;
}

export interface PanelRow {
  assetId: string;
  date: string;
  forecastPolicy: "US_CLOSE" | "UTC_DAILY_CLOSE";
  assetClass: DatasetAssetDefinition["assetClass"];
  sector: string | null;
  fullContextReady: boolean;
  contextAsOf: Record<string, string | null>;
  features: NumericFeatures;
  baseline: BaselineSnapshot;
  labels: PanelLabels;
}

export type InferenceRow = Omit<PanelRow, "labels">;

export interface ShadowResolvedRow extends InferenceRow {
  labels: Pick<PanelLabels, "up1" | "nextDayTrueRange" | "historicalTailEvent1">;
}

export interface FeatureDefinition {
  name: string;
  group: "own" | "context" | "breadth" | "baseline";
  unit: string;
  description: string;
  timing: string;
  required: boolean;
}

export interface PanelAssetSummary {
  assetId: string;
  sector: string | null;
  rows: number;
  firstDate: string;
  lastDate: string;
  fullContextPercent: number;
  firstFullContextDate: string | null;
  up1Rate: number;
  up3Rate: number;
  up5Rate: number;
  historicalTailRate: number;
  missingFeatureCounts: Record<string, number>;
}

export interface PanelBuildReport {
  schemaVersion: 1;
  panelId: string;
  generatedAt: string;
  asOfDate: string;
  forecastContract: {
    usAssets: string;
    cryptoAssets: string;
    btcContextForUs: string;
    labelConvention: string;
  };
  sourceUniverseId: string;
  output: {
    file: string;
    rows: number;
    sha256: string;
    format: string;
  };
  assets: PanelAssetSummary[];
  featureDefinitions: FeatureDefinition[];
  regimeAssetDays: Record<string, number>;
  verification: Record<string, boolean | number | string>;
  warnings: string[];
}
