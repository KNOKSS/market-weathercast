import type { WeatherScore } from "../types/market";

export type MetricKey = "temperature" | "rain" | "wind" | "uv" | "dust" | "rsi";

interface MetricExplanation {
  title: string;
  summary: string;
  bullets: string[];
}

function valueOrDash(value: number | null, suffix = ""): string {
  return value === null ? "-" : `${value}${suffix}`;
}

export function explainMetric(key: MetricKey, score: WeatherScore): MetricExplanation {
  if (key === "temperature") {
    return {
      title: `시장 온도 ${score.temperature} / 100`,
      summary:
        "추세, 모멘텀, 변동성 쾌적도, 거래량을 합친 뒤 과열과 방향 충돌 위험을 빼서 만든 종합 체감 온도입니다.",
      bullets: [
        `추세 점수는 ${score.trendScore}점입니다. 최근 가격이 평균선 위에서 안정적으로 움직일수록 올라갑니다.`,
        `모멘텀 점수는 ${score.momentumScore}점입니다. RSI가 너무 과열되거나 너무 식으면 낮아집니다.`,
        `변동성 쾌적도는 ${score.volatilityScore}점입니다. 흔들림이 너무 커지면 온도가 깎입니다.`,
        `현재 날씨 판단은 ${score.label}입니다.`,
      ],
    };
  }

  if (key === "rain") {
    return {
      title: `강수확률 ${score.rainChance}%`,
      summary:
        "갑작스러운 급락, 휩쏘, 방향 충돌이 나올 가능성을 날씨의 비 확률처럼 표현한 값입니다.",
      bullets: [
        `ATR 기준 변동성은 ${valueOrDash(score.atrPercent, "%")}입니다.`,
        `최근 흐름은 ${valueOrDash(score.changePercent, "%")}입니다. 짧은 시간에 많이 움직이면 강수확률이 올라갑니다.`,
        `RSI는 ${valueOrDash(score.rsi)}입니다. 70 이상 또는 30 이하로 치우치면 위험 신호로 봅니다.`,
        `거래량 비율은 ${valueOrDash(score.volumeRatio)}입니다. 거래량이 부족하면 휩쏘 위험을 더 크게 봅니다.`,
      ],
    };
  }

  if (key === "wind") {
    return {
      title: `바람 ${score.wind}`,
      summary: "바람은 최근 캔들의 평균 변동폭입니다. 손절 폭과 포지션 크기를 정할 때 보는 지표입니다.",
      bullets: [
        `현재 ATR 유사 변동성은 ${valueOrDash(score.atrPercent, "%")}입니다.`,
        "잔잔함은 비교적 좁은 변동폭, 돌풍은 갑작스러운 큰 흔들림을 의미합니다.",
        "바람이 강하면 같은 진입가라도 청산과 손절까지의 체감 거리가 짧아질 수 있습니다.",
      ],
    };
  }

  if (key === "uv") {
    return {
      title: `자외선 ${score.ultraviolet}`,
      summary: "자외선은 FOMO와 과열 위험입니다. 이미 많이 오른 캔들을 뒤쫓는 상황을 조심하라는 신호입니다.",
      bullets: [
        `RSI는 ${valueOrDash(score.rsi)}입니다. RSI가 높을수록 자외선이 강해집니다.`,
        `최근 흐름은 ${valueOrDash(score.changePercent, "%")}입니다. 짧은 급등 뒤에는 값이 올라갑니다.`,
        "연속 양봉이 많을수록 추격성 판단 위험을 더 크게 봅니다.",
      ],
    };
  }

  if (key === "dust") {
    return {
      title: `미세먼지 ${score.dust}`,
      summary: "미세먼지는 유동성 체감입니다. 거래량이 충분하면 맑고, 부족하면 호가가 얇은 느낌으로 봅니다.",
      bullets: [
        `최근 거래량 비율은 ${valueOrDash(score.volumeRatio)}입니다.`,
        "좋음은 최근 거래가 평소보다 충분한 상태입니다.",
        "나쁨은 움직임은 보여도 체결 환경이 얇거나 흔들릴 수 있다는 뜻입니다.",
      ],
    };
  }

  return {
    title: `RSI ${valueOrDash(score.rsi)}`,
    summary: "RSI는 최근 상승 압력과 하락 압력의 균형을 보는 보조 지표입니다.",
    bullets: [
      "70 이상은 과열 가능성을, 30 이하는 과매도 가능성을 봅니다.",
      "시장 온도 계산에서는 적당한 모멘텀은 좋게 보지만, 너무 높은 RSI는 과열 패널티로 반영합니다.",
      `현재 자외선은 ${score.ultraviolet}입니다.`,
    ],
  };
}
