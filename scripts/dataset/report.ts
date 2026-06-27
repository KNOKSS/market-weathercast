import type { DatasetAuditResult } from "./types";

function percent(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}

export function createDatasetReport(result: DatasetAuditResult): string {
  const counts = new Map<string, number>();
  result.universe.forEach((asset) => counts.set(asset.cohort, (counts.get(asset.cohort) ?? 0) + 1));
  const lines: string[] = [
    "# 대표 자산 데이터셋 v1 품질 리포트", "",
    `- 데이터셋: \`${result.datasetId}\``, `- 기준일: ${result.asOfDate}`, `- 자산 수: ${result.universe.length}`,
    `- 개발 대상: ${counts.get("development") ?? 0} · 시장 기준: ${counts.get("benchmark") ?? 0} · 국면 설명: ${counts.get("regime-context") ?? 0} · 잠금 홀드아웃: ${counts.get("locked-transfer-holdout") ?? 0}`,
    "", "## 결론 게이트", "",
    `- 11개 주식 섹터 대표성: **${result.gates.allElevenEquitySectorsPresent ? "통과" : "실패"}**`,
    `- 개발 예측 대상 데이터 품질: **${result.gates.allDevelopmentTargetsPass ? "통과" : "실패"}**`,
    `- 전체 실패 자산 없음: **${result.gates.noFailedAssets ? "통과" : "실패"}**`,
    `- 검토 필요: ${result.gates.reviewAssets.length ? result.gates.reviewAssets.join(", ") : "없음"}`,
    `- 실패: ${result.gates.failedAssets.length ? result.gates.failedAssets.join(", ") : "없음"}`,
    "", "이 게이트는 모델 성능이 아니라 데이터가 연구에 들어갈 최소 조건을 충족했는지만 판정합니다.",
    "", "## 설계 원칙", "",
    "1. 섹터 대표는 현재 시가총액 상위 개별주가 아니라 장기 ETF를 사용해 생존편향과 단일기업 사건 위험을 줄였습니다.",
    "2. 통신서비스와 부동산은 짧은 XLC·XLRE 대신 VOX·IYR로 개발하고, XLC·XLRE는 상품 간 이전성 홀드아웃으로 잠갔습니다.",
    "3. VIX·금리·신용·달러·금·원자재는 예측 대상과 섞지 않고 시장 국면 설명 변수로 분리했습니다.",
    "4. TSLA·NVDA·ETH는 튜닝에 쓰지 않는 종목 홀드아웃입니다. 최종 전이성 시험 전에 결과를 이용해 공식을 바꾸면 안 됩니다.",
    "5. SP500·NASDAQ 지수와 SPY·QQQ ETF의 중복은 의도적입니다. 전자는 기준선, 후자는 실제 거래 가능한 예측 대상입니다.",
    "", "## 자산별 품질", "",
    "|자산|용도|섹터/역할|기간|관측치|달력 커버리지|연환산 변동성|최대 낙폭|게이트|",
    "|---|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const audit of result.audits) lines.push(`|${audit.assetId}|${audit.modelUse}|${audit.sector ?? "-"}|${audit.startDate}~${audit.endDate}|${audit.observations}|${percent(audit.calendarCoveragePercent)}|${percent(audit.annualizedVolatilityPercent)}|${percent(audit.maximumDrawdownPercent)}|${audit.qualityGate}|`);
  lines.push("", "## 국면 커버리지", "");
  const regimes = result.audits[0]?.regimeCoverage ?? [];
  lines.push(`|자산|${regimes.map((regime) => regime.label).join("|")}|`, `|---|${regimes.map(() => "---:").join("|")}|`);
  for (const audit of result.audits) lines.push(`|${audit.assetId}|${audit.regimeCoverage.map((regime) => regime.covered ? `✓ ${regime.observations}` : `- ${regime.observations}`).join("|")}|`);
  lines.push("", "## 중복·과대표 위험", "");
  if (!result.redundancy.length) lines.push("일간수익률 상관 0.92 이상인 쌍이 없습니다.");
  else {
    lines.push("|자산 A|자산 B|공통 거래일|상관계수|판정|", "|---|---|---:|---:|---|");
    result.redundancy.forEach((pair) => lines.push(`|${pair.left}|${pair.right}|${pair.alignedDays}|${pair.returnCorrelation.toFixed(4)}|${pair.interpretation}|`));
    lines.push("", "중복 쌍은 모델 학습에서 동일 가중치로 여러 번 세지 않습니다. 자산 동일가중 또는 군집 가중을 사용해야 합니다.");
  }
  lines.push("", "## 발견된 이슈", "");
  for (const audit of result.audits) {
    const relevant = audit.issues.filter((issue) => issue.severity !== "info" || issue.code === "EXTREME_MOVES");
    if (relevant.length) lines.push(`- **${audit.assetId}**: ${relevant.map((issue) => `[${issue.severity}] ${issue.message}`).join(" / ")}`);
  }
  if (!result.audits.some((audit) => audit.issues.some((issue) => issue.severity !== "info"))) lines.push("- 경고 또는 오류 없음. 정보성 이슈는 JSON 품질 감사 파일에 보존했습니다.");
  lines.push("", "## 다음 단계 진입 조건", "", "다음 단계에서는 이 유니버스를 바로 하나의 표로 합치지 않습니다. 먼저 조정가격·거래달력·특징 시점(t)·라벨 시점(t+1/t+3/t+5)을 고정한 패널 데이터 명세를 작성합니다. 이후 개발 자산에서만 특징을 만들고, 잠금 홀드아웃은 마지막 이전성 검증까지 격리합니다.", "");
  return lines.join("\n");
}

export function createDatasetCard(result: DatasetAuditResult): string {
  return [
    "# Market Weather Representative Dataset v1 — Dataset Card", "", "## Intended use", "",
    "weatherScore v0.2 연구에서 미국 섹터·스타일·해외주식·암호자산에 대한 방향, 예상 변동폭, 꼬리위험 모델의 일반화 가능성을 검증하기 위한 일봉 데이터셋입니다.",
    "", "## Not intended for", "", "- 개별 종목의 확정 가격 예측", "- 분봉 엔진의 충실한 재현", "- 거래비용·슬리피지를 무시한 투자 성과 주장", "- 홀드아웃 자산을 본 뒤 같은 시험의 공식이나 임계값을 수정하는 행위",
    "", "## Universe construction", "", "- 11개 GICS 성격의 섹터는 장기 ETF로 대표합니다.", "- 대형주·성장주·소형주·가치·모멘텀·저변동 스타일을 별도 축으로 둡니다.", "- VIX, 국채, 하이일드, 달러, 금, 광범위 원자재는 시장 국면 설명용이며 방향 성과 풀에 섞지 않습니다.", "- 통신·부동산의 대체 ETF와 고변동 개별주·ETH는 잠금 홀드아웃으로 둡니다.",
    "", "## Known limitations", "", "- Yahoo와 Binance 단일 공급자에 의존하므로 공식 연구 전 이중 공급자 대조가 필요합니다.", "- Yahoo chart는 비공식 연구 수집 경로입니다. 원자료는 Git에서 제외하며 재배포하지 않습니다.", "- ETF는 운용보수·추적오차·구성 변경을 포함하며 경제 섹터 그 자체와 동일하지 않습니다.", "- 현재 구성은 미국 상장 상품 중심입니다. 한국·유럽 현지 지수로의 지역 전이는 별도 단계입니다.", "- 상장 전 시장 국면은 관측할 수 없습니다. 국면 커버리지 표를 모델 평가에서 함께 사용해야 합니다.", "- 조정가격은 배당·분할 효과를 반영하지만, 실제 체결 가능 가격과 다를 수 있습니다.",
    "", "## Leakage policy", "", result.policy.lockedHoldoutPolicy, "", `기준일: ${result.asOfDate} · 생성시각: ${result.generatedAt}`, "",
  ].join("\n");
}
