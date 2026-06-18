import { useMemo, useState } from "react";
import type { MarketSymbol, ScoreContribution, WeatherScore } from "../types/market";
import { StationIdentity } from "./StationIdentity";
import { WeatherIcon } from "./WeatherIcon";

interface WeatherCardProps {
  title: string;
  symbol: MarketSymbol;
  score: WeatherScore;
}

type InstrumentKey = "temperature" | "rain" | "trend" | "momentum" | "volatility" | "activity";

function scoreState(value: number): string {
  if (value >= 68) return "우호적";
  if (value >= 56) return "양호";
  if (value >= 44) return "중립";
  if (value >= 32) return "약함";
  return "경계";
}

function direction(value: number): string {
  if (value >= 58) return "↗";
  if (value <= 42) return "↘";
  return "→";
}

function contributionText(value: number): string {
  if (value === 0) return "±0점";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}점`;
}

export function WeatherCard({ title, symbol, score }: WeatherCardProps) {
  const [activeInstrument, setActiveInstrument] = useState<InstrumentKey>("temperature");
  const signals = useMemo(() => [
    {
      id: "trend" as const,
      weather: "기압",
      finance: "추세",
      icon: "↗",
      value: score.trendScore,
      raw: `5일 ${score.daily5Change ?? "-"}% · 20일 ${score.daily20Change ?? "-"}%`,
    },
    {
      id: "momentum" as const,
      weather: "습도",
      finance: "모멘텀",
      icon: "◉",
      value: score.momentumScore,
      raw: `일봉 RSI ${score.rsi ?? "-"}`,
    },
    {
      id: "volatility" as const,
      weather: "바람",
      finance: "변동성 안정",
      icon: "≋",
      value: score.volatilityScore,
      raw: `단기 ATR ${score.atrPercent ?? "-"}%`,
    },
    {
      id: "activity" as const,
      weather: "시야",
      finance: "거래활력",
      icon: "◎",
      value: score.activityScore,
      raw: `평균 대비 ${score.volumeRatio ?? "-"}배`,
    },
  ], [score]);

  const activeSignal = signals.find((signal) => signal.id === activeInstrument);
  const activeContribution = score.contributions.find((item) => item.id === activeInstrument);
  const detail = activeInstrument === "temperature"
    ? {
        title: `시장 체감온도 ${score.temperature} / 100`,
        summary: `추세·모멘텀·변동성·거래활력과 과열 위험을 합산한 결과입니다. 현재 판정은 ${score.label}입니다.`,
      }
    : activeInstrument === "rain"
      ? {
          title: `강수위험 ${score.rainChance}%`,
          summary: "변동성 확대, 단기·중기 방향 충돌, 거래량 부족, RSI 극단 구간을 위험 신호로 계산합니다.",
        }
      : {
          title: `${activeSignal?.weather} · ${activeSignal?.finance} ${activeSignal?.value} / 100`,
          summary: `${activeSignal?.raw} · 현재 상태는 ${scoreState(activeSignal?.value ?? 50)}입니다.`,
        };

  const detailContributions: ScoreContribution[] = activeInstrument === "temperature"
    ? score.contributions
    : activeContribution ? [activeContribution] : [];

  return (
    <section className={`weather-card weather-${score.label}`} data-weather={score.label}>
      <div className="weather-card-main">
        <div>
          <StationIdentity symbol={symbol} />
          <h1>{title}</h1>
          <div className="weather-label-row">
            <span className="weather-label">{score.label}</span>
            <span className={`confidence-pill ${score.confidence < 70 ? "confidence-low" : ""}`}>
              <i /> 산출 신뢰도 {score.confidence}%
            </span>
          </div>
        </div>
        <WeatherIcon label={score.label} />
      </div>
      <p className="weather-summary">{score.summary}</p>

      <div className="core-meter-grid">
        <button
          className={`core-meter core-temperature ${activeInstrument === "temperature" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveInstrument("temperature")}
        >
          <div className="core-meter-head"><span>시장 체감온도</span><em>핵심 결과</em></div>
          <div className="core-meter-value"><strong>{score.temperature}</strong><small>/ 100</small><b>{score.label}</b></div>
          <div className="instrument-track"><i style={{ width: `${score.temperature}%` }} /></div>
          <small>{score.calculationBasis}</small>
        </button>
        <button
          className={`core-meter core-rain ${activeInstrument === "rain" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveInstrument("rain")}
        >
          <div className="core-meter-head"><span>강수위험</span><em>위험 결과</em></div>
          <div className="core-meter-value"><strong>{score.rainChance}</strong><small>%</small><b>{score.rainChance >= 60 ? "주의" : score.rainChance >= 40 ? "보통" : "낮음"}</b></div>
          <div className="instrument-track"><i style={{ width: `${score.rainChance}%` }} /></div>
          <small>방향 충돌·변동성·거래량 위험</small>
        </button>
      </div>

      <div className="signal-instrument-grid">
        {signals.map((signal) => (
          <button
            className={`signal-instrument ${activeInstrument === signal.id ? "active" : ""}`}
            type="button"
            key={signal.id}
            onClick={() => setActiveInstrument(signal.id)}
          >
            <span className="signal-icon" aria-hidden="true">{signal.icon}</span>
            <div>
              <span>{signal.weather} · {signal.finance}</span>
              <strong>{signal.value} <small>{direction(signal.value)}</small></strong>
              <em>{scoreState(signal.value)}</em>
            </div>
            <div className="signal-meter"><i style={{ width: `${signal.value}%` }} /></div>
            <small>{signal.raw}</small>
          </button>
        ))}
      </div>

      <article className="instrument-explain" aria-live="polite">
        <div className="instrument-explain-head">
          <div>
            <span>현재 판정</span>
            <strong>{detail.title}</strong>
          </div>
          <small>{score.calculationBasis}</small>
        </div>
        <p>{detail.summary}</p>
        <div className="contribution-list">
          {detailContributions.map((item) => (
            <div key={`${item.id}-${item.label}`}>
              <span>{item.label}<small>{item.reason}</small></span>
              <strong className={item.value >= 0 ? "value-up" : "value-down"}>{contributionText(item.value)}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
