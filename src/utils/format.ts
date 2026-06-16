export function formatPrice(value: number | null, symbolId?: string): string {
  if (value === null || !Number.isFinite(value)) {
    return "데이터 없음";
  }

  const isIndex = symbolId === "SP500" || symbolId === "NASDAQ";
  const maximumFractionDigits = value > 1000 || isIndex ? 2 : 4;

  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
  }).format(value);
}

export function statusLabel(status: string): string {
  if (status === "live") {
    return "실시간";
  }
  if (status === "mock") {
    return "샘플";
  }
  if (status === "empty") {
    return "데이터 없음";
  }
  return "오류";
}
