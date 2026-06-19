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
  marketData,
  scores,
  onSelect,
}: HomePageProps) {
  const [chartPeriod, setChartPeriod] = useState<"five-day" | "today">("five-day");

  function handleSymbolSelect(symbolId: string) {
    onSelect(symbolId);
    window.setTimeout(() => {
      document.getElementById("market-weather-top")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
  }

  return (
    <div className="page-flow">
      <div id="market-weather-top" className="weather-top-anchor">
        <WeatherCard
          key={`weather-${selectedSymbol.id}`}
          title={`오늘의 ${getWeatherDisplayName(selectedSymbol)} 날씨`}
          symbol={selectedSymbol}
          score={selectedScore}
        />
      </div>

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

      <section className="individual-observatories">
        <div className="section-head">
          <div>
            <p className="eyebrow">INDIVIDUAL OBSERVATORIES</p>
            <h2>개별 종목 날씨</h2>
          </div>
          <small>종목을 선택하면 상단 관측소가 바뀝니다. 사용자 추가 종목은 전체 시장 기준온도에 반영되지 않습니다.</small>
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
