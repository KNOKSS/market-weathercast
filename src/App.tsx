import { useEffect, useMemo, useState } from "react";
import { fetchMarket } from "./api/markets";
import { DEFAULT_SYMBOLS } from "./data/symbols";
import { createAlerts } from "./engine/alertEngine";
import { DISCLOSURE } from "./engine/messages";
import { aggregateScores, scoreMarket } from "./engine/weatherScore";
import { AlertsPage } from "./pages/AlertsPage";
import { ChecklistPage } from "./pages/ChecklistPage";
import { HomePage } from "./pages/HomePage";
import { SymbolsPage } from "./pages/SymbolsPage";
import type { MarketData, MarketSymbol } from "./types/market";

type Tab = "home" | "symbols" | "alerts" | "checklist";

const USER_SYMBOLS_KEY = "market-weather-user-symbols";
const tabLabels: Record<Tab, string> = {
  home: "홈",
  symbols: "시장",
  alerts: "주의보",
  checklist: "체크",
};

function loadSavedSymbols(): MarketSymbol[] {
  try {
    const saved = localStorage.getItem(USER_SYMBOLS_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as MarketSymbol[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((symbol) => symbol?.id && symbol?.remoteSymbol && symbol?.source === "yahoo")
      .map((symbol) => ({ ...symbol, userAdded: true }));
  } catch {
    return [];
  }
}

function saveUserSymbols(symbols: MarketSymbol[]) {
  localStorage.setItem(USER_SYMBOLS_KEY, JSON.stringify(symbols.filter((symbol) => symbol.userAdded)));
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [symbols, setSymbols] = useState<MarketSymbol[]>(() => [
    ...DEFAULT_SYMBOLS,
    ...loadSavedSymbols().filter(
      (saved) =>
        !DEFAULT_SYMBOLS.some(
          (symbol) => symbol.id === saved.id || symbol.remoteSymbol === saved.remoteSymbol,
        ),
    ),
  ]);
  const [selectedSymbolId, setSelectedSymbolId] = useState(DEFAULT_SYMBOLS[0].id);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let alive = true;

    async function loadMarkets() {
      setLoading(true);
      const results = await Promise.all(symbols.map((symbol) => fetchMarket(symbol)));
      if (!alive) {
        return;
      }
      setMarketData(Object.fromEntries(results.map((result) => [result.symbol.id, result])));
      setRefreshedAt(new Date());
      setLoading(false);
    }

    loadMarkets();

    return () => {
      alive = false;
    };
  }, [symbols, refreshToken]);

  function handleRefresh() {
    setRefreshToken((current) => current + 1);
  }

  function handleAddSymbol(symbol: MarketSymbol) {
    const existing = symbols.find(
      (current) => current.id === symbol.id || current.remoteSymbol === symbol.remoteSymbol,
    );

    if (existing) {
      setSelectedSymbolId(existing.id);
      setActiveTab("home");
      return;
    }

    const nextSymbol = { ...symbol, userAdded: true };
    setSymbols((current) => {
      const next = [...current, nextSymbol];
      saveUserSymbols(next);
      return next;
    });
    setSelectedSymbolId(nextSymbol.id);
    setActiveTab("home");
  }

  function handleRemoveSymbol(symbolId: string) {
    const symbol = symbols.find((current) => current.id === symbolId);
    if (!symbol?.userAdded) {
      return;
    }

    setSymbols((current) => {
      const next = current.filter((item) => item.id !== symbolId);
      saveUserSymbols(next);
      return next;
    });
    setMarketData((current) => {
      const next = { ...current };
      delete next[symbolId];
      return next;
    });
    if (selectedSymbolId === symbolId) {
      setSelectedSymbolId(DEFAULT_SYMBOLS[0].id);
      setActiveTab("home");
    }
  }

  const scores = useMemo(() => {
    return Object.fromEntries(
      Object.values(marketData).map((data) => [data.symbol.id, scoreMarket(data)]),
    );
  }, [marketData]);

  const scoreList = useMemo(() => Object.values(scores), [scores]);
  const overallScore = useMemo(() => aggregateScores(scoreList), [scoreList]);
  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedSymbolId) ?? symbols[0];
  const selectedData = selectedSymbol ? marketData[selectedSymbol.id] : undefined;
  const selectedScore = selectedSymbol ? scores[selectedSymbol.id] : undefined;
  const alerts = useMemo(() => createAlerts(scoreList), [scoreList]);

  const ready = overallScore && selectedSymbol && selectedData && selectedScore;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">매매해도 좋은데이?</p>
          <strong>시장기상청</strong>
        </div>
        <button className="refresh-button" type="button" onClick={handleRefresh} disabled={loading}>
          {loading ? "관측 중" : "새로고침"}
        </button>
      </header>

      <nav className="bottom-nav" aria-label="주요 화면">
        {(Object.keys(tabLabels) as Tab[]).map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            <span className={`nav-icon nav-icon-${tab}`} aria-hidden="true" />
            {tabLabels[tab]}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {!ready ? (
          <section className="loading-panel">
            <div className="loader" />
            <h1>시장 구름을 관측 중입니다</h1>
            <p>데이터 연결이 느려도 샘플 날씨로 안전하게 넘어갑니다.</p>
          </section>
        ) : (
          <>
            {activeTab === "home" && (
              <HomePage
                symbols={symbols}
                selectedSymbol={selectedSymbol}
                selectedScore={selectedScore}
                selectedCandles={selectedData.candles}
                overallScore={overallScore}
                marketData={marketData}
                scores={scores}
                onSelect={setSelectedSymbolId}
              />
            )}
            {activeTab === "symbols" && (
              <SymbolsPage
                symbols={symbols}
                marketData={marketData}
                scores={scores}
                selectedSymbolId={selectedSymbolId}
                onSelect={setSelectedSymbolId}
                onAddSymbol={handleAddSymbol}
                onRemoveSymbol={handleRemoveSymbol}
              />
            )}
            {activeTab === "alerts" && <AlertsPage alerts={alerts} />}
            {activeTab === "checklist" && (
              <ChecklistPage
                symbols={symbols}
                selectedSymbolId={selectedSymbolId}
                scores={scores}
                onSelect={setSelectedSymbolId}
              />
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>{DISCLOSURE}</p>
        {refreshedAt && <span>마지막 관측 {refreshedAt.toLocaleTimeString("ko-KR")}</span>}
      </footer>
    </div>
  );
}

export default App;
