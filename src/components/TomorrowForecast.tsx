import { useState } from "react";
import type {
  MarketSymbol,
  TomorrowForecastData,
  TomorrowForecastHistoryItem,
  TomorrowForecastItem,
  TomorrowWeatherGrade,
} from "../types/market";
import { StationIdentity } from "./StationIdentity";
import { WeatherIcon } from "./WeatherIcon";
import { FORECAST_SYMBOL_OPTIONS } from "../data/forecastSymbols";

interface TomorrowForecastProps {
  symbols: MarketSymbol[];
  selectedSymbol: MarketSymbol;
  data: TomorrowForecastData | null;
  loading: boolean;
  onSelect: (symbolId: string) => void;
  onAddSymbol: (symbol: MarketSymbol) => void;
  onRemoveSymbol: (symbolId: string) => void;
}

const DISPLAY_NAMES: Record<string, string> = {
  BTCUSDT: "비트코인",
  ETHUSDT: "이더리움",
  SP500: "S&P 500",
  NASDAQ: "나스닥",
};

const GRADE_COPY: Record<TomorrowWeatherGrade, { label: string; summary: string }> = {
  quiet: { label: "고요", summary: "평소보다 좁고 차분한 장중 움직임이 예상됩니다." },
  normal: { label: "보통", summary: "최근 관측 범위 안의 통상적인 움직임이 예상됩니다." },
  strong: { label: "강풍", summary: "평소보다 넓은 장중 움직임에 대비할 구간입니다." },
  storm: { label: "폭풍", summary: "최근 1년 관측 중에서도 매우 큰 움직임이 예상됩니다." },
};

function assetIdFor(symbol: MarketSymbol, data: TomorrowForecastData | null): string {
  return data?.aliases[symbol.id] ?? symbol.id;
}

