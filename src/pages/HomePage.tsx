import type { Candle, MarketData, MarketSymbol, WeatherScore } from "../types/market";
import { formatPercent, formatPrice, statusLabel } from "../utils/format";
import { MiniChart } from "../components/MiniChart";
import { WeatherCard } from "../components/WeatherCard";

interface HomePageProps {
  symbols: MarketSymbol[];
  selectedSymbol: MarketSymbol;
  selectedScore: WeatherScore;
  selectedCandles: Candle[];
  overallScore: WeatherScore;
  marketData: Record<string, MarketData>;
  scores: Record<string, WeatherScore>;
  onSelect: (symbolId: string) => void;
}

export function HomePage({
  symbols,
  selectedSymbol,
  selectedScore,
  selectedCandles,
  overallScore,
  marketData,
  scores,
  onSelect,
}: HomePageProps) {
  return (
    <div className="page-flow">
      <WeatherCard
        title="오늘의 시장 날씨"
        subtitle={`${selectedSymbol.shortLabel} 관측소`}
        score={selectedScore}
      />

      <section className="toolbar-band">
        <label>
          세부 지표
          <select value={selectedSymbol.id} onChange={(event) => onSelect(event.target.value)}>
            {symbols.map((symbol) => (
              <option key={symbol.id} value={symbol.id}>
                {symbol.shortLabel} · {symbol.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="detail-band">
        <div className="section-head">
          <div>
            <p className="eyebrow">선택 지표</p>
            <h2>{selectedSymbol.label}</h2>
          </div>
          <span className="status-pill">{statusLabel(selectedScore.dataStatus)}</span>
        </div>
        <MiniChart candles={selectedCandles} />
        <div className="detail-grid">
          <span>
            현재가
            <strong>{formatPrice(selectedScore.currentPrice, selectedSymbol.id)}</strong>
          </span>
          <span>
            흐름
            <strong>{formatPercent(selectedScore.changePercent)}</strong>
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

      <section className="score-strip" aria-label="대표 지표 요약">
        <div className="score-item overall-score">
          <span>전체 평균</span>
          <strong>{overallScore.temperature}</strong>
          <small>{overallScore.label}</small>
        </div>
        {symbols.map((symbol) => {
          const score = scores[symbol.id];
          const data = marketData[symbol.id];
          if (!score || !data) {
            return null;
          }

          return (
            <button key={symbol.id} type="button" onClick={() => onSelect(symbol.id)}>
              <span>{symbol.shortLabel}</span>
              <strong>{score.temperature}</strong>
              <small>{score.label}</small>
            </button>
          );
        })}
      </section>
    </div>
  );
}
