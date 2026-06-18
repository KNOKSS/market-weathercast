import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMarket } from "./api/markets";
import { NavIcon } from "./components/NavIcon";
import { BENCHMARK_SYMBOLS, DEFAULT_SYMBOLS } from "./data/symbols";
import { createAlerts } from "./engine/alertEngine";
import { DISCLOSURE } from "./engine/messages";
import { aggregateBenchmarkScores, scoreMarket } from "./engine/weatherScore";
import { AlertsPage } from "./pages/AlertsPage";
import { ChecklistPage } from "./pages/ChecklistPage";
import { HomePage } from "./pages/HomePage";
import { SituationRoomPage } from "./pages/SituationRoomPage";
import { SymbolsPage } from "./pages/SymbolsPage";
import type { MarketData, MarketSymbol } from "./types/market";

type Tab = "situation" | "weather" | "alerts" | "checklist";
type WeatherView = "forecast" | "stations";

const USER_SYMBOLS_KEY = "market-weather-user-symbols";
const AUTO_REFRESH_MS = 60_000;
const tabLabels: Record<Tab, string> = {
  situation: "상황실",
  weather: "시장날씨",
  alerts: "브리핑",
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
  const [activeTab, setActiveTab] = useState<Tab>("situation");
  const [weatherView, setWeatherView] = useState<WeatherView>("forecast");
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
  const latestRequestId = useRef(0);

  useEffect(() => {
    let alive = true;
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;

    async function loadMarkets() {
      setLoading(true);
      const requestedSymbols = [
        ...symbols,
        ...BENCHMARK_SYMBOLS.filter(
          (benchmark) => !symbols.some((symbol) => symbol.id === benchmark.id),
        ),
      ];
      const results = await Promise.all(requestedSymbols.map((symbol) => fetchMarket(symbol)));
      if (!alive || requestId !== latestRequestId.current) {
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

  useEffect(() => {
    const refresh = () => setRefreshToken((current) => current + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, AUTO_REFRESH_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", refresh);
    };
  }, []);

  function handleRefresh() {
    setRefreshToken((current) => current + 1);
  }

  function handleAddSymbol(symbol: MarketSymbol) {
    const existing = symbols.find(
      (current) => current.id === symbol.id || current.remoteSymbol === symbol.remoteSymbol,
    );

    if (existing) {
      setSelectedSymbolId(existing.id);
      setWeatherView("forecast");
      setActiveTab("weather");
      return;
    }

    const nextSymbol = { ...symbol, userAdded: true };
    setSymbols((current) => {
      const next = [...current, nextSymbol];
      saveUserSymbols(next);
      return next;
    });
    setSelectedSymbolId(nextSymbol.id);
    setWeatherView("forecast");
    setActiveTab("weather");
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
      setActiveTab("weather");
    }
  }

  const scores = useMemo(() => {
    return Object.fromEntries(
      Object.values(marketData).map((data) => [data.symbol.id, scoreMarket(data)]),
    );
  }, [marketData]);

  const scoreList = useMemo(
    () => symbols.flatMap((symbol) => scores[symbol.id] ? [scores[symbol.id]] : []),
    [scores, symbols],
  );
  const benchmarkScores = useMemo(
    () => ["SP500", "NASDAQ", "VIX", "BTCUSDT"].flatMap((id) => scores[id] ? [scores[id]] : []),
    [scores],
  );
  const overallScore = useMemo(() => aggregateBenchmarkScores(benchmarkScores), [benchmarkScores]);
  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedSymbolId) ?? symbols[0];
  const selectedData = selectedSymbol ? marketData[selectedSymbol.id] : undefined;
  const selectedScore = selectedSymbol ? scores[selectedSymbol.id] : undefined;
  const alerts = useMemo(() => createAlerts(scoreList), [scoreList]);

  const ready = overallScore && selectedSymbol && selectedData && selectedScore;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="masthead-row">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><i /></span>
            <div>
              <p className="app-kicker"><span className="live-dot" /> MARKET WEATHER LIVE</p>
              <strong>시장기상청</strong>
              <small>글로벌 마켓 뉴스룸</small>
            </div>
          </div>
          <div className="masthead-actions">
            <div className="header-observation">
              <span>{loading ? "관측 중" : "마지막 관측"}</span>
              <strong>{refreshedAt ? refreshedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</strong>
            </div>
            <button
              className={`refresh-button ${loading ? "refreshing" : ""}`}
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label={loading ? "시장 데이터 관측 중" : "시장 데이터 새로고침"}
              title={loading ? "관측 중" : "새로고침"}
            >
              <span aria-hidden="true">↻</span>
            </button>
          </div>
        </div>
        <nav className="bottom-nav" aria-label="주요 화면">
          {(Object.keys(tabLabels) as Tab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              <NavIcon name={tab} />
              {tabLabels[tab]}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {activeTab === "situation" ? (
          <SituationRoomPage marketData={marketData} scores={scores} />
        ) : !ready ? (
          <section className="loading-panel">
            <div className="loader" />
            <h1>시장 구름을 관측 중입니다</h1>
            <p>데이터 연결이 느려도 샘플 날씨로 안전하게 넘어갑니다.</p>
          </section>
        ) : (
          <>
            {activeTab === "weather" && (
              <div className="weather-workspace page-flow">
                <section className="weather-workspace-head">
                  <div>
                    <p className="eyebrow">MARKET OBSERVATORY</p>
                    <h2>{weatherView === "forecast" ? "시장 날씨" : "관측소 관리"}</h2>
                  </div>
                  <div className="weather-subnav">
                    <button className={weatherView === "forecast" ? "active" : ""} type="button" onClick={() => setWeatherView("forecast")}>날씨 보기</button>
                    <button className={weatherView === "stations" ? "active" : ""} type="button" onClick={() => setWeatherView("stations")}>관측소 관리</button>
                  </div>
                </section>
                {weatherView === "forecast" ? (
                  <HomePage
                    symbols={symbols}
                    selectedSymbol={selectedSymbol}
                    selectedScore={selectedScore}
                    selectedCandles={selectedData.candles}
                    selectedDailyCandles={selectedData.dailyCandles}
                    overallScore={overallScore}
                    marketData={marketData}
                    scores={scores}
                    onSelect={setSelectedSymbolId}
                  />
                ) : (
                  <SymbolsPage
                    symbols={symbols}
                    marketData={marketData}
                    scores={scores}
                    selectedSymbolId={selectedSymbolId}
                    onSelect={(symbolId) => {
                      setSelectedSymbolId(symbolId);
                      setWeatherView("forecast");
                    }}
                    onAddSymbol={handleAddSymbol}
                    onRemoveSymbol={handleRemoveSymbol}
                  />
                )}
              </div>
            )}
            {activeTab === "alerts" && (
              <AlertsPage
                alerts={alerts}
                overallScore={overallScore}
                scores={scores}
                refreshedAt={refreshedAt}
              />
            )}
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
        <div className="observation-status">
          <span>관측주기 자동 1분</span>
          {refreshedAt && <span>마지막 관측 {refreshedAt.toLocaleTimeString("ko-KR")}</span>}
          <small>1분봉 기준 · 휴장 및 시세 제공처 사정에 따라 지연될 수 있습니다.</small>
        </div>
      </footer>
    </div>
  );
}

export default App;
