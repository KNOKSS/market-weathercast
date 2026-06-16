import type { MarketAlert, WeatherScore } from "../types/market";

export function createAlerts(scores: WeatherScore[]): MarketAlert[] {
  const alerts: MarketAlert[] = [];

  scores.forEach((score) => {
    if (score.dataStatus === "mock") {
      alerts.push({
        id: `${score.symbolId}-mock`,
        level: "안내",
        symbolId: score.symbolId,
        title: "데이터 확인 필요",
        message: `${score.symbolId}는 현재 샘플 데이터로 표시 중입니다. 실제 판단 전 가격원을 한 번 더 확인하세요.`,
      });
    }

    if (score.rainChance >= 70) {
      alerts.push({
        id: `${score.symbolId}-rain`,
        level: "주의보",
        symbolId: score.symbolId,
        title: "휩쏘 주의",
        message: `${score.symbolId} 강수확률이 ${score.rainChance}%입니다. 새 진입보다 확인 시간이 더 중요합니다.`,
      });
    }

    if (score.wind === "돌풍" || score.wind === "강함") {
      alerts.push({
        id: `${score.symbolId}-wind`,
        level: score.wind === "돌풍" ? "경보" : "주의보",
        symbolId: score.symbolId,
        title: "변동성 확대",
        message: `${score.symbolId} 바람이 ${score.wind}입니다. 레버리지와 손절 폭을 보수적으로 점검하세요.`,
      });
    }

    if (score.ultraviolet >= 72) {
      alerts.push({
        id: `${score.symbolId}-uv`,
        level: "주의보",
        symbolId: score.symbolId,
        title: "FOMO 자외선",
        message: `${score.symbolId} 자외선이 높습니다. 이미 달린 캔들을 뒤쫓는 선택은 피곤할 수 있습니다.`,
      });
    }

    if (score.temperature < 35) {
      alerts.push({
        id: `${score.symbolId}-cold`,
        level: "한숨",
        symbolId: score.symbolId,
        title: "시장 체온 낮음",
        message: `${score.symbolId} 시장 온도가 낮습니다. 오늘은 차 한 잔 마시는 판단도 전략입니다.`,
      });
    }
  });

  if (alerts.length === 0 && scores.length > 0) {
    alerts.push({
      id: "calm-default",
      level: "안내",
      symbolId: "전체",
      title: "특별 경보 없음",
      message: "큰 경보는 없습니다. 그래도 진입 전 체크리스트는 가볍게라도 확인하세요.",
    });
  }

  return alerts;
}
