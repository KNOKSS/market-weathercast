import type { Candle } from "../types/market";

interface MiniChartProps {
  candles: Candle[];
}

export function MiniChart({ candles }: MiniChartProps) {
  const points = candles.slice(-48);

  if (points.length < 2) {
    return <div className="mini-chart-empty">차트 데이터 없음</div>;
  }

  const width = 320;
  const height = 104;
  const padding = 10;
  const closes = points.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const path = points
    .map((candle, index) => {
      const x = padding + (index / (points.length - 1)) * (width - padding * 2);
      const y = height - padding - ((candle.close - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const last = points.at(-1)!.close;
  const first = points[0].close;
  const up = last >= first;

  return (
    <svg className="mini-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="가격 흐름">
      <path className="chart-grid" d="M10 24h300M10 52h300M10 80h300" />
      <path className={up ? "chart-line chart-line-up" : "chart-line chart-line-down"} d={path} />
    </svg>
  );
}
