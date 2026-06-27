import type { PanelRow } from "../panel/types";

export type TimeBucket = "train" | "validation" | "sealed-test" | "purged" | "embargoed";
export type ValidationCohort = "seen-assets" | "asset-holdout";

export interface SplitAssignment {
  assetId: string;
  date: string;
  bucket: TimeBucket;
}

export interface AssetSplitSummary {
  assetId: string;
  assetRole: "development" | "asset-holdout";
  train: number;
  validation: number;
  sealedTest: number;
  purged: number;
  embargoed: number;
  fullContextTrain: number;
  fullContextValidation: number;
  firstTrainDate: string | null;
  lastTrainDate: string | null;
  firstValidationDate: string | null;
  lastValidationDate: string | null;
  firstSealedTestDate: string | null;
}

export interface DirectionMetric {
  baseline: string;
  cohort: ValidationCohort;
  horizon: 1 | 3 | 5;
  assets: number;
  observations: number;
  accuracy: number | null;
  balancedAccuracy: number | null;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  bullishCoverage: number | null;
  bullishMeanReturn: number | null;
}

export interface RiskMetric {
  baseline: string;
  target: "historical-tail-1d" | "drop-2pct-1d" | "surprise-drawdown-1atr-3d";
  cohort: ValidationCohort;
  assets: number;
  observations: number;
  alertRate: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  baseRate: number | null;
  lift: number | null;
}

export interface RangeMetric {
  predictor: string;
  cohort: ValidationCohort;
  assets: number;
  observations: number;
  assetEqualSpearman: number | null;
  topQuintileRangeLift: number | null;
}

export interface BaselineEvaluationReport {
  schemaVersion: 1;
  evaluationId: string;
  generatedAt: string;
  sourcePanelId: string;
  sourcePanelSha256: string;
  policy: {
    trainEnd: string;
    validationStart: string;
    validationEnd: string;
    sealedTestStart: string;
    purgePeriods: number;
    embargoPeriods: number;
    assetHoldouts: string[];
    sealedTransferHoldouts: string[];
    trainingClusters: Record<string, string[]>;
    testPolicy: string;
  };
  splitSummary: AssetSplitSummary[];
  direction: DirectionMetric[];
  risk: RiskMetric[];
  range: RangeMetric[];
  verification: Record<string, boolean | number | string>;
  decisionNotes: string[];
}

export interface EvaluationRow extends PanelRow {
  timeBucket: TimeBucket;
  validationCohort: ValidationCohort;
}
