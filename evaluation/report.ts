import type { BaselineEvaluationReport, DirectionMetric, RangeMetric, RiskMetric } from "./types";

function display(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value.toFixed(2)}${suffix}`;
}

function directionTable(metrics: DirectionMetric[], cohort: DirectionMetric["cohort"], horizon: 1 | 3 | 5): string[] {
  const rows = metrics.filter((metric) => metric.cohort === cohort && metric.horizon === horizon);
  return [
    `### ${cohort} · ${horizon}기간 방향`, "",
    "|기준선|표본|정확도|균형정확도|상승 신호 비율|상승 신호 후 평균수익률|",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map((metric) => `|${metric.baseline}|${metric.observations}|${display(metric.accuracy, "%")}|${display(metric.balancedAccuracy, "%")}|${display(metric.bullishCoverage, "%")}|${display(metric.bullishMeanReturn, "%")}|`),
    "",
  ];
}

function riskTable(metrics: RiskMetric[], cohort: RiskMetric["cohort"], target: RiskMetric["target"]): string[] {
  const rows = metrics.filter((metric) => metric.cohort === cohort && metric.target === target);
  return [
    `### ${cohort} · ${target}`, "",
    "|기준선|경보율|정밀도|재현율|F1|기본 발생률|Lift|",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map((metric) => `|${metric.baseline}|${display(metric.alertRate, "%")}|${display(metric.precision, "%")}|${display(metric.recall, "%")}|${display(metric.f1, "%")}|${display(metric.baseRate, "%")}|${display(metric.lift, "×")}|`),
    "",
  ];
}

function rangeTable(metrics: RangeMetric[]): string[] {
  return [
    "|검증군|변동폭 예측자|자산동일가중 Spearman|상위 20% 실제 True Range Lift|",
    "|---|---|---:|---:|",
    ...metrics.map((metric) => `|${metric.cohort}|${metric.predictor}|${display(metric.assetEqualSpearman)}|${display(metric.topQuintileRangeLift, "×")}|`),
  ];
}

export function createBaselineReport(report: BaselineEvaluationReport): string {
  const total = (key: "train" | "validation" | "sealedTest" | "purged" | "embargoed") => report.splitSummary.reduce((sum, asset) => sum + asset[key], 0);
  const failed = Object.entries(report.verification).filter(([, value]) => value === false).map(([key]) => key);
  const lines: string[] = [
    "# 장 마감 예보 3단계 — 분할 및 단순 기준선", "",
    `- 평가: \`${report.evaluationId}\``, `- 원본 패널 SHA-256: \`${report.sourcePanelSha256}\``,
    `- 학습 후보 행: ${total("train").toLocaleString()} (단, 자산 홀드아웃은 학습에서 제외)`,
    `- 검증 행: ${total("validation").toLocaleString()}`, `- 봉인 시험 행: ${total("sealedTest").toLocaleString()} (성능 미계산)`,
    `- purge: ${total("purged").toLocaleString()} · embargo: ${total("embargoed").toLocaleString()}`,
    "", "## 고정 연구 규칙", "",
    `- 학습 종료: ${report.policy.trainEnd}`, `- 검증: ${report.policy.validationStart}~${report.policy.validationEnd}`, `- 봉인 시험 시작: ${report.policy.sealedTestStart}`,
    `- 자산 홀드아웃: ${report.policy.assetHoldouts.join(", ")}`, `- 최종 전이성 홀드아웃: ${report.policy.sealedTransferHoldouts.join(", ")}`,
    `- 시험 정책: ${report.policy.testPolicy}`,
    "- 향후 학습 가중치는 군집 → 자산 → 행의 3단계 동일가중을 사용합니다. 관측치가 많거나 서로 비슷한 ETF가 결과를 독점하지 못하게 합니다.",
    "", "## 분할 검증", "",
    `- 자동 검증 ${Object.keys(report.verification).length}개 · 실패 ${failed.length ? failed.join(", ") : "없음"}`,
    `- 봉인 시험 성능 접근 행: ${report.verification.sealedTestRowsUsedForMetrics}`, `- 자산 홀드아웃 학습 사용 행: ${report.verification.assetHoldoutRowsUsedForTraining}`,
    "", "## 방향 기준선", "",
    "정확도만 보면 항상 상승이 강해 보일 수 있으므로, 상승·하락을 동일하게 보는 균형정확도를 주 판정값으로 사용합니다.", "",
    ...directionTable(report.direction, "seen-assets", 1),
    ...directionTable(report.direction, "asset-holdout", 1),
    "## 꼬리위험 기준선", "",
    "Lift는 경보일의 실제 위험 발생률을 평시 기본 발생률로 나눈 값입니다.", "",
    ...riskTable(report.risk, "seen-assets", "historical-tail-1d"),
    ...riskTable(report.risk, "asset-holdout", "historical-tail-1d"),
    "## 다음날 변동폭 순위", "",
    ...rangeTable(report.range),
    "", "## 연구 판단", "",
    ...report.decisionNotes.map((note) => `- ${note}`), "",
    "봉인 시험과 최종 전이성 홀드아웃은 아직 열지 않았습니다. 다음 단계에서는 변동폭·꼬리위험 모델을 먼저 만들고, 방향 모델은 낮은 우선순위의 challenger로만 검증합니다.", "",
  ];
  return lines.join("\n");
}

export function createEvaluationProtocol(report: BaselineEvaluationReport): string {
  return [
    "# Baseline Evaluation Protocol v1", "",
    "## Frozen boundaries", "",
    `- Train: panel start through ${report.policy.trainEnd}`, `- Validation: ${report.policy.validationStart} through ${report.policy.validationEnd}`, `- Sealed test: ${report.policy.sealedTestStart} onward`,
    `- Purge: ${report.policy.purgePeriods} asset-native periods before each boundary`, `- Embargo: ${report.policy.embargoPeriods} asset-native periods after each boundary`,
    "", "## Asset generalization", "",
    `Development asset holdouts: ${report.policy.assetHoldouts.join(", ")}. These assets are not legal training rows. They may be used only for model-selection validation.`,
    `Sealed transfer holdouts: ${report.policy.sealedTransferHoldouts.join(", ")}. They remain outside the panel and may not influence feature or model selection.`,
    "", "## Weighting", "",
    "Model training will assign equal total weight to each economic cluster, equal weight to each asset inside a cluster, and equal weight to each row inside an asset. Reported cross-asset metrics are asset-equal, not observation-weighted.",
    "", "## Test discipline", "",
    report.policy.testPolicy, "",
  ].join("\n");
}
