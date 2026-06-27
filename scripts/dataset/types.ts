import type { AssetDefinition, CachedAssetData, DataManifestEntry } from "../backtest/types";

export type DatasetCohort =
  | "benchmark"
  | "development"
  | "regime-context"
  | "locked-transfer-holdout";

export type DatasetAssetClass =
  | "equity-index"
  | "equity-etf"
  | "volatility-index"
  | "rates-etf"
  | "credit-etf"
  | "currency-etf"
  | "commodity-etf"
  | "crypto"
  | "single-stock";

export type ModelUse = "target" | "context" | "benchmark" | "locked-holdout";

export interface DatasetAssetDefinition extends AssetDefinition {
  cohort: DatasetCohort;
  assetClass: DatasetAssetClass;
  modelUse: ModelUse;
  region: "US" | "developed-ex-US" | "emerging" | "global-24h";
  sector: string | null;
  purpose: string;
  calendar: "US" | "24/7";
  periodsPerYear: 252 | 365;
  volumeExpected: boolean;
  minimumYears: number;
}

export interface LoadedDatasetAsset {
  definition: DatasetAssetDefinition;
  data: CachedAssetData;
  manifest: DataManifestEntry;
}

export interface QualityIssue {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
}

export interface RegimeCoverage {
  id: string;
  label: string;
  observations: number;
  covered: boolean;
}

export interface AssetQualityAudit {
  assetId: string;
  label: string;
  cohort: DatasetCohort;
  modelUse: ModelUse;
  sector: string | null;
  startDate: string;
  endDate: string;
  observations: number;
  calendarCoveragePercent: number | null;
  historyYears: number;
  annualizedVolatilityPercent: number | null;
  maximumDrawdownPercent: number | null;
  zeroVolumePercent: number;
  unchangedClosePercent: number;
  extremeMoveCount: number;
  maximumCalendarGapDays: number;
  regimeCoverage: RegimeCoverage[];
  qualityGate: "pass" | "review" | "fail";
  issues: QualityIssue[];
}

export interface RedundancyPair {
  left: string;
  right: string;
  alignedDays: number;
  returnCorrelation: number;
  interpretation: "near-duplicate" | "high-overlap";
}

export interface DatasetAuditResult {
  schemaVersion: 1;
  datasetId: string;
  generatedAt: string;
  asOfDate: string;
  policy: {
    targetMinimumYears: number;
    minimumCalendarCoveragePercent: number;
    maximumMissingVolumePercent: number;
    extremeMoveThresholdPercent: number;
    lockedHoldoutPolicy: string;
  };
  universe: DatasetAssetDefinition[];
  manifest: DataManifestEntry[];
  audits: AssetQualityAudit[];
  redundancy: RedundancyPair[];
  gates: {
    allDevelopmentTargetsPass: boolean;
    allElevenEquitySectorsPresent: boolean;
    noFailedAssets: boolean;
    staleAssets: string[];
    failedAssets: string[];
    reviewAssets: string[];
  };
}
