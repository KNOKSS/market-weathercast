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
  onRestoreDefaults: () => void;
}

export function SymbolsPage({
  symbols,
  marketData,
  scores,
  selectedSymbolId,
  onSelect,
  onAddSymbol,
  onRemoveSymbol,
  onRestoreDefaults,
}: SymbolsPageProps) {
  return (
    <div className="page-flow">
      <SymbolSearch symbols={symbols} onAddSymbol={onAddSymbol} />
      <div className="section-head">
        <div>
          <p className="eyebrow">전체 관측소</p>
          <h2>종목별 시장 날씨</h2>
        </div>
        <button className="restore-symbols-button" type="button" onClick={onRestoreDefaults}>
          기본 관측소 복원
        </button>
      </div>
      {symbols.length === 0 ? (
        <section className="empty-stations-panel">
          <span aria-hidden="true">＋</span>
          <h3>표시할 관측소가 없습니다</h3>
          <p>위 검색창에서 원하는 종목을 추가하거나 기본 관측소를 다시 불러오세요.</p>
          <button type="button" onClick={onRestoreDefaults}>기본 관측소 복원</button>
        </section>
      ) : <div className="symbol-grid">
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
              dailyCandles={data.dailyCandles}
              selected={selectedSymbolId === symbol.id}
              onSelect={() => onSelect(symbol.id)}
              onRemove={() => onRemoveSymbol(symbol.id)}
            />
          );
        })}
      </div>}
    </div>
  );
}
