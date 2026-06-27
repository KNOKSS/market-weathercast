import { useEffect, useMemo, useRef, useState } from "react";
import { fetchMarket } from "./api/markets";
import { fetchTomorrowForecast } from "./api/forecast";
import { NavIcon } from "./components/NavIcon";
import { BENCHMARK_SYMBOLS, DEFAULT_SYMBOLS } from "./data/symbols";
import { createAlerts } from "./engine/alertEngine";
import { DISCLOSURE, FORECAST_DISCLOSURE } from "./engine/messages";
import { aggregateBenchmarkScores, scoreMarket } from "./engine/weatherScore";
import { AlertsPage } from "./pages/AlertsPage";
import { ChecklistPage } from "./pages/ChecklistPage";
import { HomePage, type MarketWeatherMode } from "./pages/HomePage";
import { SituationRoomPage } from "./pages/SituationRoomPage";
import { SymbolsPage } from "./pages/SymbolsPage";
import type { MarketData, MarketSymbol, TomorrowForecastData } from "./types/market";

type Tab = "situation" | "weather" | "alerts" | "checklist";
type WeatherView = "forecast" | "stations";

const USER_SYMBOLS_KEY = "market-weather-user-symbols";
const MARKET_SYMBOLS_KEY = "market-weather-symbols-v2";
const UI_STATE_KEY = "market-weather-ui-state-v1";
const AUTO_REFRESH_MS = 60_000;
const VALID_TABS: Tab[] = ["situation", "weather", "alerts", "checklist"];
const VALID_WEATHER_VIEWS: WeatherView[] = ["forecast", "stations"];
const VALID_MARKET_WEATHER_MODES: MarketWeatherMode[] = ["today", "tomorrow"];
const tabLabels: Record<Tab, string> = {
  situation: "상황실",
  weather: "시장날씨",
  alerts: "브리핑",
  checklist: "체크",
};

interface PersistedUiState {
  activeTab: Tab;
  weatherView: WeatherView;
  selectedSymbolId: string;
  marketWeatherMode: MarketWeatherMode;
}

function loadUiState(): PersistedUiState {
  const fallback: PersistedUiState = {
    activeTab: "situation",
    weatherView: "forecast",
    selectedSymbolId: DEFAULT_SYMBOLS[0].id,
    marketWeatherMode: "today",
  };

  try {
    const saved = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}") as Partial<PersistedUiState>;
    const query = new URLSearchParams(window.location.search);
    const requestedTab = query.get("tab") as Tab | null;
    const requestedMode = query.get("mode") as MarketWeatherMode | null;
    const requestedSymbol = query.get("symbol");
    return {
      activeTab: requestedTab && VALID_TABS.includes(requestedTab)
        ? requestedTab
        : VALID_TABS.includes(saved.activeTab as Tab) ? saved.activeTab as Tab : fallback.activeTab,
      weatherView: requestedTab === "weather"
        ? "forecast"
        : VALID_WEATHER_VIEWS.includes(saved.weatherView as WeatherView)
        ? saved.weatherView as WeatherView
        : fallback.weatherView,
      selectedSymbolId: requestedSymbol || (typeof saved.selectedSymbolId === "string"
        ? saved.selectedSymbolId
        : fallback.selectedSymbolId),
      marketWeatherMode: requestedMode && VALID_MARKET_WEATHER_MODES.includes(requestedMode)
        ? requestedMode
        : VALID_MARKET_WEATHER_MODES.includes(saved.marketWeatherMode as MarketWeatherMode)
        ? saved.marketWeatherMode as MarketWeatherMode
        : fallback.marketWeatherMode,
    };
  } catch {
    return fallback;
  }
}

function saveUiState(state: PersistedUiState) {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or storage restrictions must not block the dashboard.
  }
}

function isSavedSymbol(symbol: MarketSymbol): boolean {
  return Boolean(
    symbol?.id &&
    symbol?.remoteSymbol &&
    ["binance", "yahoo", "sample"].includes(symbol.source),
  );
}

function loadSymbols(): MarketSymbol[] {
  try {
    const savedLayout = localStorage.getItem(MARKET_SYMBOLS_KEY);
    if (savedLayout) {
      const parsedLayout = JSON.parse(savedLayout) as MarketSymbol[];
      if (Array.isArray(parsedLayout)) {
        return parsedLayout.filter((symbol) => isSavedSymbol(symbol) && symbol.id !== "SOLUSDT");
      }
    }

    const legacy = JSON.parse(localStorage.getItem(USER_SYMBOLS_KEY) || "[]") as MarketSymbol[];
    const userSymbols = Array.isArray(legacy)
      ? legacy.filter((symbol) => isSavedSymbol(symbol) && symbol.id !== "SOLUSDT").map((symbol) => ({ ...symbol, userAdded: true }))
      : [];

    return [
      ...DEFAULT_SYMBOLS,
      ...userSymbols.filter(
        (saved) => !DEFAULT_SYMBOLS.some(
          (symbol) => symbol.id === saved.id || symbol.remoteSymbol === saved.remoteSymbol,
        ),
      ),
    ];
  } catch {
    return DEFAULT_SYMBOLS;
  }
}

