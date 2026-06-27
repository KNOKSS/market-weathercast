import type { PanelBuildReport } from "./types";

function percent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function createPanelReport(report: PanelBuildReport): string {
  const total = report.assets.reduce((sum, asset) => sum + asset.rows, 0);
  const weighted = (selector: (asset: PanelBuildReport["assets"][number]) => number) =>
    report.assets.reduce((sum, asset) => sum + selector(asset) * asset.rows, 0) / total;
  const failedChecks = Object.entries(report.verification).filter(([, value]) => value === false).map(([key]) => key);
  const lines: string[] = [
    "# 장 마감 예보 패널 v1 구축 리포트", "",
    `- 패널: \`${report.panelId}\``, `- 기준일: ${report.asOfDate}`, `- 총 행: ${report.output.rows.toLocaleString()} asset-days`,
    `- 자산: ${report.assets.length}개 개발 대상`, `- 파일: \`${report.output.file}\``, `- SHA-256: \`${report.output.sha256}\``,
    "", "## 예보 계약", "",
    `- 미국 상장 자산: ${report.forecastContract.usAssets}`,
    `- 암호자산: ${report.forecastContract.cryptoAssets}`,
    `- 미국 자산에서 BTC 문맥: ${report.forecastContract.btcContextForUs}`,
    `- 라벨: ${report.forecastContract.labelConvention}`,
    "", "## 검증 결과", "",
    `- 자동 검증 ${Object.keys(report.verification).length}개`,
    `- 실패: ${failedChecks.length ? failedChecks.join(", ") : "없음"}`,
    `- 잠금 홀드아웃 제외: ${report.verification.lockedHoldoutsExcluded === true ? "통과" : "실패"}`,
    `- 전체 t+1 라벨 정렬: ${report.verification.allTPlus1LabelsAligned === true ? "통과" : "실패"}`,
    `- 과거 구간 재계산 불변성: ${report.verification.allPastOnlyRecomputationsInvariant === true ? "통과" : "실패"}`,
    `- 문맥 데이터 시점: ${report.verification.allContextDatesLegal === true ? "통과" : "실패"}`,
    "", "## 전체 라벨 분포", "",
    `- 다음 1기간 상승: ${percent(weighted((asset) => asset.up1Rate))}`,
    `- 다음 3기간 상승: ${percent(weighted((asset) => asset.up3Rate))}`,
    `- 다음 5기간 상승: ${percent(weighted((asset) => asset.up5Rate))}`,
    `- 자산별 과거 10% 하방꼬리 기준의 다음 1기간 위험사건: ${percent(weighted((asset) => asset.historicalTailRate))}`,
    "", "## 자산별 표본", "",
    "|자산|섹터/역할|행 수|기간|전체 문맥 준비율|첫 전체 문맥일|1일 상승|3일 상승|5일 상승|꼬리사건|",
    "|---|---|---:|---|---:|---|---:|---:|---:|---:|",
  ];
  for (const asset of report.assets) {
    lines.push(`|${asset.assetId}|${asset.sector ?? "-"}|${asset.rows}|${asset.firstDate}~${asset.lastDate}|${percent(asset.fullContextPercent)}|${asset.firstFullContextDate ?? "-"}|${percent(asset.up1Rate)}|${percent(asset.up3Rate)}|${percent(asset.up5Rate)}|${percent(asset.historicalTailRate)}|`);
  }
  lines.push("", "## 시장 국면별 표본", "", "수치는 날짜 수가 아니라 자산-일(asset-day) 수입니다.", "");
  Object.entries(report.regimeAssetDays).forEach(([regime, count]) => lines.push(`- ${regime}: ${count.toLocaleString()}`));
  lines.push("", "## 해석상 주의", "");
  report.warnings.forEach((warning) => lines.push(`- ${warning}`));
  lines.push(
    "", "## 다음 단계 진입 판단", "",
    "이 패널은 모델 학습 직전의 원재료입니다. 아직 train/validation/test를 붙이지 않았습니다. 다음 단계에서 5기간 라벨 중첩을 고려한 purge·embargo 시간 분할과 자산 통째 홀드아웃 분할을 만든 뒤, 기준선 모델부터 평가해야 합니다.", "",
  );
  return lines.join("\n");
}

export function createDataContract(report: PanelBuildReport): string {
  return [
    "# Market Weather EOD Panel v1 — Data Contract", "",
    "## Forecast issuance", "",
    "- US_CLOSE: 미국 상장 자산의 정규장 종가가 확정된 직후 예보를 발행합니다.",
    "- UTC_DAILY_CLOSE: Binance UTC 일봉이 완전히 닫힌 직후 암호자산 예보를 발행합니다.",
    "- 이 패널은 장중 실시간 예보를 검증하지 않습니다. 장중 보정 계층은 별도 실험이어야 합니다.",
    "", "## Feature boundary", "",
    "행 날짜가 t이면 자체 특징은 t 종가까지 사용할 수 있습니다. rolling z-score·백분위의 비교 분포는 t-1까지만 사용합니다. 미국 자산에서 BTC 일봉은 source date < t인 완결 봉만 사용합니다.",
    "", "## Label boundary", "",
    "return1/3/5는 자산 자체 거래달력의 t 종가 대비 t+1/t+3/t+5 종가입니다. nextDayRange와 nextDayTrueRange는 t+1 봉에서 계산합니다. 모든 라벨은 특징 생성 후에 결합되며 특징 이름 공간에 들어가지 않습니다.",
    "", "## Two feature tiers", "",
    "- Core: 자산 자체 OHLCV와 v0.1 기준선. 장기 위기 국면을 최대한 보존합니다.",
    "- Full context: SPY, VIX, 금리, 신용, 달러, 금, 원자재, BTC, 섹터 breadth가 모두 준비된 행. BTC 장기 이력 한계로 주로 2018년 이후입니다.",
    "- 이후 모델은 Core 장기 모델과 Full-context 최근 모델을 별도 비교해야 하며, 결측을 0으로 바꾸면 안 됩니다.",
    "", "## Holdout isolation", "",
    "XLC, XLRE, TSLA, NVDA, ETHUSDT는 이 패널에 존재하지 않습니다. 최종 모델과 보정법을 동결하기 전에는 특징·라벨 파일도 만들지 않습니다.",
    "", "## Reproducibility", "",
    `패널 내용 SHA-256(압축 전 JSONL): \`${report.output.sha256}\``,
    `생성시각: ${report.generatedAt}`, "",
  ].join("\n");
}
