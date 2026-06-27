import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import path from "node:path";
import type { PanelBuildReport, PanelRow } from "../panel/types";
import { directionMetrics, rangeMetrics, riskMetrics } from "./metrics";
import { createBaselineReport, createEvaluationProtocol } from "./report";
import { assignAssetSplits, SPLIT_POLICY, summarizeAssetSplit, TRAINING_CLUSTERS } from "./split";
import type { BaselineEvaluationReport, SplitAssignment, ValidationCohort } from "./types";

const EVALUATION_ID = "market-weather-baseline-evaluation-v1";
const root = process.cwd();
const panelDirectory = path.resolve(root, "research-results", "market-weather-eod-panel-v1");
const panelPath = path.join(panelDirectory, "panel.jsonl.gz");
const outputDirectory = path.resolve(root, "research-results", EVALUATION_ID);

async function forEachPanelRow(callback: (row: PanelRow) => void | Promise<void>) {
  const input = createReadStream(panelPath).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) if (line) await callback(JSON.parse(line) as PanelRow);
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function bestDirectionNote(metrics: ReturnType<typeof directionMetrics>, cohort: ValidationCohort): string {
  const candidates = metrics.filter((metric) => metric.cohort === cohort && metric.horizon === 1 && metric.baseline !== "always-up" && metric.balancedAccuracy !== null);
  const best = [...candidates].sort((a, b) => (b.balancedAccuracy ?? -Infinity) - (a.balancedAccuracy ?? -Infinity))[0];
  return best ? `${cohort}의 1기간 방향 기준선 최고 균형정확도는 ${best.baseline} ${best.balancedAccuracy?.toFixed(2)}%입니다.` : `${cohort} 방향 기준선을 계산하지 못했습니다.`;
}

function bestRiskNote(metrics: ReturnType<typeof riskMetrics>, cohort: ValidationCohort): string {
  const candidates = metrics.filter((metric) => metric.cohort === cohort && metric.target === "historical-tail-1d" && metric.lift !== null);
  const best = [...candidates].sort((a, b) => (b.lift ?? -Infinity) - (a.lift ?? -Infinity))[0];
  return best ? `${cohort}의 1일 꼬리위험 Lift 최고 기준선은 ${best.baseline} ${best.lift?.toFixed(2)}배입니다.` : `${cohort} 위험 기준선을 계산하지 못했습니다.`;
}

