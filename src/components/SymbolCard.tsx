import type { Candle, MarketSymbol, WeatherScore } from "../types/market";
import { formatPercent, formatPrice, statusLabel } from "../utils/format";
import { WeatherIcon } from "./WeatherIcon";
import { FiveDayForecast } from "./FiveDayForecast";

interface SymbolCardProps {
  symbol: MarketSymbol;
  score: WeatherScore;
  dailyCandles: Candle[];
  selected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
}

function kindLabel(kind: MarketSymbol["kind"]): string {
  if (kind === "crypto") {
    return "Crypto";
  }
  if (kind === "index") {
    return "Index";
  }
  return "Stock";
}

export function SymbolCard({
  symbol,
  score,
  dailyCandles,
  selected = false,
  onSelect,
  onRemove,
}: SymbolCardProps) {
  return (
    <article className={`symbol-card ${selected ? "symbol-card-selected" : ""}`}>
      <button
        className="symbol-card-main-button"
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <div className="symbol-card-head">
          <div>
            <span className="symbol-kind">{kindLabel(symbol.kind)}</span>
            <h3>{symbol.shortLabel}</h3>
            <p>{symbol.description}</p>
          </div>
          <WeatherIcon label={score.label} size={58} />
        </div>
        <FiveDayForecast candles={dailyCandles} kind={symbol.kind} compact />
        <div className="symbol-stats">
          <span>
            현재가
            <strong>{formatPrice(score.currentPrice, symbol.id)}</strong>
          </span>
          <span>
            {symbol.kind === "crypto" ? "24시간 등락" : "오늘 등락"}
            <strong>{formatPercent(score.dayChangePercent)}</strong>
          </span>
          <span>
            날씨
            <strong>{score.label}</strong>
          </span>
          <span>
            온도
            <strong>{score.temperature}</strong>
          </span>
        </div>
      </button>
      <div className="symbol-foot">
        <span>{statusLabel(score.dataStatus)}</span>
        <span>{score.sourceLabel}</span>
        {onRemove && (
          <button className="remove-symbol-button" type="button" onClick={onRemove}>
            삭제
          </button>
        )}
      </div>
    </article>
  );
}
