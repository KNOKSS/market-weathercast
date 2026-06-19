import { useEffect, useMemo, useState } from "react";
import {
  DASHBOARD_MARKETS,
  fetchDashboardQuotes,
  type DashboardMarketDefinition,
  type DashboardQuote,
} from "../api/overview";
import { searchYahooSymbols } from "../api/search";
import { MarketBenchmarkPanel } from "../components/MarketBenchmarkPanel";
import { MarketPulseCard } from "../components/MarketPulseCard";
import type { MarketData, SymbolSearchResult, WeatherScore } from "../types/market";

interface SituationRoomPageProps {
  marketData: Record<string, MarketData>;
  scores: Record<string, WeatherScore>;
  overallScore: WeatherScore | null;
}

const CUSTOM_DASHBOARD_KEY = "market-weather-situation-symbols-v1";
const CORE_REMOTE_SYMBOLS = new Set(["^GSPC", "^IXIC", "^VIX"]);

function loadCustomDefinitions(): DashboardMarketDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_DASHBOARD_KEY) || "[]") as DashboardMarketDefinition[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.id && item?.label && item?.remoteSymbol)
      : [];
  } catch {
    return [];
  }
}

function saveCustomDefinitions(definitions: DashboardMarketDefinition[]) {
  try {
    localStorage.setItem(CUSTOM_DASHBOARD_KEY, JSON.stringify(definitions));
  } catch {
    // A storage restriction should not block editing the dashboard.
  }
}

interface MarketClock {
  city: string;
  market: string;
  timeZone: string;
  openMinutes: number;
  closeMinutes: number;
}

