import { useEffect, useMemo, useState } from "react";
import { searchYahooSymbols } from "../api/search";
import type { MarketSymbol, SymbolSearchResult } from "../types/market";

interface SymbolSearchProps {
  symbols: MarketSymbol[];
  onAddSymbol: (symbol: MarketSymbol) => void;
}

export function SymbolSearch({ symbols, onAddSymbol }: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const knownRemoteSymbols = useMemo(
    () => new Set(symbols.map((symbol) => symbol.remoteSymbol)),
    [symbols],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const found = await searchYahooSymbols(trimmed);
        if (alive) {
          setResults(found);
        }
      } catch {
        if (alive) {
          setError("검색 연결이 잠깐 불안정합니다. 티커로 다시 검색해보세요.");
          setResults([]);
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }, 280);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  function addSymbol(symbol: MarketSymbol) {
    onAddSymbol(symbol);
    setQuery("");
    setResults([]);
  }

  return (
    <section className="search-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">관측소 추가</p>
          <h2>미국 종목 검색</h2>
        </div>
      </div>
      <div className="search-box">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="예: AAPL, MSFT, NVDA, TSLA"
          aria-label="미국 종목 검색"
        />
        <span>{loading ? "검색 중" : "Yahoo"}</span>
      </div>
      {error && <p className="search-error">{error}</p>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((result) => {
            const exists = knownRemoteSymbols.has(result.symbol.remoteSymbol);
            return (
              <button
                key={result.symbol.id}
                type="button"
                onClick={() => addSymbol(result.symbol)}
                disabled={exists}
              >
                <span>
                  <strong>{result.symbol.shortLabel}</strong>
                  {result.symbol.label}
                </span>
                <small>
                  {exists ? "추가됨" : "추가"} · {result.exchange} · {result.quoteType}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
