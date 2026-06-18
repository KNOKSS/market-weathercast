import type {
  DustLevel,
  MarketData,
  ScoreContribution,
  WeatherLabel,
  WeatherScore,
  WindLevel,
} from "../types/market";
import {
  atrPercent,
  changePercent,
  consecutiveGreenCandles,
  rsi,
  sma,
  volumeRatio,
} from "./indicators";
import { weatherSummary, windMessage } from "./messages";
import { average, clamp, round } from "../utils/math";

const BENCHMARK_WEIGHTS: Record<string, { label: string; weight: number }> = {
  SP500: { label: "S&P 500", weight: 0.35 },
  NASDAQ: { label: "NASDAQ", weight: 0.3 },
  VIX: { label: "VIX", weight: 0.2 },
  BTCUSDT: { label: "BTC", weight: 0.15 },
};

function classifyWind(atr: number | null): WindLevel {
  if (atr === null) return "보통";
  if (atr < 0.55) return "잔잔함";
  if (atr < 1.25) return "보통";
  if (atr < 2.3) return "강함";
  return "돌풍";
}

function classifyDust(ratio: number | null): DustLevel {
  if (ratio === null) return "보통";
  if (ratio >= 0.85) return "좋음";
  if (ratio >= 0.45) return "보통";
  return "나쁨";
}

function classifyWeather(temperature: number, rainChance: number, wind: WindLevel): WeatherLabel {
  if (rainChance >= 78 || wind === "돌풍") return "태풍경보";
  if (rainChance >= 62 || wind === "강함") return "소나기";
  if (temperature >= 82) return "쾌청";
  if (temperature >= 66) return "맑음";
  if (temperature >= 48) return "구름 조금";
  return "흐림";
}

function contribution(
  id: ScoreContribution["id"],
  label: string,
  score: number,
  weight: number,
  reason: string,
): ScoreContribution {
  return { id, label, value: round((score - 50) * weight, 1), reason };
}