const MARKET_CLOCKS: MarketClock[] = [
  { city: "서울", market: "KOSPI", timeZone: "Asia/Seoul", openMinutes: 9 * 60, closeMinutes: 15 * 60 + 30 },
  { city: "도쿄", market: "Nikkei", timeZone: "Asia/Tokyo", openMinutes: 9 * 60, closeMinutes: 15 * 60 + 30 },
  { city: "런던", market: "LSE", timeZone: "Europe/London", openMinutes: 8 * 60, closeMinutes: 16 * 60 + 30 },
  { city: "뉴욕", market: "NYSE", timeZone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
];

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function marketStatus(now: Date, clock: MarketClock): { label: string; tone: string } {
  const local = localParts(now, clock.timeZone);
  if (local.weekday === "Sat" || local.weekday === "Sun") {
    return { label: "주말 휴장", tone: "closed" };
  }
  const minutes = local.hour * 60 + local.minute;
  if (minutes < clock.openMinutes) {
    return { label: "장전", tone: "pre" };
  }
  if (minutes < clock.closeMinutes) {
    return { label: "거래 중", tone: "open" };
  }
  return { label: "마감", tone: "closed" };
}

function clockTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

function quoteFromMarketData(
  id: string,
  label: string,
  shortLabel: string,
  marketData: Record<string, MarketData>,
  scores: Record<string, WeatherScore>,
  category: "index" | "pulse",
): DashboardQuote | null {
  const data = marketData[id];
  const score = scores[id];
  if (!data || !score) {
    return null;
  }
  return {
    id,
    label,
    shortLabel,
    remoteSymbol: data.symbol.remoteSymbol,
    category,
    candles: data.dailyCandles,
    currentPrice: score.currentPrice,
    dayChangePercent: score.dayChangePercent,
    status: data.status === "live" ? "live" : "error",
  };
}

function formatTickerValue(value: number | null, unit?: string): string {
  if (value === null) {
    return "-";
  }
  const formatted = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  }).format(value);
  return unit ? `${formatted}${unit}` : formatted;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function SituationRoomPage({ marketData, scores, overallScore }: SituationRoomPageProps) {
  const [now, setNow] = useState(() => new Date());
  const [extraQuotes, setExtraQuotes] = useState<DashboardQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [customDefinitions, setCustomDefinitions] = useState<DashboardMarketDefinition[]>(loadCustomDefinitions);
  const [editingDashboard, setEditingDashboard] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      const quotes = await fetchDashboardQuotes([...DASHBOARD_MARKETS, ...customDefinitions]);
      if (alive) {
        setExtraQuotes(quotes);
        setLoading(false);
      }
    }
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        load();
      }
    }, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [customDefinitions]);

  async function handleDashboardSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchMessage("");
    try {
      const results = await searchYahooSymbols(searchQuery);
      setSearchResults(results);
      if (!results.length) setSearchMessage("검색 결과가 없습니다.");
    } catch {
      setSearchResults([]);
      setSearchMessage("검색 연결이 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSearching(false);
    }
  }

  function addDashboardSymbol(result: SymbolSearchResult) {
    const symbol = result.symbol;
    const exists = CORE_REMOTE_SYMBOLS.has(symbol.remoteSymbol) ||
      DASHBOARD_MARKETS.some((item) => item.remoteSymbol === symbol.remoteSymbol) ||
      customDefinitions.some((item) => item.remoteSymbol === symbol.remoteSymbol);
    if (exists) {
      setSearchMessage("이미 상황판에 있는 지표입니다.");
      return;
    }
    const next = [...customDefinitions, {
      id: `CUSTOM:${symbol.remoteSymbol}`,
      label: symbol.label,
      shortLabel: symbol.shortLabel,
      remoteSymbol: symbol.remoteSymbol,
      category: "index" as const,
    }];
    setCustomDefinitions(next);
    saveCustomDefinitions(next);
    setSearchMessage(`${symbol.shortLabel} 지표를 추가했습니다.`);
  }

  function removeDashboardSymbol(id: string) {
    const next = customDefinitions.filter((item) => item.id !== id);
    setCustomDefinitions(next);
    saveCustomDefinitions(next);
  }

  function moveDashboardSymbol(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= customDefinitions.length) return;
    const next = [...customDefinitions];
    [next[index], next[target]] = [next[target], next[index]];
    setCustomDefinitions(next);
    saveCustomDefinitions(next);
  }

  const quotes = useMemo(() => {
    const existing = [
      quoteFromMarketData("SP500", "S&P 500", "S&P 500", marketData, scores, "index"),
      quoteFromMarketData("NASDAQ", "Nasdaq Composite", "NASDAQ", marketData, scores, "index"),
      quoteFromMarketData("VIX", "변동성 지수", "VIX", marketData, scores, "index"),
    ].filter((quote): quote is DashboardQuote => quote !== null);
    return [...existing, ...extraQuotes];
  }, [extraQuotes, marketData, scores]);

  const indexQuotes = quotes.filter((quote) => quote.category === "index");
  const pulseQuotes = quotes.filter((quote) => quote.category === "pulse");
  const bitcoin = quoteFromMarketData("BTCUSDT", "비트코인", "BTC", marketData, scores, "pulse");
  const tickerQuotes = bitcoin ? [...pulseQuotes, bitcoin] : pulseQuotes;

  const briefing = useMemo(() => {
    const sp = quotes.find((quote) => quote.id === "SP500")?.dayChangePercent;
    const nasdaq = quotes.find((quote) => quote.id === "NASDAQ")?.dayChangePercent;
    const vix = quotes.find((quote) => quote.id === "VIX")?.currentPrice;
    const dxy = quotes.find((quote) => quote.id === "DXY")?.dayChangePercent;
    const usAverage = sp !== null && sp !== undefined && nasdaq !== null && nasdaq !== undefined
      ? (sp + nasdaq) / 2
      : null;
    const usText = usAverage === null ? "미국 증시 확인 중" : usAverage > 0.35 ? "미국 증시 강세" : usAverage < -0.35 ? "미국 증시 약세" : "미국 증시 혼조";
    const volatilityText = vix === null || vix === undefined ? "변동성 확인 중" : vix >= 25 ? "변동성 경계" : vix >= 18 ? "변동성 주의" : "변동성 안정";
    const dollarText = dxy === null || dxy === undefined ? "달러 흐름 확인 중" : dxy > 0.25 ? "달러 강세" : dxy < -0.25 ? "달러 약세" : "달러 보합";
    return [usText, dollarText, volatilityText];
  }, [quotes]);

  return (
    <div className="situation-room page-flow">
      <section className="situation-hero">
        <div>
          <p className="eyebrow">MARKET WEATHER NEWSROOM</p>
          <h1>글로벌 상황실</h1>
          <p>세계 주요 시장의 시간과 위험 신호를 한 화면에서 관측합니다.</p>
        </div>
        <div className="situation-live-card">
          <span><i /> LIVE</span>
          <strong>{clockTime(now, "Asia/Seoul")}</strong>
          <small>서울 기준</small>
        </div>
      </section>

      {overallScore ? <MarketBenchmarkPanel score={overallScore} /> : (
        <section className="benchmark-panel benchmark-loading">
          <div className="loader" />
          <div><strong>전체 시장 기준온도 관측 중</strong><small>S&amp;P 500 · NASDAQ · VIX · BTC</small></div>
        </section>
      )}

      <section className="situation-section world-clock-section">
        <div className="situation-section-head">
          <div>
            <p className="eyebrow">WORLD CLOCK</p>
            <h2>세계 시장 시계</h2>
          </div>
          <small>정규장 시간 기준 · 현지 공휴일 제외</small>
        </div>
        <div className="world-clock-grid">
          {MARKET_CLOCKS.map((clock) => {
            const status = marketStatus(now, clock);
            return (
              <article className="world-clock-card" key={clock.city}>
                <div>
                  <strong>{clock.city}</strong>
                  <small>{clock.market}</small>
                </div>
                <time>{clockTime(now, clock.timeZone)}</time>
                <span className={`market-status status-${status.tone}`}><i />{status.label}</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="newsroom-briefing">
        <div>
          <span className="briefing-label">NOW</span>
          <strong>오늘의 상황 브리핑</strong>
        </div>
        <p>{briefing.join(" · ")}</p>
      </section>

      <section className="situation-section">
        <div className="situation-section-head">
          <div>
            <p className="eyebrow">GLOBAL INDICES</p>
            <h2>세계 주요 지수·관심 지표</h2>
          </div>
          <div className="dashboard-head-actions">
            <small>{loading ? "상황판 연결 중" : "5분 단위 상황판 갱신"}</small>
            <button type="button" onClick={() => setEditingDashboard((current) => !current)}>
              {editingDashboard ? "편집 닫기" : "지표 편집"}
            </button>
          </div>
        </div>
        {editingDashboard && (
          <section className="dashboard-editor">
            <div>
              <strong>상황판 지표 추가</strong>
              <p>종목명이나 티커를 검색해 세계 지수 옆에 고정할 수 있습니다.</p>
            </div>
            <form onSubmit={handleDashboardSearch}>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="예: AAPL, Tesla, Dow Jones"
                aria-label="상황판 지표 검색"
              />
              <button type="submit" disabled={searching}>{searching ? "검색 중" : "검색"}</button>
            </form>
            {searchMessage && <p className="dashboard-editor-message">{searchMessage}</p>}
            {searchResults.length > 0 && (
              <div className="dashboard-search-results">
                {searchResults.map((result) => (
                  <button type="button" key={result.symbol.id} onClick={() => addDashboardSymbol(result)}>
                    <strong>{result.symbol.shortLabel}</strong>
                    <span>{result.symbol.label}</span>
                    <small>＋ 추가</small>
                  </button>
                ))}
              </div>
            )}
            {customDefinitions.length > 0 && (
              <div className="dashboard-custom-list">
                {customDefinitions.map((item, index) => (
                  <div key={item.id}>
                    <span><strong>{item.shortLabel}</strong>{item.label}</span>
                    <div>
                      <button type="button" disabled={index === 0} onClick={() => moveDashboardSymbol(index, -1)} aria-label={`${item.shortLabel} 앞으로 이동`}>↑</button>
                      <button type="button" disabled={index === customDefinitions.length - 1} onClick={() => moveDashboardSymbol(index, 1)} aria-label={`${item.shortLabel} 뒤로 이동`}>↓</button>
                      <button type="button" onClick={() => removeDashboardSymbol(item.id)}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <div className="market-pulse-grid">
          {indexQuotes.map((quote) => <MarketPulseCard quote={quote} key={quote.id} />)}
        </div>
      </section>

      <section className="situation-section ticker-section">
        <div className="situation-section-head">
          <div>
            <p className="eyebrow">CROSS ASSET</p>
            <h2>금리·환율·원자재</h2>
          </div>
        </div>
        <div className="market-ticker" role="list">
          {tickerQuotes.map((quote) => (
            <article role="listitem" key={quote.id}>
              <span>{quote.shortLabel}</span>
              <strong>{formatTickerValue(quote.currentPrice, quote.unit)}</strong>
              <small className={(quote.dayChangePercent ?? 0) >= 0 ? "value-up" : "value-down"}>
                {formatPercent(quote.dayChangePercent)}
              </small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
