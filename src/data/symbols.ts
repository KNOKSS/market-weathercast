import type { MarketSymbol } from "../types/market";

export const DEFAULT_SYMBOLS: MarketSymbol[] = [
  {
    id: "BTCUSDT",
    label: "Bitcoin",
    shortLabel: "BTC",
    kind: "crypto",
    source: "binance",
    remoteSymbol: "BTCUSDT",
    description: "코인 시장의 대표 위험자산 지표",
  },
  {
    id: "ETHUSDT",
    label: "Ethereum",
    shortLabel: "ETH",
    kind: "crypto",
    source: "binance",
    remoteSymbol: "ETHUSDT",
    description: "알트코인 체력과 유동성 확인용",
  },
  {
    id: "SP500",
    label: "S&P 500",
    shortLabel: "S&P",
    kind: "index",
    source: "yahoo",
    remoteSymbol: "^GSPC",
    description: "미국 대형주 전체 위험선호 지표",
  },
  {
    id: "NASDAQ",
    label: "Nasdaq Composite",
    shortLabel: "NASDAQ",
    kind: "index",
    source: "yahoo",
    remoteSymbol: "^IXIC",
    description: "성장주와 기술주 위험선호 지표",
  },
];

export const BENCHMARK_SYMBOLS: MarketSymbol[] = [
  ...DEFAULT_SYMBOLS.filter((symbol) => ["BTCUSDT", "SP500", "NASDAQ"].includes(symbol.id)),
  {
    id: "VIX",
    label: "CBOE Volatility Index",
    shortLabel: "VIX",
    kind: "index",
    source: "yahoo",
    remoteSymbol: "^VIX",
    description: "전체 시장 위험 수준을 보정하는 고정 벤치마크",
  },
];
