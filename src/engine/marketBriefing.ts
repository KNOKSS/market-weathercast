import type { WeatherScore } from "../types/market";

export interface BriefingLine {
  label: string;
  text: string;
  tone: "positive" | "neutral" | "caution";
}

function formatChange(value: number | null | undefined): string {
  if (value === null || value === undefined) return "확인 중";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function marketDeskHeadline(score: WeatherScore): string {
  if (score.temperature >= 64) return "위험선호가 우세하지만 과열 신호를 함께 확인할 구간";
  if (score.temperature >= 54) return "완만한 위험선호 속에서 종목별 차별화가 이어지는 구간";
  if (score.temperature >= 44) return "뚜렷한 방향보다 확인이 필요한 중립 구간";
  if (score.temperature >= 34) return "방어적 흐름이 우세해 추격보다 위험 관리가 필요한 구간";
  return "시장 전반의 경계 신호가 강해진 방어 우선 구간";
}

export function buildMarketBriefing(
  overallScore: WeatherScore,
  scores: Record<string, WeatherScore>,
): BriefingLine[] {
  const sp = scores.SP500?.dayChangePercent;
  const nasdaq = scores.NASDAQ?.dayChangePercent;
  const vix = scores.VIX?.currentPrice;
  const btc = scores.BTCUSDT?.dayChangePercent;
  const equitiesAverage = sp != null && nasdaq != null ? (sp + nasdaq) / 2 : null;

  const equityTone = equitiesAverage == null ? "neutral" : equitiesAverage > 0.35 ? "positive" : equitiesAverage < -0.35 ? "caution" : "neutral";
  const equityText = sp == null || nasdaq == null
    ? "미국 주요 지수의 정규장 흐름을 확인하고 있습니다."
    : `S&P 500 ${formatChange(sp)}, 나스닥 ${formatChange(nasdaq)}로 ${equityTone === "positive" ? "주식 위험선호가 우세합니다" : equityTone === "caution" ? "주식시장의 방어 심리가 관측됩니다" : "지수 방향이 엇갈리거나 제한적입니다"}.`;

  const vixTone = vix == null ? "neutral" : vix >= 25 ? "caution" : vix < 18 ? "positive" : "neutral";
  const vixText = vix == null
    ? "변동성 지수는 현재 확인 중입니다."
    : `VIX ${vix.toFixed(1)}로 ${vixTone === "caution" ? "가격 변동 위험이 높은 구간입니다" : vixTone === "positive" ? "시장 긴장도는 비교적 안정적입니다" : "평균적인 경계 수준을 유지하고 있습니다"}.`;

  const btcTone = btc == null ? "neutral" : btc > 1 ? "positive" : btc < -1 ? "caution" : "neutral";
  const btcText = btc == null
    ? "가상자산 위험선호는 확인 중입니다."
    : `비트코인은 24시간 기준 ${formatChange(btc)}로 ${btcTone === "positive" ? "고위험 자산 선호가 강화됐습니다" : btcTone === "caution" ? "고위험 자산 심리가 위축됐습니다" : "뚜렷한 방향 없이 움직이고 있습니다"}.`;

  return [
    { label: "주식", text: equityText, tone: equityTone },
    { label: "변동성", text: vixText, tone: vixTone },
    { label: "가상자산", text: btcText, tone: btcTone },
    {
      label: "종합",
      text: `전체 시장 체감온도는 ${overallScore.temperature}점, 강수위험은 ${overallScore.rainChance}%입니다.`,
      tone: overallScore.temperature >= 56 ? "positive" : overallScore.temperature < 40 ? "caution" : "neutral",
    },
  ];
}
