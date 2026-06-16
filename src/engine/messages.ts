import type { WeatherLabel, WindLevel } from "../types/market";

export function weatherSummary(label: WeatherLabel): string {
  const messages: Record<WeatherLabel, string> = {
    쾌청: "시장 하늘이 꽤 맑습니다. 그래도 손절선은 먼저 확인하세요.",
    맑음: "흐름은 괜찮지만 과속은 금물입니다. 천천히 확인하는 구간입니다.",
    "구름 조금": "방향은 보이지만 중간중간 흔들림이 있습니다. 추격은 조심하세요.",
    흐림: "신호가 또렷하지 않습니다. 작은 포지션과 짧은 판단이 어울립니다.",
    소나기: "휩쏘 가능성이 커졌습니다. 레버리지는 줄이고 확인 후 움직이세요.",
    태풍경보: "변동성이 거칩니다. 새 진입보다 관망이 더 편한 구간입니다.",
  };

  return messages[label];
}

export function windMessage(wind: WindLevel): string {
  const messages: Record<WindLevel, string> = {
    잔잔함: "바람은 잔잔합니다.",
    보통: "바람은 보통입니다.",
    강함: "바람이 강합니다. 손절 폭을 다시 확인하세요.",
    돌풍: "돌풍 구간입니다. 계획 없는 진입은 피곤해질 수 있습니다.",
  };

  return messages[wind];
}

export const DISCLOSURE =
  "이 앱은 투자 조언이나 매수/매도 추천을 제공하지 않습니다. 시장 데이터를 기상 정보처럼 시각화한 보조 도구이며, 모든 투자 판단과 책임은 사용자 본인에게 있습니다.";
