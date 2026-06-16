import type { ChecklistInput, ChecklistResult, WeatherScore } from "../types/market";
import { round } from "../utils/math";

function parsePositive(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function evaluateChecklist(
  input: ChecklistInput,
  weather: WeatherScore | null,
): ChecklistResult {
  const entry = parsePositive(input.entry);
  const stop = parsePositive(input.stop);
  const target = parsePositive(input.target);
  const leverage = parsePositive(input.leverage) ?? 1;
  const positionSize = parsePositive(input.positionSize) ?? 0;
  const warnings: string[] = [];

  if (entry === null) {
    warnings.push("진입가를 입력해야 계산할 수 있습니다.");
  }
  if (stop === null) {
    warnings.push("손절가가 없으면 진입 판단을 보류하는 편이 안전합니다.");
  }
  if (target === null) {
    warnings.push("목표가가 없으면 손익비를 계산할 수 없습니다.");
  }

  if (entry === null || stop === null || target === null) {
    return {
      valid: false,
      rewardRiskRatio: null,
      expectedProfit: null,
      expectedLoss: null,
      leveragedProfit: null,
      leveragedLoss: null,
      warnings,
      finalMessage: "가격 계획부터 다시 적어보세요. 계획 없는 매매는 날씨 앱도 말리기 어렵습니다.",
      tone: "danger",
    };
  }

  const isLong = input.direction === "long";
  const stopIsValid = isLong ? stop < entry : stop > entry;
  const targetIsValid = isLong ? target > entry : target < entry;

  if (!stopIsValid) {
    warnings.push("방향과 손절가 위치가 맞지 않습니다.");
  }
  if (!targetIsValid) {
    warnings.push("방향과 목표가 위치가 맞지 않습니다.");
  }

  const riskPerUnit = Math.abs(entry - stop);
  const rewardPerUnit = Math.abs(target - entry);
  const rewardRiskRatio = riskPerUnit === 0 ? null : rewardPerUnit / riskPerUnit;
  const rawProfitRate = rewardPerUnit / entry;
  const rawLossRate = riskPerUnit / entry;
  const expectedProfit = positionSize > 0 ? positionSize * rawProfitRate : null;
  const expectedLoss = positionSize > 0 ? positionSize * rawLossRate : null;
  const leveragedProfit = positionSize > 0 ? expectedProfit! * leverage : null;
  const leveragedLoss = positionSize > 0 ? expectedLoss! * leverage : null;

  if (rewardRiskRatio !== null && rewardRiskRatio < 1.5) {
    warnings.push("손익비가 1.5 미만입니다. 굳이 들어갈 이유가 약합니다.");
  }
  if (leverage >= 5) {
    warnings.push("레버리지가 5배 이상입니다. 작은 흔들림도 크게 느껴질 수 있습니다.");
  }
  if (leverage >= 10) {
    warnings.push("레버리지가 높습니다. 이건 매매보다 기도에 가까워질 수 있습니다.");
  }

  const liquidationBuffer = 100 / leverage;
  const stopDistancePercent = rawLossRate * 100;
  if (leverage > 1 && stopDistancePercent > liquidationBuffer * 0.65) {
    warnings.push("손절 폭이 예상 청산 거리와 가깝습니다. 레버리지 축소를 검토하세요.");
  }

  if (weather) {
    if (weather.label === "태풍경보") {
      warnings.push("현재 시장 날씨가 태풍경보입니다. 진입은 비추천 구간입니다.");
    }
    if (weather.rainChance >= 60) {
      warnings.push("강수확률이 높습니다. 레버리지를 줄이고 확인 캔들을 기다리는 편이 낫습니다.");
    }
    if (weather.ultraviolet >= 70) {
      warnings.push("FOMO 자외선이 높습니다. 추격성 판단은 특히 조심하세요.");
    }
    if (weather.wind === "강함" || weather.wind === "돌풍") {
      warnings.push("바람이 강합니다. 손절가를 더 넓게 둘지, 포지션을 줄일지 확인하세요.");
    }
  }

  const hardInvalid = !stopIsValid || !targetIsValid;
  const tone: ChecklistResult["tone"] =
    hardInvalid || warnings.length >= 5 ? "danger" : warnings.length >= 2 ? "caution" : "calm";
  const finalMessage =
    tone === "calm"
      ? "계획은 비교적 차분합니다. 그래도 주문 버튼보다 손절선을 먼저 떠올리세요."
      : tone === "caution"
        ? "조심할 조건이 보입니다. 포지션 크기와 레버리지를 한 번 더 낮춰 보세요."
        : "오늘은 참아도 되는 날일 수 있습니다. 계획을 다시 정리하고 들어가도 늦지 않습니다.";

  return {
    valid: !hardInvalid,
    rewardRiskRatio: rewardRiskRatio === null ? null : round(rewardRiskRatio, 2),
    expectedProfit: expectedProfit === null ? null : round(expectedProfit, 2),
    expectedLoss: expectedLoss === null ? null : round(expectedLoss, 2),
    leveragedProfit: leveragedProfit === null ? null : round(leveragedProfit, 2),
    leveragedLoss: leveragedLoss === null ? null : round(leveragedLoss, 2),
    warnings,
    finalMessage,
    tone,
  };
}