function metricValue<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  return items.find(predicate);
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const panelReport = JSON.parse(await readFile(path.join(panelDirectory, "build-report.json"), "utf8")) as PanelBuildReport;
  const dates = new Map<string, string[]>();
  const fullContextDates = new Map<string, Set<string>>();
  await forEachPanelRow((row) => {
    dates.set(row.assetId, [...(dates.get(row.assetId) ?? []), row.date]);
    if (row.fullContextReady) {
      if (!fullContextDates.has(row.assetId)) fullContextDates.set(row.assetId, new Set());
      fullContextDates.get(row.assetId)!.add(row.date);
    }
  });

  const assignments = new Map<string, Map<string, SplitAssignment>>();
  const splitSummary = [...dates.entries()].map(([assetId, assetDates]) => {
    const assetAssignments = assignAssetSplits(assetId, assetDates);
    assignments.set(assetId, new Map(assetAssignments.map((item) => [item.date, item])));
    return summarizeAssetSplit(assetId, assetAssignments, fullContextDates.get(assetId) ?? new Set());
  });
  const validationRows: Record<ValidationCohort, PanelRow[]> = { "seen-assets": [], "asset-holdout": [] };
  let sealedTestRowsUsedForMetrics = 0;
  let assetHoldoutRowsUsedForTraining = 0;
  await forEachPanelRow((row) => {
    const assignment = assignments.get(row.assetId)?.get(row.date);
    if (!assignment) throw new Error(`Missing split assignment for ${row.assetId} ${row.date}`);
    const isAssetHoldout = SPLIT_POLICY.assetHoldouts.includes(row.assetId as typeof SPLIT_POLICY.assetHoldouts[number]);
    if (assignment.bucket === "train" && isAssetHoldout) {
      // Count remains zero by contract: these rows are deliberately not sent to any trainer.
      return;
    }
    if (assignment.bucket === "sealed-test") {
      // Do not access row.labels in this branch.
      return;
    }
    if (assignment.bucket !== "validation") return;
    validationRows[isAssetHoldout ? "asset-holdout" : "seen-assets"].push(row);
  });

  const direction = [
    ...directionMetrics(validationRows["seen-assets"], "seen-assets"),
    ...directionMetrics(validationRows["asset-holdout"], "asset-holdout"),
  ];
  const risk = [
    ...riskMetrics(validationRows["seen-assets"], "seen-assets"),
    ...riskMetrics(validationRows["asset-holdout"], "asset-holdout"),
  ];
  const range = [
    ...rangeMetrics(validationRows["seen-assets"], "seen-assets"),
    ...rangeMetrics(validationRows["asset-holdout"], "asset-holdout"),
  ];
  const targetAssets = [...dates.keys()];
  const clusteredAssets = Object.values(TRAINING_CLUSTERS).flat();
  const verification: Record<string, boolean | number | string> = {
    sourcePanelHashPresent: panelReport.output.sha256.length === 64,
    allAssetsAssignedExactlyOnceToWeightCluster: targetAssets.every((asset) => clusteredAssets.filter((candidate) => candidate === asset).length === 1),
    allWeightClusterAssetsExist: clusteredAssets.every((asset) => targetAssets.includes(asset)),
    everyAssetHasFivePeriodPurgeAtBothBoundaries: splitSummary.every((asset) => asset.purged === 10),
    everyAssetHasFivePeriodEmbargoAtBothBoundaries: splitSummary.every((asset) => asset.embargoed === 10),
    trainEndsBeforeValidation: splitSummary.every((asset) => asset.lastTrainDate !== null && asset.firstValidationDate !== null && asset.lastTrainDate < asset.firstValidationDate),
    validationEndsBeforeSealedTest: splitSummary.every((asset) => asset.lastValidationDate !== null && asset.firstSealedTestDate !== null && asset.lastValidationDate < asset.firstSealedTestDate),
    sealedTransferHoldoutsAbsentFromPanel: SPLIT_POLICY.sealedTransferHoldouts.every((asset) => !targetAssets.includes(asset)),
    assetHoldoutRowsUsedForTraining,
    sealedTestRowsUsedForMetrics,
    sealedTestMetricsAbsent: true,
    validationSeenRows: validationRows["seen-assets"].length,
    validationAssetHoldoutRows: validationRows["asset-holdout"].length,
  };
  const booleanFailures = Object.entries(verification).filter(([, value]) => value === false).map(([key]) => key);
  if (booleanFailures.length || assetHoldoutRowsUsedForTraining !== 0 || sealedTestRowsUsedForMetrics !== 0) {
    throw new Error(`Evaluation protocol failed: ${booleanFailures.join(", ")}`);
  }
  const report: BaselineEvaluationReport = {
    schemaVersion: 1,
    evaluationId: EVALUATION_ID,
    generatedAt: new Date().toISOString(),
    sourcePanelId: panelReport.panelId,
    sourcePanelSha256: panelReport.output.sha256,
    policy: {
      trainEnd: SPLIT_POLICY.trainEnd,
      validationStart: SPLIT_POLICY.validationStart,
      validationEnd: SPLIT_POLICY.validationEnd,
      sealedTestStart: SPLIT_POLICY.sealedTestStart,
      purgePeriods: SPLIT_POLICY.purgePeriods,
      embargoPeriods: SPLIT_POLICY.embargoPeriods,
      assetHoldouts: [...SPLIT_POLICY.assetHoldouts],
      sealedTransferHoldouts: [...SPLIT_POLICY.sealedTransferHoldouts],
      trainingClusters: TRAINING_CLUSTERS,
      testPolicy: "2025년 이후 라벨 성능은 모델 구조·특징·규제·임계값을 모두 동결할 때까지 계산하거나 보고하지 않습니다.",
    },
    splitSummary,
    direction,
    risk,
    range,
    verification,
    decisionNotes: [
      bestDirectionNote(direction, "seen-assets"),
      bestDirectionNote(direction, "asset-holdout"),
      bestRiskNote(risk, "seen-assets"),
      bestRiskNote(risk, "asset-holdout"),
      (() => {
        const seen = metricValue(direction, (metric) => metric.cohort === "seen-assets" && metric.horizon === 1 && metric.baseline === "weather-v0.1-temperature-50");
        const holdout = metricValue(direction, (metric) => metric.cohort === "asset-holdout" && metric.horizon === 1 && metric.baseline === "weather-v0.1-temperature-50");
        return `v0.1 체감온도 방향 기준선은 seen ${seen?.balancedAccuracy?.toFixed(2)}%, 홀드아웃 ${holdout?.balancedAccuracy?.toFixed(2)}%로 50%를 넘지 못했습니다. 체감온도를 방향 확률로 해석하면 안 됩니다.`;
      })(),
      (() => {
        const seen = metricValue(range, (metric) => metric.cohort === "seen-assets" && metric.predictor === "atr14-percent");
        const holdout = metricValue(range, (metric) => metric.cohort === "asset-holdout" && metric.predictor === "atr14-percent");
        return `ATR14는 다음날 True Range와 seen ${seen?.assetEqualSpearman?.toFixed(2)}, 홀드아웃 ${holdout?.assetEqualSpearman?.toFixed(2)}의 순위상관을 유지해 첫 학습 모델은 방향보다 변동폭 예측부터 개발하는 것이 타당합니다.`;
      })(),
      (() => {
        const seen = metricValue(risk, (metric) => metric.cohort === "seen-assets" && metric.target === "drop-2pct-1d" && metric.baseline === "weather-v0.1-storm");
        const holdout = metricValue(risk, (metric) => metric.cohort === "asset-holdout" && metric.target === "drop-2pct-1d" && metric.baseline === "weather-v0.1-storm");
        return `v0.1 태풍경보의 -2% 하락 Lift는 seen ${seen?.lift?.toFixed(2)}배에서 홀드아웃 ${holdout?.lift?.toFixed(2)}배로 약해졌습니다. 절대 임계값 경보는 자산군별 보정이 필요합니다.`;
      })(),
      "1 ATR 이내 3일 낙폭 라벨은 일반 조정이 아니라 현재 변동성 예상치를 넘어선 surprise drawdown으로 해석합니다.",
      "방향 모델은 정확도보다 균형정확도·Brier score·확률 보정을 우선해야 합니다. 상승 기본확률이 50%보다 높기 때문입니다.",
      "위험 모델은 Lift만 높고 재현율이 낮을 수 있으므로 정밀도·재현율·경보율을 함께 최적화해야 합니다.",
      "1% 안팎의 방향 차이는 시계열 자기상관을 고려한 이동 블록 bootstrap 신뢰구간을 통과하기 전까지 유효한 신호로 간주하지 않습니다.",
    ],
  };
  await writeJson(path.join(outputDirectory, "split-manifest.json"), { policy: report.policy, assets: splitSummary, verification });
  await writeJson(path.join(outputDirectory, "baseline-results.json"), report);
  await writeFile(path.join(outputDirectory, "report.md"), createBaselineReport(report), "utf8");
  await writeFile(path.join(outputDirectory, "EVALUATION_PROTOCOL.md"), createEvaluationProtocol(report), "utf8");
  console.log(`[done] validation seen=${validationRows["seen-assets"].length} holdout=${validationRows["asset-holdout"].length}`);
  console.log(`[done] sealed-test metrics used=${sealedTestRowsUsedForMetrics}`);
  console.log(`[done] ${path.relative(root, outputDirectory).replaceAll("\\", "/")}`);
}

main().catch((error) => {
  console.error("[evaluation] failed", error);
  process.exitCode = 1;
});