function saveSymbols(symbols: MarketSymbol[]) {
  try {
    localStorage.setItem(MARKET_SYMBOLS_KEY, JSON.stringify(symbols));
  } catch {
    // Storage restrictions must not block editing the observatory list.
  }
}

function App() {
  const [initialUiState] = useState(loadUiState);
  const [activeTab, setActiveTab] = useState<Tab>(initialUiState.activeTab);
  const [weatherView, setWeatherView] = useState<WeatherView>(initialUiState.weatherView);
  const [symbols, setSymbols] = useState<MarketSymbol[]>(loadSymbols);
  const [selectedSymbolId, setSelectedSymbolId] = useState(initialUiState.selectedSymbolId);
  const [marketWeatherMode, setMarketWeatherMode] = useState<MarketWeatherMode>(initialUiState.marketWeatherMode);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [tomorrowForecast, setTomorrowForecast] = useState<TomorrowForecastData | null>(null);
  const [tomorrowForecastLoading, setTomorrowForecastLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const latestRequestId = useRef(0);

  useEffect(() => {
    if (!symbols.some((symbol) => symbol.id === "SOLUSDT")) return;
    setSymbols((current) => {
      const next = current.filter((symbol) => symbol.id !== "SOLUSDT");
      saveSymbols(next);
      return next;
    });
  }, [symbols]);

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
    let alive = true;
    setTomorrowForecastLoading(true);
    fetchTomorrowForecast().then((result) => {
      if (!alive) return;
      setTomorrowForecast(result);
      setTomorrowForecastLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  useEffect(() => {
    saveUiState({ activeTab, weatherView, selectedSymbolId, marketWeatherMode });
  }, [activeTab, weatherView, selectedSymbolId, marketWeatherMode]);

  useEffect(() => {
    if (symbols.length === 0) {
      if (selectedSymbolId !== "") {
        setSelectedSymbolId("");
      }
      return;
    }
    if (!symbols.some((symbol) => symbol.id === selectedSymbolId)) {
      setSelectedSymbolId(symbols[0].id);
    }
  }, [selectedSymbolId, symbols]);

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
      saveSymbols(next);
      return next;
    });
    setSelectedSymbolId(nextSymbol.id);
    setWeatherView("forecast");
    setActiveTab("weather");
  }

  function handleRemoveSymbol(symbolId: string) {
    const nextSymbols = symbols.filter((item) => item.id !== symbolId);
    setSymbols(nextSymbols);
    saveSymbols(nextSymbols);
    setMarketData((current) => {
      const next = { ...current };
      delete next[symbolId];
      return next;
    });
    if (selectedSymbolId === symbolId) {
      setSelectedSymbolId(nextSymbols[0]?.id ?? "");
      setWeatherView(nextSymbols.length ? "forecast" : "stations");
      setActiveTab("weather");
    }
  }

  function handleRestoreDefaults() {
    const next = [
      ...DEFAULT_SYMBOLS,
      ...symbols.filter(
        (saved) => !DEFAULT_SYMBOLS.some(
          (symbol) => symbol.id === saved.id || symbol.remoteSymbol === saved.remoteSymbol,
        ),
      ),
    ];
    setSymbols(next);
    saveSymbols(next);
    setSelectedSymbolId(DEFAULT_SYMBOLS[0].id);
    setWeatherView("forecast");
    setActiveTab("weather");
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
          <SituationRoomPage marketData={marketData} scores={scores} overallScore={overallScore} />
        ) : activeTab === "weather" && symbols.length === 0 ? (
          <div className="weather-workspace page-flow">
            <section className="weather-workspace-head">
              <div>
                <p className="eyebrow">MARKET OBSERVATORY</p>
                <h2>관측소 관리</h2>
              </div>
            </section>
            <SymbolsPage
              symbols={symbols}
              marketData={marketData}
              scores={scores}
              selectedSymbolId=""
              onSelect={setSelectedSymbolId}
              onAddSymbol={handleAddSymbol}
              onRemoveSymbol={handleRemoveSymbol}
              onRestoreDefaults={handleRestoreDefaults}
            />
          </div>
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
                    <h2>{weatherView === "forecast" ? marketWeatherMode === "tomorrow" ? "내일 시장예보" : "시장 날씨" : "관측소 관리"}</h2>
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
                    marketData={marketData}
                    scores={scores}
                    onSelect={setSelectedSymbolId}
                    onAddSymbol={handleAddSymbol}
                    onRemoveSymbol={handleRemoveSymbol}
                    weatherMode={marketWeatherMode}
                    onWeatherModeChange={setMarketWeatherMode}
                    tomorrowForecast={tomorrowForecast}
                    tomorrowForecastLoading={tomorrowForecastLoading}
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
                    onRestoreDefaults={handleRestoreDefaults}
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
        <p className="forecast-disclosure"><strong>내일 시장예보 안내</strong>{FORECAST_DISCLOSURE}</p>
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
