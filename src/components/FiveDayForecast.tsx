import type { Candle, MarketKind, WeatherLabel } from "../types/market";
import { WeatherIcon } from "./WeatherIcon";

interface FiveDayForecastProps {
  candles: Candle[];
  kind: MarketKind;
  compact?: boolean;
}

function percentChange(current: number, previous: number): number {
  return previous === 0 ? 0 : ((current - previous) / previous) * 100;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function weatherForDay(change: number, range: number): WeatherLabel {
  if (change <= -2.4 || (change < 0 && range >= 4.5)) {
    return "태풍경보";
  }
  if (change <= -1.1 || (change < 0 && range >= 3)) {
    return "소나기";
  }
  if (change < -0.25) {
    return "흐림";
  }
  if (change < 0.25) {
    return "구름 조금";
  }
  if (change < 1.2) {
    return "맑음";
  }
  return "쾌청";
}

function dateParts(time: number, kind: MarketKind): { weekday: string; date: string } {
  const timeZone = kind === "crypto" ? "Asia/Seoul" : "America/New_York";
  const date = new Date(time);
  return {
    weekday: new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone }).format(date),
    date: new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      timeZone,
    }).format(date),
  };
}

export function FiveDayForecast({ candles, kind, compact = false }: FiveDayForecastProps) {
  const windowCandles = candles.slice(-6);
  const visibleCandles = windowCandles.slice(-5);

  if (visibleCandles.length < 2) {
    return <div className="five-day-empty">5일 관측 데이터를 불러오는 중입니다.</div>;
  }

  const baseClose = windowCandles.length > visibleCandles.length
    ? windowCandles[0].close
    : visibleCandles[0].open;
  const observations = visibleCandles.map((candle, index) => {
    const previousClose = index === 0 ? baseClose : visibleCandles[index - 1].close;
    const change = percentChange(candle.close, previousClose);
    const range = percentChange(candle.high, candle.low);
    return {
      candle,
      change,
      range,
      weather: weatherForDay(change, range),
      ...dateParts(candle.time, kind),
    };
  });
  const totalChange = percentChange(visibleCandles.at(-1)!.close, baseClose);
  const upDays = observations.filter((day) => day.change > 0.05).length;
  const downDays = observations.filter((day) => day.change < -0.05).length;
  const trend = totalChange > 0.5 ? "상승" : totalChange < -0.5 ? "하락" : "보합";
  const arrow = trend === "상승" ? "↗" : trend === "하락" ? "↘" : "→";

  return (
    <section className={`five-day-forecast ${compact ? "five-day-compact" : ""}`}>
      {!compact && (
        <div className="forecast-heading">
          <div>
            <span>지난 5일 관측</span>
            <small>{kind === "crypto" ? "최근 5일" : "최근 5거래일"}</small>
          </div>
          <strong className={`trend-badge trend-${trend}`}>5일 추세 {trend} {arrow}</strong>
        </div>
      )}

      <div className="forecast-days">
        {observations.map((day, index) => {
          const direction = day.change > 0.05 ? "up" : day.change < -0.05 ? "down" : "flat";
          return (
            <article
              className={`forecast-day forecast-${direction} ${index === observations.length - 1 ? "forecast-latest" : ""}`}
              key={day.candle.time}
              title={`${day.date} · 일중 고저폭 ${day.range.toFixed(2)}%`}
            >
              <div className="forecast-date">
                <strong>{day.weekday}</strong>
                <small>{day.date}</small>
              </div>
              <WeatherIcon label={day.weather} size={compact ? 38 : 50} />
              <b>{formatPercent(day.change)}</b>
              {!compact && <small className="forecast-range">고저폭 {day.range.toFixed(1)}%</small>}
              {index === observations.length - 1 && <em>최근</em>}
            </article>
          );
        })}
      </div>

      {!compact && (
        <div className="forecast-summary">
          <span>5일 누적 <strong className={totalChange >= 0 ? "value-up" : "value-down"}>{formatPercent(totalChange)}</strong></span>
          <span>상승 {upDays}일 · 하락 {downDays}일</span>
        </div>
      )}
    </section>
  );
}