export function scoreMarket(data: MarketData): WeatherScore {
  const { candles, dailyCandles, symbol } = data;
  const closes = candles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const lastClose = closes.at(-1) ?? null;

  const intradayRsi = rsi(candles);
  const dailyRsi = rsi(dailyCandles);
  const currentRsi = dailyRsi ?? intradayRsi;
  const currentAtr = atrPercent(candles);
  const dailyAtr = atrPercent(dailyCandles);
  const intradayVolumeRatio = volumeRatio(candles);
  const dailyVolumeRatio = volumeRatio(dailyCandles);
  const currentVolumeRatio = dailyVolumeRatio ?? intradayVolumeRatio;

  const shortChange = changePercent(candles, 4) ?? 0;
  const intradayChange = changePercent(candles, 24) ?? 0;
  const daily5Change = dailyCandles.length > 1
    ? changePercent(dailyCandles, Math.min(5, dailyCandles.length - 1))
    : null;
  const daily20Change = dailyCandles.length > 1
    ? changePercent(dailyCandles, Math.min(20, dailyCandles.length - 1))
    : null;
  const dailySma5 = sma(dailyCloses, Math.min(5, dailyCloses.length));
  const dailySma20 = dailyCloses.length >= 20 ? sma(dailyCloses, 20) : null;
  const dailyTrendGap = dailySma5 && dailySma20
    ? ((dailySma5 - dailySma20) / dailySma20) * 100
    : 0;

  const trendScore = clamp(
    50 +
      (daily5Change ?? 0) * 3.8 +
      (daily20Change ?? 0) * 1.15 +
      dailyTrendGap * 2.8 +
      intradayChange * 0.9,
  );
  const momentumScore = currentRsi === null
    ? clamp(50 + intradayChange * 4)
    : clamp(50 + (currentRsi - 50) * 1.35 + intradayChange * 2.5);
  const targetDailyAtr = symbol.kind === "crypto" ? 3.2 : 1.5;
  const volatilityComfort = clamp(
    78 -
      Math.max(0, (dailyAtr ?? targetDailyAtr) - targetDailyAtr) * 17 -
      Math.max(0, (currentAtr ?? 0.75) - 0.8) * 12,
  );
  const activityScore = currentVolumeRatio === null
    ? symbol.kind === "index" ? 62 : 55
    : clamp(52 + Math.log2(Math.max(0.08, currentVolumeRatio)) * 24);

  const greenRun = consecutiveGreenCandles(candles);
  const overheatPenalty =
    (currentRsi && currentRsi > 72 ? (currentRsi - 72) * 0.7 : 0) +
    Math.max(0, shortChange - 1.2) * 2 +
    Math.max(0, greenRun - 4) * 1.2;
  const directionConflict =
    Math.sign(intradayChange) !== 0 &&
    Math.sign(daily5Change ?? 0) !== 0 &&
    Math.sign(intradayChange) !== Math.sign(daily5Change ?? 0);
  const riskPenalty =
    Math.max(0, (dailyAtr ?? 0) - targetDailyAtr * 1.5) * 3 +
    (directionConflict ? 5 : 0);

  const contributions: ScoreContribution[] = [
    contribution("trend", "기압 · 추세", trendScore, 0.35, `5일 ${round(daily5Change ?? 0, 2)}% · 20일 ${round(daily20Change ?? 0, 2)}%`),
    contribution("momentum", "습도 · 모멘텀", momentumScore, 0.2, `일봉 RSI ${currentRsi === null ? "-" : round(currentRsi, 1)}`),
    contribution("volatility", "바람 · 변동성", volatilityComfort, 0.2, `단기 ATR ${currentAtr === null ? "-" : `${round(currentAtr, 2)}%`}`),
    contribution("activity", "시야 · 거래활력", activityScore, 0.15, `평균 대비 ${currentVolumeRatio === null ? "확인 중" : `${round(currentVolumeRatio, 2)}배`}`),
    {
      id: "risk",
      label: "과열·충돌 보정",
      value: round(-(overheatPenalty + riskPenalty) * 0.45, 1),
      reason: directionConflict ? "단기와 5일 방향이 충돌합니다." : "방향 충돌 신호가 없습니다.",
    },
  ];

  const temperature = round(clamp(50 + contributions.reduce((sum, item) => sum + item.value, 0)));
  const rainChance = round(clamp(
    22 +
      Math.max(0, 55 - volatilityComfort) * 0.65 +
      Math.max(0, Math.abs(shortChange) - 0.6) * 7 +
      (directionConflict ? 15 : 0) +
      (activityScore < 38 ? 10 : 0) +
      (currentRsi !== null && (currentRsi > 76 || currentRsi < 28) ? 10 : 0),
  ));
  const ultraviolet = round(clamp(
    15 + Math.max(0, (currentRsi ?? 50) - 58) * 2 + Math.max(0, shortChange) * 10 + greenRun * 4,
  ));
  const wind = classifyWind(currentAtr);
  const dust = classifyDust(currentVolumeRatio);
  const label = classifyWeather(temperature, rainChance, wind);
  const confidence = data.status === "mock"
    ? 35
    : clamp(55 + (candles.length >= 60 ? 15 : 0) + (dailyCandles.length >= 20 ? 25 : 0) + (data.dayChangePercent != null ? 5 : 0));

  const details = [
    `5일 추세 ${round(daily5Change ?? 0, 2)}%, 20일 추세 ${round(daily20Change ?? 0, 2)}%`,
    `추세 ${round(trendScore)} · 모멘텀 ${round(momentumScore)} · 변동성 안정 ${round(volatilityComfort)} · 거래활력 ${round(activityScore)}`,
    windMessage(wind),
  ];
  if (data.status === "mock") details.push("현재는 샘플 데이터로 표시 중입니다.");

  return {
    symbolId: symbol.id,
    label,
    temperature,
    rainChance,
    wind,
    ultraviolet,
    dust,
    currentPrice: lastClose,
    changePercent: intradayChange,
    dayChangePercent: data.dayChangePercent ?? null,
    rsi: currentRsi === null ? null : round(currentRsi, 1),
    atrPercent: currentAtr === null ? null : round(currentAtr, 2),
    volumeRatio: currentVolumeRatio === null ? null : round(currentVolumeRatio, 2),
    trendScore: round(trendScore),
    momentumScore: round(momentumScore),
    volatilityScore: round(volatilityComfort),
    activityScore: round(activityScore),
    confidence: round(confidence),
    daily5Change: daily5Change === null ? null : round(daily5Change, 2),
    daily20Change: daily20Change === null ? null : round(daily20Change, 2),
    calculationBasis: "1분 흐름 + 5일·20일 일봉",
    contributions,
    dataStatus: data.status,
    sourceLabel: data.sourceLabel,
    summary: weatherSummary(label),
    details,
  };
}

