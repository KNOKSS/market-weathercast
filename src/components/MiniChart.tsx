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
  const height = 120;
  const padding = 10;
  const plotBottom = 92;
  const closes = points.map((candle) => candle.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const path = points
    .map((candle, index) => {
      const x = padding + (index / (points.length - 1)) * (width - padding * 2);
      const y = plotBottom - ((candle.close - min) / range) * (plotBottom - padding);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const last = points.at(-1)!.close;
  const first = points[0].close;
  const up = last >= first;
  const firstY = plotBottom - ((first - min) / range) * (plotBottom - padding);
  const startTime = new Date(points[0].time).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = new Date(points.at(-1)!.time).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const periodChange = ((last - first) / first) * 100;

  return (
    <svg className="mini-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`최근 48분 가격 흐름 ${periodChange.toFixed(2)}%`}>
      <path className="chart-grid" d="M10 18h300M10 46h300M10 74h300" />
      <path className="chart-baseline" d={`M10 ${firstY.toFixed(2)}h300`} />
      <path className={up ? "chart-line chart-line-up" : "chart-line chart-line-down"} d={path} />
      <text className="chart-axis-label" x="10" y="113">{startTime}</text>
      <text className="chart-axis-label" x="310" y="113" textAnchor="end">{endTime}</text>
      <text className={up ? "chart-change-label value-up" : "chart-change-label value-down"} x="310" y="13" textAnchor="end">
        {periodChange > 0 ? "+" : ""}{periodChange.toFixed(2)}%
      </text>
    </svg>
  );
}
