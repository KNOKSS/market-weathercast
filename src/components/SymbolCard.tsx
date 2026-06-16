import type { Candle, MarketSymbol, WeatherScore } from "../types/market";
import { formatPercent, formatPrice, statusLabel } from "../utils/format";
import { MiniChart } from "./MiniChart";
import { WeatherIcon } from "./WeatherIcon";

interface SymbolCardProps {
  symbol: MarketSymbol;
  score: WeatherScore;
  candles: Candle[];
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
  candles,
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
        <MiniChart candles={candles} />
        <div className="symbol-stats">
          <span>
            현재가
            <strong>{formatPrice(score.currentPrice, symbol.id)}</strong>
          </span>
          <span>
            24h 흐름
            <strong>{formatPercent(score.changePercent)}</strong>
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
        {symbol.userAdded && (
          <button className="remove-symbol-button" type="button" onClick={onRemove}>
            빼기
          </button>
        )}
      </div>
    </article>
  );
}
