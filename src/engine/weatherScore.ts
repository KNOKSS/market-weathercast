import type { MarketData, WeatherScore, WindLevel, WeatherLabel, DustLevel } from "../types/market";
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

function classifyWind(atr: number | null): WindLevel {
  if (atr === null) {
    return "보통";
  }
  if (atr < 0.55) {
    return "잔잔함";
  }
  if (atr < 1.25) {
    return "보통";
  }
  if (atr < 2.3) {
    return "강함";
  }
  return "돌풍";
}

function classifyDust(ratio: number | null): DustLevel {
  if (ratio === null) {
    return "보통";
  }
  if (ratio >= 0.85) {
    return "좋음";
  }
  if (ratio >= 0.45) {
    return "보통";
  }
  return "나쁨";
}

function classifyWeather(temperature: number, rainChance: number, wind: WindLevel): WeatherLabel {
  if (rainChance >= 78 || wind === "돌풍") {
    return "태풍경보";
  }
  if (rainChance >= 62 || wind === "강함") {
    return "소나기";
  }
  if (temperature >= 82) {
    return "쾌청";
  }
  if (temperature >= 66) {
    return "맑음";
  }
  if (temperature >= 48) {
    return "구름 조금";
  }
  return "흐림";
}

export function scoreMarket(data: MarketData): WeatherScore {
  const { candles, symbol } = data;
  const closes = candles.map((candle) => candle.close);
  const lastClose = closes.at(-1) ?? null;
  const currentRsi = rsi(candles);
  const currentAtr = atrPercent(candles);
  const currentVolumeRatio = volumeRatio(candles);
  const shortChange = changePercent(candles, 4) ?? 0;
  const mediumChange = changePercent(candles, 24) ?? 0;
  const longChange = changePercent(candles, Math.min(72, candles.length - 2)) ?? mediumChange;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const greenRun = consecutiveGreenCandles(candles);

  const trendGap = sma20 && sma50 ? ((sma20 - sma50) / sma50) * 100 : mediumChange;
  const trendScore = clamp(52 + trendGap * 8 + mediumChange * 4 + longChange * 1.2);
  const momentumScore = currentRsi === null ? 55 : clamp(100 - Math.abs(currentRsi - 58) * 2.15);
  const volatilityComfort =
    currentAtr === null ? 58 : clamp(100 - Math.abs(currentAtr - 0.95) * 28);
  const volumeScore =
    currentVolumeRatio === null ? 58 : clamp(44 + Math.log2(currentVolumeRatio + 0.15) * 22);
  const liquidityScore = symbol.kind === "index" ? 68 : volumeScore;

  const overheatPenalty =
    (currentRsi && currentRsi > 72 ? (currentRsi - 72) * 1.7 : 0) +
    (shortChange > 2.5 ? shortChange * 3 : 0) +
    greenRun * 2.5;
  const directionConflict =
    Math.sign(shortChange) !== 0 &&
    Math.sign(mediumChange) !== 0 &&
    Math.sign(shortChange) !== Math.sign(mediumChange);
  const riskPenalty =
    (currentAtr && currentAtr > 1.8 ? (currentAtr - 1.8) * 12 : 0) +
    (directionConflict ? 10 : 0);

  const temperature = round(
    clamp(
      trendScore * 0.3 +
        momentumScore * 0.24 +
        volatilityComfort * 0.16 +
        volumeScore * 0.14 +
        liquidityScore * 0.16 -
        overheatPenalty * 0.45 -
        riskPenalty * 0.55,
    ),
  );

  const rainChance = round(
    clamp(
      24 +
        (currentAtr ?? 0.9) * 18 +
        Math.max(0, Math.abs(shortChange) - 0.9) * 8 +
        (directionConflict ? 18 : 0) +
        (currentVolumeRatio !== null && currentVolumeRatio < 0.55 ? 14 : 0) +
        (currentRsi !== null && (currentRsi > 76 || currentRsi < 28) ? 12 : 0),
    ),
  );

  const ultraviolet = round(
    clamp(
      18 +
        Math.max(0, (currentRsi ?? 50) - 58) * 2 +
        Math.max(0, shortChange) * 12 +
        greenRun * 6,
    ),
  );

  const wind = classifyWind(currentAtr);
  const dust = classifyDust(currentVolumeRatio);
  const label = classifyWeather(temperature, rainChance, wind);

  const details = [
    `추세 점수 ${round(trendScore)} / 100`,
    `모멘텀 점수 ${round(momentumScore)} / 100`,
    `변동성 쾌적도 ${round(volatilityComfort)} / 100`,
    windMessage(wind),
  ];

  if (data.status === "mock") {
    details.push("현재는 샘플 데이터로 안전하게 표시 중입니다.");
  }

  return {
    symbolId: symbol.id,
    label,
    temperature,
    rainChance,
    wind,
    ultraviolet,
    dust,
    currentPrice: lastClose,
    changePercent: mediumChange,
    rsi: currentRsi === null ? null : round(currentRsi, 1),
    atrPercent: currentAtr === null ? null : round(currentAtr, 2),
    volumeRatio: currentVolumeRatio === null ? null : round(currentVolumeRatio, 2),
    trendScore: round(trendScore),
    momentumScore: round(momentumScore),
    volatilityScore: round(volatilityComfort),
    dataStatus: data.status,
    sourceLabel: data.sourceLabel,
    summary: weatherSummary(label),
    details,
  };
}

export function aggregateScores(scores: WeatherScore[]): WeatherScore | null {
  if (scores.length === 0) {
    return null;
  }

  const liveLike = scores.filter((score) => score.dataStatus !== "empty" && score.currentPrice !== null);
  const source = liveLike.length > 0 ? liveLike : scores;
  const temperature = round(average(source.map((score) => score.temperature)));
  const rainChance = round(average(source.map((score) => score.rainChance)));
  const ultraviolet = round(average(source.map((score) => score.ultraviolet)));
  const atr = average(source.map((score) => score.atrPercent ?? 0.9));
  const volumeRatioAverage = average(source.map((score) => score.volumeRatio ?? 0.8));
  const wind = classifyWind(atr);
  const dust = classifyDust(volumeRatioAverage);
  const label = classifyWeather(temperature, rainChance, wind);

  return {
    symbolId: "OVERALL",
    label,
    temperature,
    rainChance,
    wind,
    ultraviolet,
    dust,
    currentPrice: null,
    changePercent: average(source.map((score) => score.changePercent ?? 0)),
    rsi: round(average(source.map((score) => score.rsi ?? 50)), 1),
    atrPercent: round(atr, 2),
    volumeRatio: round(volumeRatioAverage, 2),
    trendScore: round(average(source.map((score) => score.trendScore))),
    momentumScore: round(average(source.map((score) => score.momentumScore))),
    volatilityScore: round(average(source.map((score) => score.volatilityScore))),
    dataStatus: source.some((score) => score.dataStatus === "mock") ? "mock" : "live",
    sourceLabel: "평균 지표",
    summary: weatherSummary(label),
    details: [
      `${source.length}개 대표 지표 평균으로 계산했습니다.`,
      `평균 RSI ${round(average(source.map((score) => score.rsi ?? 50)), 1)}`,
      `평균 강수확률 ${rainChance}%`,
    ],
  };
}