function forecastFor(symbol: MarketSymbol, data: TomorrowForecastData | null): TomorrowForecastItem | null {
  const assetId = assetIdFor(symbol, data);
  return data?.forecasts.find((item) => item.assetId === assetId) ?? null;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(new Date(year, month - 1, day));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function forecastFreshness(item: TomorrowForecastItem): "fresh" | "stale" {
  const now = new Date();
  const asOf = new Date(`${item.asOfDate}T00:00:00Z`);
  const age = Math.floor((now.getTime() - asOf.getTime()) / 86_400_000);
  const maximumAge = item.forecastPolicy === "UTC_DAILY_CLOSE" ? 1 : 4;
  return age <= maximumAge ? "fresh" : "stale";
}

function relativeRankLabel(percentile: number): string {
  if (percentile >= 90) return `평소 대비 상위 ${Math.max(1, Math.ceil(100 - percentile))}%`;
  if (percentile >= 75) return "평소보다 큰 편";
  if (percentile < 25) return "평소보다 잔잔";
  return "평소 수준";
}

const FORECAST_VISUAL: Record<TomorrowWeatherGrade, { icon: "맑음" | "구름 조금" | "소나기" | "태풍경보"; label: string }> = {
  quiet: { icon: "맑음", label: "고요" },
  normal: { icon: "구름 조금", label: "보통" },
  strong: { icon: "소나기", label: "강풍" },
  storm: { icon: "태풍경보", label: "폭풍" },
};

function ForecastWeatherVisual({ grade }: { grade: TomorrowWeatherGrade }) {
  const visual = FORECAST_VISUAL[grade];
  return (
    <div className={`tomorrow-weather-visual grade-${grade}`}>
      <span className="forecast-weather-glow" aria-hidden="true" />
      <WeatherIcon label={visual.icon} size={156} />
      <div className="forecast-visual-caption">
        <small>예상 움직임</small>
        <strong>{visual.label}</strong>
      </div>
    </div>
  );
}

function RangeBand({ item }: { item: TomorrowForecastItem }) {
  const maximum = Math.max(item.interval80[1] * 1.12, item.expectedTrueRangePercent * 1.25, 0.1);
  const position = (value: number) => `${Math.min(100, Math.max(0, value / maximum * 100))}%`;
  const style = (range: [number, number]) => ({
    left: position(range[0]),
    width: `${Math.max(1.5, (range[1] - range[0]) / maximum * 100)}%`,
  });
  return (
    <div className="range-band" aria-label={`점예측 ${item.expectedTrueRangePercent.toFixed(2)}퍼센트`}>
      <div className="range-track">
        <span className="range-zone range-zone-80" style={style(item.interval80)} />
        <span className="range-zone range-zone-50" style={style(item.interval50)} />
        <span className="range-point" style={{ left: position(item.expectedTrueRangePercent) }}><i /></span>
      </div>
      <div className="range-axis"><span>0%</span><strong>예상 {item.expectedTrueRangePercent.toFixed(2)}%</strong><span>{maximum.toFixed(1)}%</span></div>
    </div>
  );
}

function HistoryRow({ item }: { item: TomorrowForecastHistoryItem }) {
  const difference = Math.abs(item.expectedTrueRangePercent - item.actualTrueRangePercent);
  return (
    <div className="forecast-history-row">
      <span>{formatDate(item.asOfDate)}</span>
      <strong>예보 {item.expectedTrueRangePercent.toFixed(2)}%</strong>
      <strong>실제 {item.actualTrueRangePercent.toFixed(2)}%</strong>
      <em className={item.covered80 ? "hit" : "miss"}>{item.covered50 ? "50% 적중" : item.covered80 ? "80% 적중" : `오차 ${difference.toFixed(2)}%p`}</em>
    </div>
  );
}

export function TomorrowForecast({ symbols, selectedSymbol, data, loading, onSelect, onAddSymbol, onRemoveSymbol }: TomorrowForecastProps) {
  if (loading) {
    return <section className="tomorrow-loading"><span /><div><strong>공식 예보를 불러오는 중입니다</strong><small>장 마감 원장을 확인하고 있습니다.</small></div></section>;
  }

  const selected = forecastFor(selectedSymbol, data);
  if (!data) {
    return <section className="tomorrow-empty"><span>⌁</span><h2>예보 데이터 연결을 확인해 주세요</h2><p>오늘 관측은 계속 사용할 수 있습니다. 공식 예보 파일은 캐시하지 않고 새로 확인합니다.</p></section>;
  }

  if (!selected) {
    return (
      <div className="page-flow tomorrow-page">
        <section className="tomorrow-empty unsupported-forecast">
          <StationIdentity symbol={selectedSymbol} />
          <span>연구 대상 밖</span>
          <h2>{selectedSymbol.label}의 v2 예보는 아직 없습니다</h2>
          <p>검증되지 않은 종목에 다른 자산의 공식을 억지로 적용하지 않습니다. 오늘 관측은 정상적으로 사용할 수 있습니다.</p>
        </section>
        <ForecastStationStrip symbols={symbols} selectedSymbol={selectedSymbol} data={data} onSelect={onSelect} onAddSymbol={onAddSymbol} onRemoveSymbol={onRemoveSymbol} />
      </div>
    );
  }

  const copy = GRADE_COPY[selected.weatherGrade];
  const freshness = forecastFreshness(selected);
  const proxy = data.aliases[selectedSymbol.id];
  const history = data.recentSettlements.filter((item) => item.assetId === selected.assetId).slice(0, 5);
  const displayName = DISPLAY_NAMES[selectedSymbol.id] ?? selectedSymbol.label;
  const relativeRank = relativeRankLabel(selected.weatherPercentile252);

  return (
    <div className="page-flow tomorrow-page" key={`${selected.assetId}-${selected.asOfDate}`}>
      <section className={`tomorrow-hero grade-${selected.weatherGrade}`}>
        <div className="tomorrow-hero-copy">
          <StationIdentity symbol={selectedSymbol} />
          <div className="tomorrow-meta-row">
            <span className="model-pill">공식 v2</span>
            <span className={`freshness-pill ${freshness}`}>{freshness === "fresh" ? "예보 최신" : "갱신 지연"}</span>
            <span>{selected.status === "settled" ? "정산 완료" : "정산 대기"}</span>
          </div>
          <p className="tomorrow-kicker">NEXT SESSION FORECAST</p>
          <h1>내일의 {displayName} 날씨</h1>
          <div className="tomorrow-grade-row"><strong>평소 대비 {copy.label}</strong><span>{selectedSymbol.shortLabel} 기준 · {relativeRank}</span></div>
          <p className="tomorrow-summary">{copy.summary}</p>
        </div>
        <ForecastWeatherVisual grade={selected.weatherGrade} />
      </section>

      <section className="forecast-range-card">
        <div className="forecast-card-head">
          <div><span>예상 활동 반경</span><strong>{selected.expectedTrueRangePercent.toFixed(2)}<small>%</small></strong></div>
          <div className="forecast-date-block"><span>{formatDate(selected.asOfDate)} 마감 기준</span><strong>{selected.forecastPolicy === "US_CLOSE" ? "다음 미국 거래일" : "다음 UTC 일봉"}</strong></div>
        </div>
        <RangeBand item={selected} />
        <div className="forecast-interval-grid">
          <div><span><i className="interval-dot dot-50" />가장 가능성 높은 범위</span><strong>{selected.interval50[0].toFixed(2)}~{selected.interval50[1].toFixed(2)}%</strong><small>50% 예상 구간</small></div>
          <div><span><i className="interval-dot dot-80" />넓게 대비할 범위</span><strong>{selected.interval80[0].toFixed(2)}~{selected.interval80[1].toFixed(2)}%</strong><small>80% 예상 구간</small></div>
        </div>
        <div className="forecast-relative-note">
          <span aria-hidden="true">↕</span>
          <p><strong>왜 {selected.expectedTrueRangePercent.toFixed(2)}%가 {copy.label}인가요?</strong> 날씨는 종목 간 절대 퍼센트 비교가 아니라 <b>{selectedSymbol.shortLabel} 자신의 최근 252회</b>와 비교한 상대 등급입니다. 현재 예보는 {relativeRank}입니다.</p>
        </div>
        <div className="forecast-meaning"><span>읽는 법</span><p>예상 고저폭의 크기입니다. 상승·하락 방향이나 종가 목표 범위를 뜻하지 않습니다.</p></div>
      </section>

      <section className="forecast-method-card">
        <div><span>MODEL STATUS</span><strong>장 마감 예보 · 계수 동결</strong></div>
        <p>2024년까지의 87,501개 관측으로 고정한 모델입니다. 매일 예측을 먼저 기록한 뒤 다음 장 마감 후 실제 범위와 정산합니다.</p>
        <div className="forecast-method-meta">
          <span>{proxy ? `${proxy} 대리 지표 사용` : `${selected.assetId} 직접 예보`}</span>
          <span>252회 오차 구간 보정</span>
          <span>생성 {formatTime(selected.createdAt)}</span>
        </div>
      </section>

      {history.length > 0 && (
        <section className="forecast-history-card">
          <div className="section-head"><div><p className="eyebrow">FORECAST VERIFICATION</p><h2>최근 예보 정산</h2></div><small>{history.length}건</small></div>
          <div className="forecast-history-list">{history.map((item) => <HistoryRow key={`${item.assetId}-${item.asOfDate}`} item={item} />)}</div>
          {data.integrity.settlements < 20 && <p className="sample-size-note">표본이 20건 미만이라 종합 정확도는 아직 표시하지 않습니다.</p>}
        </section>
      )}

      <ForecastStationStrip symbols={symbols} selectedSymbol={selectedSymbol} data={data} onSelect={onSelect} onAddSymbol={onAddSymbol} onRemoveSymbol={onRemoveSymbol} />
    </div>
  );
}

function ForecastStationStrip({ symbols, selectedSymbol, data, onSelect, onAddSymbol, onRemoveSymbol }: Omit<TomorrowForecastProps, "loading">) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const availableAssetIds = new Set(data?.forecasts.map((item) => item.assetId) ?? []);
  const supportedOptions = FORECAST_SYMBOL_OPTIONS.filter((item) => availableAssetIds.has(item.forecastAssetId));
  const addedRemoteSymbols = new Set(symbols.map((symbol) => symbol.remoteSymbol));

  function handleAdd(option: (typeof FORECAST_SYMBOL_OPTIONS)[number]) {
    const exists = symbols.some((symbol) => symbol.id === option.symbol.id || symbol.remoteSymbol === option.symbol.remoteSymbol);
    if (exists) {
      onSelect(option.symbol.id);
    } else {
      onAddSymbol(option.symbol);
    }
    setPickerOpen(false);
  }

  return (
    <section className="forecast-stations">
      <div className="section-head forecast-station-head">
        <div><p className="eyebrow">TOMORROW OBSERVATORIES</p><h2>종목별 내일 날씨</h2></div>
        <button className="forecast-add-button" type="button" onClick={() => setPickerOpen((current) => !current)} aria-expanded={pickerOpen}>
          <span aria-hidden="true">{pickerOpen ? "−" : "+"}</span>{pickerOpen ? "닫기" : "예보 종목 추가"}
        </button>
      </div>
      {pickerOpen && (
        <div className="forecast-symbol-picker">
          <div className="forecast-picker-copy"><strong>v2 예보 지원 자산</strong><small>현재 예보가 생성된 {supportedOptions.length}개 자산만 표시합니다.</small></div>
          <div className="forecast-picker-grid">
            {supportedOptions.map((option) => {
              const added = addedRemoteSymbols.has(option.symbol.remoteSymbol);
              return (
                <button key={option.forecastAssetId} type="button" className={added ? "added" : ""} onClick={() => handleAdd(option)}>
                  <span><strong>{option.symbol.shortLabel}</strong><small>{option.group}</small></span>
                  <em>{added ? "추가됨" : "+ 추가"}</em>
                </button>
              );
            })}
          </div>
          <p>모든 자산은 동일한 v2 변동폭 모델과 자산별 최근 오차 보정을 사용합니다.</p>
        </div>
      )}
      <div className="forecast-station-grid">
        {symbols.map((symbol) => {
          const forecast = forecastFor(symbol, data);
          return (
            <div key={symbol.id} className={`forecast-station-item ${symbol.id === selectedSymbol.id ? "selected" : ""} ${forecast ? `grade-${forecast.weatherGrade}` : "unavailable"}`}>
              <button className="forecast-station-select" type="button" onClick={() => onSelect(symbol.id)} aria-pressed={symbol.id === selectedSymbol.id}>
                <span className="forecast-station-title">
                  <b>{symbol.shortLabel}</b>
                  {forecast && <WeatherIcon label={FORECAST_VISUAL[forecast.weatherGrade].icon} size={38} />}
                </span>
                {forecast ? <><strong>{forecast.expectedTrueRangePercent.toFixed(2)}%</strong><small>{forecast.weatherLabel} · {relativeRankLabel(forecast.weatherPercentile252)}</small></> : <><strong>—</strong><small>예보 없음</small></>}
              </button>
              <button className="forecast-station-remove" type="button" onClick={() => onRemoveSymbol(symbol.id)} aria-label={`${symbol.shortLabel} 관측소 삭제`} title="삭제">×</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
