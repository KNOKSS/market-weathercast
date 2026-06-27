import type { AssetDefinition, BacktestConfigSnapshot } from "./types";

export const ASSETS: AssetDefinition[] = [
  { id: "SP500", label: "S&P 500", kind: "index", source: "yahoo", remoteSymbol: "^GSPC", startDate: "2010-01-01", role: "equity" },
  { id: "NASDAQ", label: "Nasdaq Composite", kind: "index", source: "yahoo", remoteSymbol: "^IXIC", startDate: "2010-01-01", role: "equity" },
  { id: "VIX", label: "CBOE Volatility Index", kind: "index", source: "yahoo", remoteSymbol: "^VIX", startDate: "2010-01-01", role: "risk-proxy" },
  { id: "BTCUSDT", label: "Bitcoin", kind: "crypto", source: "binance", remoteSymbol: "BTCUSDT", startDate: "2017-08-17", role: "crypto" },
  { id: "QQQ", label: "Invesco QQQ", kind: "stock", source: "yahoo", remoteSymbol: "QQQ", startDate: "2010-01-01", role: "equity" },
  { id: "SPY", label: "SPDR S&P 500 ETF", kind: "stock", source: "yahoo", remoteSymbol: "SPY", startDate: "2010-01-01", role: "equity" },
  { id: "TSLA", label: "Tesla", kind: "stock", source: "yahoo", remoteSymbol: "TSLA", startDate: "2010-07-01", role: "equity" },
  { id: "NVDA", label: "NVIDIA", kind: "stock", source: "yahoo", remoteSymbol: "NVDA", startDate: "2010-01-01", role: "equity" },
];

export const EXPERIMENT = {
  experimentId: "weatherScore-v0.1-daily-replay",
  engineVersion: "weatherScore-v0.1-frozen",
  replayMode: "daily candles supplied to the existing intraday and daily inputs; 96/30-bar windows",
  endDate: "2026-06-18",
  minimumHistory: 30,
  horizons: [1, 3, 5],
  split: { train: 0.6, validation: 0.2, test: 0.2 },
  bootstrapSamples: 500,
  randomBaselineRuns: 200,
  randomSeed: 20260619,
  assets: ASSETS,
  warnings: [
    "This is an end-of-day daily replay, not a minute-perfect replay of the production engine.",
    "The production score uses minute and daily candles; this experiment deliberately reuses the frozen scoring function with daily bars in both inputs.",
    "No mock or synthetic market data is allowed in the backtest.",
    "The final test segment must not be used to tune formula parameters.",
  ],
} as const;

export function configSnapshot(): BacktestConfigSnapshot {
  return {
    ...EXPERIMENT,
    generatedAt: new Date().toISOString(),
    horizons: [...EXPERIMENT.horizons],
    split: { ...EXPERIMENT.split },
    engineSource: { file: "src/engine/weatherScore.ts", sha256: "pending" },
    assets: ASSETS.map((asset) => ({ ...asset })),
    warnings: [...EXPERIMENT.warnings],
  };
}

export const TEMPERATURE_BINS = [
  { label: "0-29", min: 0, max: 29 },
  { label: "30-39", min: 30, max: 39 },
  { label: "40-49", min: 40, max: 49 },
  { label: "50-59", min: 50, max: 59 },
  { label: "60-69", min: 60, max: 69 },
  { label: "70-79", min: 70, max: 79 },
  { label: "80-100", min: 80, max: 100 },
];

export const RAIN_BINS = [
  { label: "0-19", min: 0, max: 19 },
  { label: "20-39", min: 20, max: 39 },
  { label: "40-59", min: 40, max: 59 },
  { label: "60-79", min: 60, max: 79 },
  { label: "80-100", min: 80, max: 100 },
];

export const ULTRAVIOLET_BINS = [
  { label: "0-39", min: 0, max: 39 },
  { label: "40-59", min: 40, max: 59 },
  { label: "60-69", min: 60, max: 69 },
  { label: "70-79", min: 70, max: 79 },
  { label: "80-100", min: 80, max: 100 },
];
