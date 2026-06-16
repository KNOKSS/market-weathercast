import type { MarketSymbol, WeatherScore } from "../types/market";
import { ChecklistForm } from "../components/ChecklistForm";

interface ChecklistPageProps {
  symbols: MarketSymbol[];
  selectedSymbolId: string;
  scores: Record<string, WeatherScore>;
  onSelect: (symbolId: string) => void;
}

export function ChecklistPage({
  symbols,
  selectedSymbolId,
  scores,
  onSelect,
}: ChecklistPageProps) {
  return (
    <div className="page-flow">
      <div className="section-head">
        <div>
          <p className="eyebrow">진입 전 점검</p>
          <h2>체크리스트</h2>
        </div>
      </div>
      <ChecklistForm
        symbols={symbols}
        selectedSymbolId={selectedSymbolId}
        scores={scores}
        onSymbolChange={onSelect}
      />
    </div>
  );
}
