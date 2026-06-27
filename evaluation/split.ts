import type { AssetSplitSummary, SplitAssignment, TimeBucket } from "./types";

export const SPLIT_POLICY = {
  trainEnd: "2022-12-31",
  validationStart: "2023-01-01",
  validationEnd: "2024-12-31",
  sealedTestStart: "2025-01-01",
  purgePeriods: 5,
  embargoPeriods: 5,
  assetHoldouts: ["IWM", "XLE", "XLU", "EEM", "BTCUSDT"],
  sealedTransferHoldouts: ["XLC", "XLRE", "TSLA", "NVDA", "ETHUSDT"],
} as const;

export const TRAINING_CLUSTERS: Record<string, string[]> = {
  "broad-and-style": ["SPY", "QQQ", "IWD", "IWF", "MTUM", "USMV"],
  "cyclical-sectors": ["IWM", "XLB", "XLY", "XLE", "XLF", "XLI"],
  "defensive-real-assets": ["XLP", "XLV", "XLU", "IYR"],
  "technology-communications": ["XLK", "VOX"],
  "international-equity": ["EFA", "EEM"],
  "crypto": ["BTCUSDT"],
};

function initialBucket(date: string): TimeBucket {
  if (date <= SPLIT_POLICY.trainEnd) return "train";
  if (date >= SPLIT_POLICY.validationStart && date <= SPLIT_POLICY.validationEnd) return "validation";
  if (date >= SPLIT_POLICY.sealedTestStart) return "sealed-test";
  throw new Error(`Date ${date} is outside the fixed split contract`);
}

function markBoundary(
  assignments: SplitAssignment[],
  boundaryDate: string,
  leftBucket: "train" | "validation",
  rightBucket: "validation" | "sealed-test",
) {
  const left = assignments.filter((item) => item.bucket === leftBucket && item.date < boundaryDate);
  const right = assignments.filter((item) => item.bucket === rightBucket && item.date >= boundaryDate);
  left.slice(-SPLIT_POLICY.purgePeriods).forEach((item) => { item.bucket = "purged"; });
  right.slice(0, SPLIT_POLICY.embargoPeriods).forEach((item) => { item.bucket = "embargoed"; });
}

export function assignAssetSplits(assetId: string, dates: string[]): SplitAssignment[] {
  const assignments = dates.map((date) => ({ assetId, date, bucket: initialBucket(date) } satisfies SplitAssignment));
  markBoundary(assignments, SPLIT_POLICY.validationStart, "train", "validation");
  markBoundary(assignments, SPLIT_POLICY.sealedTestStart, "validation", "sealed-test");
  return assignments;
}

export function summarizeAssetSplit(
  assetId: string,
  assignments: SplitAssignment[],
  fullContextDates: Set<string>,
): AssetSplitSummary {
  const dates = (bucket: TimeBucket) => assignments.filter((item) => item.bucket === bucket).map((item) => item.date);
  const train = dates("train");
  const validation = dates("validation");
  const sealed = dates("sealed-test");
  return {
    assetId,
    assetRole: SPLIT_POLICY.assetHoldouts.includes(assetId as typeof SPLIT_POLICY.assetHoldouts[number]) ? "asset-holdout" : "development",
    train: train.length,
    validation: validation.length,
    sealedTest: sealed.length,
    purged: dates("purged").length,
    embargoed: dates("embargoed").length,
    fullContextTrain: train.filter((date) => fullContextDates.has(date)).length,
    fullContextValidation: validation.filter((date) => fullContextDates.has(date)).length,
    firstTrainDate: train[0] ?? null,
    lastTrainDate: train.at(-1) ?? null,
    firstValidationDate: validation[0] ?? null,
    lastValidationDate: validation.at(-1) ?? null,
    firstSealedTestDate: sealed[0] ?? null,
  };
}
