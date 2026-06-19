import type { WeatherScore } from "../types/market";
import { WeatherIcon } from "./WeatherIcon";

interface MarketBenchmarkPanelProps {
  score: WeatherScore;
}

export function MarketBenchmarkPanel({ score }: MarketBenchmarkPanelProps) {
  return (
    <section className="benchmark-panel" data-weather={score.label}>
      <div className="benchmark-main">
        <div>
          <p className="eyebrow">FIXED MARKET BENCHMARK</p>
          <h2>전체 시장 기준온도</h2>
          <p>미국 주식·변동성·비트코인을 합산해 시장의 위험선호와 방향을 한눈에 보여줍니다.</p>
        </div>
        <div className="benchmark-temperature">
          <WeatherIcon label={score.label} size={68} />
          <div><strong>{score.temperature}</strong><small>/ 100 · {score.label}</small></div>
        </div>
      </div>
      <div className="benchmark-track"><i style={{ width: `${score.temperature}%` }} /></div>
      <div className="benchmark-basis">
        <span>S&amp;P 500 <strong>35%</strong></span>
        <span>NASDAQ <strong>30%</strong></span>
        <span>VIX <strong>20%</strong></span>
        <span>BTC <strong>15%</strong></span>
      </div>
      <div className="benchmark-contributions">
        {score.contributions.map((item) => (
          <span key={item.label}>
            {item.label}
            <strong className={item.value >= 0 ? "value-up" : "value-down"}>
              {item.value > 0 ? "+" : ""}{item.value.toFixed(1)}점
            </strong>
          </span>
        ))}
      </div>
    </section>
  );
}
