import type {
  AssetSummary,
  BacktestSummary,
  ClassificationSummary,
  GroupReturnSummary,
  RainRiskSummary,
} from "./types";

function number(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function percent(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(digits)}%`;
}

function returnPercent(value: number | null | undefined, digits = 3): string {
  return value == null || !Number.isFinite(value) ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function groupReturnTable(rows: GroupReturnSummary[]): string {
  const body = rows.map((row) => `| ${row.group} | ${row.count} | ${returnPercent(row.return1.mean)} | ${percent(row.up1.probability)} | ${returnPercent(row.return3.mean)} | ${percent(row.up3.probability)} | ${returnPercent(row.return5.mean)} | ${percent(row.up5.probability)} |`).join("\n");
  return `| 구간 | n | 1일 평균 | 1일 상승확률 | 3일 평균 | 3일 상승확률 | 5일 평균 | 5일 상승확률 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${body}`;
}

function rainTable(rows: RainRiskSummary[]): string {
  const body = rows.map((row) => `| ${row.group} | ${row.count} | ${returnPercent(row.nextDayRange.mean)} | ${returnPercent(row.nextDayTrueRange.mean)} | ${percent(row.down1.probability)} | ${percent(row.down2.probability)} | ${percent(row.down3.probability)} |`).join("\n");
  return `| 강수 구간 | n | 다음날 고저폭 | 다음날 True Range | -1% 이하 | -2% 이하 | -3% 이하 |\n|---|---:|---:|---:|---:|---:|---:|\n${body}`;
}

function classificationRow(asset: AssetSummary, result: ClassificationSummary): string {
  return `| ${asset.asset.id} | ${result.event} | ${result.alerts} | ${result.events} | ${percent(result.precision)} | ${percent(result.recall)} | ${percent(result.f1)} | ${number(result.lift, 2)}x |`;
}

function correlationMeaning(value: number | null, positiveMeaning: string, negativeMeaning: string): string {
  if (value == null) return "표본 부족";
  const strength = Math.abs(value) >= 0.3 ? "뚜렷한" : Math.abs(value) >= 0.15 ? "약한" : "매우 약한";
  return `${strength} ${value >= 0 ? positiveMeaning : negativeMeaning}`;
}

function primaryAssetTable(assets: AssetSummary[]): string {
  const rows = assets.map((asset) => {
    const testN = asset.sample.test;
    const correlations = asset.test.correlations;
    const weather = asset.test.baselines.find((item) => item.name === "weather-temperature");
    const sma = asset.test.baselines.find((item) => item.name === "sma20");
    const storm = asset.test.stormAlerts[1];
    return `| ${asset.asset.id} | ${testN} | ${number(correlations.temperatureToReturn1Spearman)} | ${number(correlations.rainToTrueRangeSpearman)} | ${percent(weather?.accuracy)} | ${percent(sma?.accuracy)} | ${number(storm?.lift, 2)}x |`;
  }).join("\n");
  return `| 자산 | 테스트 n | 온도↔1일수익 Spearman | 강수↔변동폭 Spearman | 온도 방향정확도 | SMA20 정확도 | 태풍 위험 Lift |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}`;
}

function medianValue(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function conclusions(summary: BacktestSummary): string[] {
  const correlations = summary.pooled.observationWeighted.correlations;
  const equalCorrelations = summary.pooled.assetEqual.correlations;
  const lines = [
    `자산별 상관을 동일 가중한 결과, 체감온도와 다음 1일 수익률의 평균 Spearman은 ${number(equalCorrelations.temperatureToReturn1Spearman)}로, ${correlationMeaning(equalCorrelations.temperatureToReturn1Spearman, "정(+) 관계", "역(-) 관계")}입니다.`,
    `자산별 동일 가중 강수위험↔다음날 True Range 평균 상관은 ${number(equalCorrelations.rainToTrueRangeSpearman)}입니다. 관측 수를 한데 합친 상관 ${number(correlations.rainToTrueRangeSpearman)}은 자산별 변동성 수준 차이가 섞인 값이므로 보조 지표로만 봅니다.`,
    `자외선과 향후 5일 최대낙폭의 상관은 ${number(correlations.ultravioletToMaxDrawdown5Spearman)}입니다. 최대낙폭은 음수이므로 음의 상관일수록 자외선 상승 뒤 낙폭이 커지는 방향입니다.`,
    "이 결과는 동결된 v0.1 일봉 재생의 진단값입니다. 운영 엔진의 분봉 의미와 동일하다고 해석하면 안 되며, 공식 변경은 train/validation에서만 진행해야 합니다.",
  ];
  return lines;
}

export function createMarkdownReport(summary: BacktestSummary): string {
  const pooled = summary.pooled.observationWeighted;
  const assetRows = summary.assets.map((asset) => `| ${asset.asset.id} | ${asset.asset.label} | ${asset.asset.role} | ${asset.dateRange.first} | ${asset.dateRange.last} | ${asset.sample.train} | ${asset.sample.validation} | ${asset.sample.test} |`).join("\n");
  const stormRows = summary.assets.flatMap((asset) => asset.test.stormAlerts.map((result) => classificationRow(asset, result))).join("\n");
  const uvRows = summary.assets.map((asset) => `| ${asset.asset.id} | ${asset.test.ultravioletHigh.count} | ${percent(asset.test.ultravioletHigh.negativeReturn3.probability)} | ${percent(asset.test.ultravioletHigh.negativeReturn5.probability)} | ${percent(asset.test.ultravioletHigh.drawdown1Within3.probability)} | ${percent(asset.test.ultravioletHigh.drawdown2Within5.probability)} | ${returnPercent(asset.test.ultravioletHigh.maxDrawdown5.mean)} |`).join("\n");
  const baselineRows = summary.assets.flatMap((asset) => asset.test.baselines.map((item) => `| ${asset.asset.id} | ${item.name} | ${item.n} | ${percent(item.accuracy)} | ${percent(item.bullishCoverage)} | ${returnPercent(item.bullishMeanReturn)} |`)).join("\n");
  const manifestRows = summary.dataManifest.map((item) => `| ${item.assetId} | ${item.source} | ${item.startDate} | ${item.endDate} | ${item.observations} | \`${item.sha256.slice(0, 12)}…\` |`).join("\n");
  const equalRainRows = summary.pooled.assetEqual.rainBins.map((row) => `| ${row.group} | ${row.assets} | ${returnPercent(row.meanTrueRange as number | null)} | ${percent(row.downProbability1 as number | null)} | ${percent(row.downProbability2 as number | null)} | ${percent(row.downProbability3 as number | null)} |`).join("\n");
  const vixCross = summary.crossAsset.vixWeatherAgainstSp500;
  const vixStormRows = vixCross.stormAlerts.map((result) => `| ${result.event} | ${result.alerts} | ${result.events} | ${percent(result.precision)} | ${percent(result.recall)} | ${number(result.lift, 2)}x |`).join("\n");
  const walkForwardRows = summary.assets.map((asset) => {
    const temperature = asset.walkForward.flatMap((fold) => fold.temperatureToReturn1Spearman == null ? [] : [fold.temperatureToReturn1Spearman]);
    const rain = asset.walkForward.flatMap((fold) => fold.rainToTrueRangeSpearman == null ? [] : [fold.rainToTrueRangeSpearman]);
    const lift = asset.walkForward.flatMap((fold) => fold.stormTrueRangeLift == null ? [] : [fold.stormTrueRangeLift]);
    return `| ${asset.asset.id} | ${asset.walkForward.length} | ${number(medianValue(temperature))} | ${percent(temperature.length ? temperature.filter((value) => value > 0).length / temperature.length : null)} | ${number(medianValue(rain))} | ${percent(rain.length ? rain.filter((value) => value > 0).length / rain.length : null)} | ${number(medianValue(lift), 2)}x |`;
  }).join("\n");
  const coverageRows = summary.assets.map((asset) => {
    const activeWeather = asset.test.weather.filter((row) => row.count > 0);
    const dominant = [...activeWeather].sort((left, right) => right.count - left.count)[0];
    const activeTemperatureBins = asset.test.temperatureBins.filter((row) => row.count >= 20).length;
    return `| ${asset.asset.id} | ${activeTemperatureBins}/7 | ${activeWeather.length}/6 | ${dominant?.group ?? "-"} | ${dominant ? percent(dominant.count / asset.sample.test) : "-"} |`;
  }).join("\n");

  return `# weatherScore v0.1 일봉 재생 백테스트

> 실험 ID: \`${summary.config.experimentId}\`  
> 생성 시각: ${summary.config.generatedAt}  
> 평가 종가 기준일: ${summary.config.endDate}  
> 엔진: \`${summary.config.engineVersion}\`  
> 엔진 SHA-256: \`${summary.config.engineSource.sha256}\`

## 1. 먼저 읽어야 할 결론

${conclusions(summary).map((line) => `- ${line}`).join("\n")}

## 2. 실험 정의

- 날짜 t의 점수는 t일까지 확정된 캔들만 사용했습니다.
- 결과는 t 종가에서 t+1, t+3, t+5번째 바의 종가 수익률로 평가했습니다.
- 다음날 변동폭은 고저폭과 전일 종가 갭을 포함한 True Range를 모두 저장했습니다.
- 주식·지수의 1/3/5는 거래일, BTC의 1/3/5는 일봉 바(달력일)입니다.
- 시간순 60% train, 다음 20% validation, 마지막 20% test로 분리했습니다.
- 상대 위험 임계값은 train 구간에서만 계산하고 test에 고정 적용했습니다.
- 모든 표의 핵심 성능 수치는 마지막 test 구간입니다.
- VIX는 위험 프록시이므로 비-VIX 통합 방향성 통계에서 제외했습니다.
- 샘플·mock 데이터는 사용하지 않았습니다.

### 중요한 한계

현재 운영 엔진은 1분봉과 일봉을 함께 사용합니다. 이 실험은 기존 \`scoreMarket()\` 함수를 수정하지 않고, 최근 96/30개의 **일봉**을 각각 분봉/일봉 입력 자리에 공급한 \`daily-replay\`입니다. 코드와 가중치는 동결되어 있지만 시간 단위의 의미는 운영 화면과 다릅니다.

## 3. 데이터 무결성과 재현성

| 자산 | 소스 | 시작 | 종료 | 원본 일봉 | SHA-256 |
|---|---|---|---|---:|---|
${manifestRows}

자동 검증 결과는 \`summary.json > verification\`에 저장했습니다. 다음 검사를 모두 통과해야 리포트가 생성됩니다.

- 동일 입력 점수 일치
- 미래 캔들을 극단값으로 변경해도 과거 점수 불변
- 날짜와 train/validation/test 순서 단조 증가
- t+1/t+5 결과 정렬 확인
- 비정상 숫자 없음

## 4. 표본과 기간

| 자산 | 이름 | 역할 | 시작 | 종료 | train | validation | test |
|---|---|---|---|---|---:|---:|---:|
${assetRows}

## 5. 자산별 핵심 진단

${primaryAssetTable(summary.assets)}

- Spearman은 순위 상관입니다. 0에 가까우면 단조 관계가 약합니다.
- 방향정확도는 다음 1일 수익률의 부호를 맞힌 비율입니다.
- Lift 1.0은 무조건 발생률과 동일, 1.5는 경보 시 위험 발생률이 평소의 1.5배라는 뜻입니다.

### 5.1 점수 구간 분해능

| 자산 | 표본 20+ 온도 구간 | 실제 등장 날씨 | 최다 날씨 | 최다 날씨 비중 |
|---|---:|---:|---|---:|
${coverageRows}

한 등급이 대부분을 차지하면 해당 자산에서는 날씨 분류가 위험일을 선별하지 못합니다. 이는 특히 일봉 ATR을 분봉용 바람 임계값에 넣는 daily-replay 한계와 자산별 변동성 정규화 부족을 드러냅니다.

## 6. 체감온도 구간별 결과 — 비-VIX 통합, 관측 수 가중

${groupReturnTable(pooled.temperatureBins)}

95% 부트스트랩 신뢰구간과 중앙값·표준편차는 \`summary.json\`에 포함되어 있습니다. 자산별 표본 수 차이의 영향을 줄인 동일 자산 가중 결과도 \`pooled.assetEqual\`에 별도로 저장했습니다.

## 7. 강수위험 구간별 다음날 위험 — 비-VIX 통합

${rainTable(pooled.rainBins)}

위 표는 관측 수 가중이라 BTC·TSLA·NVDA처럼 원래 변동성이 큰 자산의 영향이 섞입니다. 다음 표는 각 구간에서 표본 20개 이상인 자산을 동일 가중한 민감도 검사입니다.

| 강수 구간 | 포함 자산 | 평균 True Range | -1% 이하 | -2% 이하 | -3% 이하 |
|---|---:|---:|---:|---:|---:|
${equalRainRows}

## 8. 날씨 등급별 1일·3일·5일 성과 — 비-VIX 통합

${groupReturnTable(pooled.weather)}

## 9. 태풍경보 위험 탐지력

| 자산 | 경보와 실제 사건 | 경보 수 | 사건 수 | Precision | Recall | F1 | Lift |
|---|---|---:|---:|---:|---:|---:|---:|
${stormRows}

절대 -2% 하락, 자산별 train True Range 상위 20%, train 3일 최대낙폭 하위 20%를 분리해 평가했습니다. 마지막 행의 ATR 단독 기준선은 태풍경보가 단순 변동성 지표보다 유용한지 비교하기 위한 것입니다.

## 10. 자외선 70 이상 이후 조정

| 자산 | 표본 | 3일 음수 | 5일 음수 | 3일 내 -1% 낙폭 | 5일 내 -2% 낙폭 | 5일 평균 최대낙폭 |
|---|---:|---:|---:|---:|---:|---:|
${uvRows}

## 11. 단순 방향 기준선 비교

| 자산 | 모델 | n | 방향정확도 | 상승예측 비율 | 상승예측 뒤 평균 1일 수익률 |
|---|---|---:|---:|---:|---:|
${baselineRows}

기준선은 무조건 상승, 고정 seed 50/50 랜덤 200회, 전일 방향 지속, SMA20 위/아래, 5일 모멘텀, RSI 50을 포함합니다.

## 12. 통합 순위 상관

| 관계 | 관측 수 가중 | 자산 동일 가중 |
|---|---:|---:|
| 체감온도 ↔ 다음 1일 수익률 | ${number(pooled.correlations.temperatureToReturn1Spearman)} | ${number(summary.pooled.assetEqual.correlations.temperatureToReturn1Spearman)} |
| 체감온도 ↔ 다음 3일 수익률 | ${number(pooled.correlations.temperatureToReturn3Spearman)} | ${number(summary.pooled.assetEqual.correlations.temperatureToReturn3Spearman)} |
| 체감온도 ↔ 다음 5일 수익률 | ${number(pooled.correlations.temperatureToReturn5Spearman)} | ${number(summary.pooled.assetEqual.correlations.temperatureToReturn5Spearman)} |
| 강수위험 ↔ 다음날 True Range | ${number(pooled.correlations.rainToTrueRangeSpearman)} | ${number(summary.pooled.assetEqual.correlations.rainToTrueRangeSpearman)} |
| 자외선 ↔ 향후 3일 최대낙폭 | ${number(pooled.correlations.ultravioletToMaxDrawdown3Spearman)} | ${number(summary.pooled.assetEqual.correlations.ultravioletToMaxDrawdown3Spearman)} |
| 자외선 ↔ 향후 5일 최대낙폭 | ${number(pooled.correlations.ultravioletToMaxDrawdown5Spearman)} | ${number(summary.pooled.assetEqual.correlations.ultravioletToMaxDrawdown5Spearman)} |

## 13. 해석 규칙

1. 평균 수익률만 보지 말고 신뢰구간과 표본 수를 함께 봅니다.
2. 높은 온도 구간으로 갈수록 수익률과 상승확률이 대체로 증가해야 방향 점수로서 의미가 있습니다.
3. 강수 구간이 높아질수록 True Range와 하락 꼬리 확률이 증가해야 위험 점수로서 의미가 있습니다.
4. 태풍경보는 Precision뿐 아니라 Recall과 Lift를 함께 봅니다. 너무 적은 경보로 우연히 높은 Precision이 나온 경우는 신뢰하지 않습니다.
5. 연도별 안정성은 자산별 \`stability\` 배열에서 확인합니다.
6. 여러 지표와 구간을 동시에 검사했으므로 개별적으로 좋은 숫자는 탐색적 결과입니다. 공식 변경 전 walk-forward 검증과 별도 최종 테스트가 필요합니다.

## 14. VIX 날씨의 별도 위험 검증

VIX 상승을 일반 주식처럼 좋은 수익으로 간주하지 않았습니다. 같은 날짜의 VIX 점수를 S&P 500의 이후 결과와 ${vixCross.testObservations}개 테스트 관측에서 비교했습니다.

| 관계 | Spearman |
|---|---:|
| VIX 체감온도 ↔ S&P 500 다음 1일 수익률 | ${number(vixCross.correlations.temperatureToSp500Return1Spearman)} |
| VIX 체감온도 ↔ S&P 500 다음 3일 수익률 | ${number(vixCross.correlations.temperatureToSp500Return3Spearman)} |
| VIX 강수위험 ↔ S&P 500 다음날 True Range | ${number(vixCross.correlations.rainToSp500TrueRangeSpearman)} |

| 경보와 실제 사건 | 경보 수 | 사건 수 | Precision | Recall | Lift |
|---|---:|---:|---:|---:|---:|
${vixStormRows}

${vixCross.note}

## 15. 연도별 expanding walk-forward 안정성

각 연도를 평가할 때 그 이전 연도만 train으로 사용했습니다. 태풍의 상대 변동폭 기준도 이전 데이터에서만 다시 계산했습니다.

| 자산 | 연도 fold | 온도↔1일수익 중앙값 | 온도 양(+)의 연도 | 강수↔변동폭 중앙값 | 강수 양(+)의 연도 | 태풍 Lift 중앙값 |
|---|---:|---:|---:|---:|---:|---:|
${walkForwardRows}

연도별 전체 수치는 \`summary.json > assets[].walkForward\`에 저장했습니다. 이 표는 특정 한 시기에만 작동한 신호인지 확인하기 위한 안정성 검사입니다.

## 16. 다음 단계

- 이 리포트로 v0.1의 강점과 약점을 먼저 확정합니다.
- 공식 후보는 train에서 만들고 validation에서 선택합니다.
- test는 최종 후보를 선택한 뒤 한 번만 확인합니다.
- 운영 엔진 변경 전 최근 분봉을 사용한 production-faithful 보조 실험을 추가합니다.
- 결과가 약하면 숫자를 억지로 개선하지 않고 \`현재 상태 설명 지표\`와 \`내일 예보 지표\`를 분리합니다.
`;
}
