import { useState } from "react";
import type { Candle, MarketData, MarketSymbol, WeatherScore } from "../types/market";
import { FiveDayForecast } from "../components/FiveDayForecast";
import { formatPercent, formatPrice } from "../utils/format";
import { MiniChart } from "../components/MiniChart";
import { WeatherCard } from "../components/WeatherCard";
import { WeatherIcon } from "../components/WeatherIcon";

interface HomePageProps {
  symbols: MarketSymbol[];
  selectedSymbol: MarketSymbol;
  selectedScore: WeatherScore;
  selectedCandles: Candle[];
  selectedDailyCandles: Candle[];
  overallScore: WeatherScore;
  marketData: Record<string, MarketData>;
  scores: Record<string, WeatherScore>;
  onSelect: (symbolId: string) => void;
}

const WEATHER_DISPLAY_NAMES: Record<string, string> = {
  BTCUSDT: "비트코인",
  ETHUSDT: "이더리움",
  SOLUSDT: "솔라나",
  SP500: "S&P 500",
  NASDAQ: "나스닥",
};

function getWeatherDisplayName(symbol: MarketSymbol): string {
  return WEATHER_DISPLAY_NAMES[symbol.id] ?? symbol.label;
}

export function HomePage({
  symbols,
  selectedSymbol,
  selectedScore,
  selectedCandles,
  selectedDailyCandles,
  overallScore,
  marketData,
  scores,
  onSelect,
}: HomePageProps) {
  const [chartPeriod, setChartPeriod] = useState<"five-day" | "today">("five-day");

  function handleSymbolSelect(symbolId: string) {
    onSelect(symbolId);
    window.setTimeout(() => {
      document.getElementById("selected-market-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
  }

  return (
    <div className="page-flow">
      <WeatherCard
        key={`weather-${selectedSymbol.id}`}
        title={`오늘의 ${getWeatherDisplayName(selectedSymbol)} 날씨`}
        symbol={selectedSymbol}
        score={selectedScore}
      />

      <section className="toolbar-band">
        <label>
          세부 지표
          <select value={selectedSymbol.id} onChange={(event) => handleSymbolSelect(event.target.value)}>
            {symbols.map((symbol) => (
              <option key={symbol.id} value={symbol.id}>
                {symbol.shortLabel} · {symbol.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        className="detail-band selected-market-panel"
        id="selected-market-panel"
        key={`detail-${selectedSymbol.id}`}
      >
        <div className="section-head">
          <div>
            <p className="eyebrow">선택 지표</p>
            <h2>{selectedSymbol.label}</h2>
          </div>
          <div className="chart-view-controls">
            <span className={`observation-pill observation-${selectedScore.dataStatus}`}>
              <i aria-hidden="true" />
              {selectedScore.dataStatus === "live" ? "관측 정상" : "샘플 관측"}
            </span>
            <div className="chart-period-toggle" aria-label="차트 기간">
              <button
                className={chartPeriod === "five-day" ? "active" : ""}
                type="button"
                onClick={() => setChartPeriod("five-day")}
              >
                5일
              </button>
              <button
                className={chartPeriod === "today" ? "active" : ""}
                type="button"
                onClick={() => setChartPeriod("today")}
              >
                오늘
              </button>
            </div>
          </div>
        </div>
        {chartPeriod === "five-day" ? (
          <FiveDayForecast candles={selectedDailyCandles} kind={selectedSymbol.kind} />
        ) : (
          <div className="intraday-chart-panel">
            <div className="intraday-chart-caption">
              <strong>오늘 장중 흐름</strong>
              <span>1분봉 · 최근 48분</span>
            </div>
            <MiniChart candles={selectedCandles} />
          </div>
        )}
        <div className="detail-grid">
          <span>
            현재가
            <strong>{formatPrice(selectedScore.currentPrice, selectedSymbol.id)}</strong>
          </span>
          <span>
            {selectedSymbol.kind === "crypto" ? "24시간 등락" : "오늘 등락"}
            <strong>{formatPercent(selectedScore.dayChangePercent)}</strong>
          </span>
          <span>
            날씨
            <strong>{selectedScore.label}</strong>
          </span>
          <span>
            강수확률
            <strong>{selectedScore.rainChance}%</strong>
          </span>
        </div>
        <p className="detail-summary">{selectedScore.summary}</p>
      </section>

      <section className="benchmark-panel" data-weather={overallScore.label}>
        <div className="benchmark-main">
          <div>
            <p className="eyebrow">FIXED MARKET BENCHMARK</p>
            <h2>전체 시장 기준온도</h2>
            <p>핵심 자산의 흐름을 합산해 시장 전반의 위험선호와 방향을 보여줍니다.</p>
          </div>
          <div className="benchmark-temperature">
            <WeatherIcon label={overallScore.label} size={68} />
            <div><strong>{overallScore.temperature}</strong><small>/ 100 · {overallScore.label}</small></div>
          </div>
        </div>
        <div className="benchmark-track"><i style={{ width: `${overallScore.temperature}%` }} /></div>
        <div className="benchmark-basis">
          <span>S&amp;P 500 <strong>35%</strong></span>
          <span>NASDAQ <strong>30%</strong></span>
          <span>VIX <strong>20%</strong></span>
          <span>BTC <strong>15%</strong></span>
        </div>
        <div className="benchmark-contributions">
          {overallScore.contributions.map((item) => (
            <span key={item.label}>
              {item.label}
              <strong className={item.value >= 0 ? "value-up" : "value-down"}>
                {item.value > 0 ? "+" : ""}{item.value.toFixed(1)}점
              </strong>
            </span>
          ))}
        </div>
      </section>

      <section className="individual-observatories">
        <div className="section-head">
          <div>
            <p className="eyebrow">INDIVIDUAL OBSERVATORIES</p>
            <h2>개별 종목 날씨</h2>
          </div>
          <small>전체 시장 기준온도에 사용자 추가 종목은 반영되지 않습니다.</small>
        </div>
        <div className="score-strip" aria-label="개별 종목 지표 요약">
        {symbols.map((symbol) => {
          const score = scores[symbol.id];
          const data = marketData[symbol.id];
          if (!score || !data) {
            return null;
          }

          return (
            <button
              key={symbol.id}
              type="button"
              className={`score-symbol-button ${symbol.id === selectedSymbol.id ? "selected" : ""}`}
              data-weather={score.label}
              aria-pressed={symbol.id === selectedSymbol.id}
              onClick={() => handleSymbolSelect(symbol.id)}
            >
              <span>{symbol.shortLabel}</span>
              <strong>{score.temperature}</strong>
              <small>{score.label}</small>
              <span className="score-weather-visual" aria-hidden="true">
                <WeatherIcon label={score.label} size={54} />
              </span>
            </button>
          );
        })}
        </div>
      </section>
    </div>
  );
}
