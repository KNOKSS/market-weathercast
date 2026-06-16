import { SymbolCard } from "../components/SymbolCard";
import { SymbolSearch } from "../components/SymbolSearch";
import type { MarketData, MarketSymbol, WeatherScore } from "../types/market";

interface SymbolsPageProps {
  symbols: MarketSymbol[];
  marketData: Record<string, MarketData>;
  scores: Record<string, WeatherScore>;
  selectedSymbolId: string;
  onSelect: (symbolId: string) => void;
  onAddSymbol: (symbol: MarketSymbol) => void;
  onRemoveSymbol: (symbolId: string) => void;
}

export function SymbolsPage({
  symbols,
  marketData,
  scores,
  selectedSymbolId,
  onSelect,
  onAddSymbol,
  onRemoveSymbol,
}: SymbolsPageProps) {
  return (
    <div className="page-flow">
      <SymbolSearch symbols={symbols} onAddSymbol={onAddSymbol} />
      <div className="section-head">
        <div>
          <p className="eyebrow">전체 관측소</p>
          <h2>종목별 시장 날씨</h2>
        </div>
      </div>
      <div className="symbol-grid">
        {symbols.map((symbol) => {
          const data = marketData[symbol.id];
          const score = scores[symbol.id];
          if (!data || !score) {
            return null;
          }

          return (
            <SymbolCard
              key={symbol.id}
              symbol={symbol}
              score={score}
              candles={data.candles}
              selected={selectedSymbolId === symbol.id}
              onSelect={() => onSelect(symbol.id)}
              onRemove={() => onRemoveSymbol(symbol.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
