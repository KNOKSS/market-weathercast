import type { DashboardQuote } from "../api/overview";

interface MarketPulseCardProps {
  quote: DashboardQuote;
}

function formatValue(value: number | null, unit?: string): string {
  if (value === null) {
    return "연결 지연";
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

export function MarketPulseCard({ quote }: MarketPulseCardProps) {
  const candles = quote.candles.slice(-6);
  const dailyChanges = candles.slice(1).map((candle, index) => {
    const previous = candles[index].close;
    return {
      value: ((candle.close - previous) / previous) * 100,
      weekday: new Intl.DateTimeFormat("ko-KR", {
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(candle.time)),
    };
  });
  const maxMove = Math.max(0.5, ...dailyChanges.map((day) => Math.abs(day.value)));
  const totalChange = candles.length > 1
    ? ((candles.at(-1)!.close - candles[0].close) / candles[0].close) * 100
    : null;

  return (
    <article className="market-pulse-card">
      <div className="pulse-card-head">
        <div>
          <span>{quote.shortLabel}</span>
          <small>{quote.label}</small>
        </div>
        <strong className={(quote.dayChangePercent ?? 0) >= 0 ? "value-up" : "value-down"}>
          {formatPercent(quote.dayChangePercent)}
        </strong>
      </div>
      <div className="pulse-current">{formatValue(quote.currentPrice, quote.unit)}</div>
      <div className="pulse-bars" aria-label="최근 5일 등락 막대">
        {dailyChanges.length > 0 ? dailyChanges.map((day, index) => {
          const height = Math.max(5, (Math.abs(day.value) / maxMove) * 38);
          return (
            <span className="pulse-bar" key={`${quote.id}-${index}`}>
              <i
                className={day.value >= 0 ? "pulse-up" : "pulse-down"}
                style={{ height: `${height}px` }}
              />
              <small>{day.weekday}</small>
            </span>
          );
        }) : <em>5일 차트 연결 지연</em>}
      </div>
      <div className="pulse-card-foot">
        <span>5일 누적</span>
        <strong className={(totalChange ?? 0) >= 0 ? "value-up" : "value-down"}>
          {formatPercent(totalChange)}
        </strong>
      </div>
    </article>
  );
}
