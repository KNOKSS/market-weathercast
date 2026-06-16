export type MarketKind = "crypto" | "index" | "stock";
export type DataStatus = "live" | "mock" | "empty" | "error";
export type WeatherLabel = "쾌청" | "맑음" | "구름 조금" | "흐림" | "소나기" | "태풍경보";
export type WindLevel = "잔잔함" | "보통" | "강함" | "돌풍";
export type DustLevel = "좋음" | "보통" | "나쁨";
export type AlertLevel = "안내" | "주의보" | "경보" | "한숨";
export type TradeDirection = "long" | "short";

export interface MarketSymbol {
  id: string;
  label: string;
  shortLabel: string;
  kind: MarketKind;
  source: "binance" | "yahoo" | "sample";
  remoteSymbol: string;
  description: string;
  userAdded?: boolean;
}

export interface SymbolSearchResult {
  symbol: MarketSymbol;
  exchange: string;
  quoteType: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  symbol: MarketSymbol;
  candles: Candle[];
  status: DataStatus;
  sourceLabel: string;
  message?: string;
}

export interface WeatherScore {
  symbolId: string;
  label: WeatherLabel;
  temperature: number;
  rainChance: number;
  wind: WindLevel;
  ultraviolet: number;
  dust: DustLevel;
  currentPrice: number | null;
  changePercent: number | null;
  rsi: number | null;
  atrPercent: number | null;
  volumeRatio: number | null;
  trendScore: number;
  momentumScore: number;
  volatilityScore: number;
  dataStatus: DataStatus;
  sourceLabel: string;
  summary: string;
  details: string[];
}

export interface MarketAlert {
  id: string;
  level: AlertLevel;
  symbolId: string;
  title: string;
  message: string;
}

export interface ChecklistInput {
  symbolId: string;
  direction: TradeDirection;
  entry: string;
  stop: string;
  target: string;
  leverage: string;
  positionSize: string;
}

export interface ChecklistResult {
  valid: boolean;
  rewardRiskRatio: number | null;
  expectedProfit: number | null;
  expectedLoss: number | null;
  leveragedProfit: number | null;
  leveragedLoss: number | null;
  warnings: string[];
  finalMessage: string;
  tone: "calm" | "caution" | "danger";
}