function vixComfort(value: number | null): number {
  if (value === null) return 50;
  return clamp(100 - Math.max(0, value - 12) * 4.2);
}

function vixRainRisk(value: number | null): number {
  if (value === null) return 50;
  return clamp(15 + Math.max(0, value - 12) * 5);
}

export function aggregateBenchmarkScores(scores: WeatherScore[]): WeatherScore | null {
  const available = scores.filter((score) => BENCHMARK_WEIGHTS[score.symbolId]);
  if (available.length === 0) return null;

  const totalWeight = available.reduce((sum, score) => sum + BENCHMARK_WEIGHTS[score.symbolId].weight, 0);
  const weighted = (selector: (score: WeatherScore) => number) => available.reduce(
    (sum, score) => sum + selector(score) * (BENCHMARK_WEIGHTS[score.symbolId].weight / totalWeight),
    0,
  );
  const temperature = round(weighted((score) => score.symbolId === "VIX" ? vixComfort(score.currentPrice) : score.temperature));
  const rainChance = round(weighted((score) => score.symbolId === "VIX" ? vixRainRisk(score.currentPrice) : score.rainChance));
  const atr = weighted((score) => score.atrPercent ?? 0.8);
  const volume = weighted((score) => score.volumeRatio ?? 0.8);
  const wind = classifyWind(atr);
  const dust = classifyDust(volume);
  const label = classifyWeather(temperature, rainChance, wind);
  const nonVix = available.filter((score) => score.symbolId !== "VIX");
  const changes = nonVix.flatMap((score) => score.dayChangePercent === null ? [] : [score.dayChangePercent]);
  const contributions: ScoreContribution[] = available.map((score) => {
    const definition = BENCHMARK_WEIGHTS[score.symbolId];
    const componentTemperature = score.symbolId === "VIX" ? vixComfort(score.currentPrice) : score.temperature;
    const normalizedWeight = definition.weight / totalWeight;
    return {
      id: "benchmark",
      label: definition.label,
      value: round((componentTemperature - 50) * normalizedWeight, 1),
      reason: `기준온도 ${round(componentTemperature)} · 비중 ${round(definition.weight * 100)}%`,
    };
  });

  return {
    symbolId: "OVERALL",
    label,
    temperature,
    rainChance,
    wind,
    ultraviolet: round(weighted((score) => score.ultraviolet)),
    dust,
    currentPrice: null,
    changePercent: weighted((score) => score.changePercent ?? 0),
    dayChangePercent: changes.length > 0 ? round(average(changes), 2) : null,
    rsi: round(weighted((score) => score.rsi ?? 50), 1),
    atrPercent: round(atr, 2),
    volumeRatio: round(volume, 2),
    trendScore: round(weighted((score) => score.symbolId === "VIX" ? vixComfort(score.currentPrice) : score.trendScore)),
    momentumScore: round(weighted((score) => score.momentumScore)),
    volatilityScore: round(weighted((score) => score.symbolId === "VIX" ? vixComfort(score.currentPrice) : score.volatilityScore)),
    activityScore: round(weighted((score) => score.activityScore)),
    confidence: round(weighted((score) => score.confidence)),
    daily5Change: nonVix.length > 0 ? round(average(nonVix.map((score) => score.daily5Change ?? 0)), 2) : null,
    daily20Change: nonVix.length > 0 ? round(average(nonVix.map((score) => score.daily20Change ?? 0)), 2) : null,
    calculationBasis: "S&P 35% · NASDAQ 30% · VIX 20% · BTC 15%",
    contributions,
    dataStatus: available.some((score) => score.dataStatus === "mock") ? "mock" : "live",
    sourceLabel: "고정 시장 바스켓",
    summary: weatherSummary(label),
    details: [
      "사용자 추가 종목과 분리된 고정 벤치마크입니다.",
      `S&P 35% · NASDAQ 30% · VIX 20% · BTC 15%`,
      `전체 강수위험 ${rainChance}% · 산출 신뢰도 ${round(weighted((score) => score.confidence))}%`,
    ],
  };
}
