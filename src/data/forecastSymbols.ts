import type { MarketSymbol } from "../types/market";

export interface ForecastSymbolOption {
  forecastAssetId: string;
  group: "대표 시장" | "암호자산" | "스타일·지역" | "미국 섹터" | "개별 종목";
  symbol: MarketSymbol;
}

function yahoo(id: string, label: string, shortLabel: string, description: string): MarketSymbol {
  return { id, label, shortLabel, kind: "stock", source: "yahoo", remoteSymbol: id, description };
}

export const FORECAST_SYMBOL_OPTIONS: ForecastSymbolOption[] = [
  {
    forecastAssetId: "SPY",
    group: "대표 시장",
    symbol: { id: "SP500", label: "S&P 500", shortLabel: "S&P", kind: "index", source: "yahoo", remoteSymbol: "^GSPC", description: "SPY를 대리 지표로 사용하는 미국 대형주 시장 예보" },
  },
  {
    forecastAssetId: "QQQ",
    group: "대표 시장",
    symbol: { id: "NASDAQ", label: "Nasdaq Composite", shortLabel: "NASDAQ", kind: "index", source: "yahoo", remoteSymbol: "^IXIC", description: "QQQ를 대리 지표로 사용하는 미국 기술주 시장 예보" },
  },
  { forecastAssetId: "IWM", group: "대표 시장", symbol: yahoo("IWM", "Russell 2000 ETF", "IWM", "미국 중소형주 시장") },
  { forecastAssetId: "BTCUSDT", group: "암호자산", symbol: { id: "BTCUSDT", label: "Bitcoin", shortLabel: "BTC", kind: "crypto", source: "binance", remoteSymbol: "BTCUSDT", description: "대표 암호자산" } },
  { forecastAssetId: "ETHUSDT", group: "암호자산", symbol: { id: "ETHUSDT", label: "Ethereum", shortLabel: "ETH", kind: "crypto", source: "binance", remoteSymbol: "ETHUSDT", description: "대표 스마트계약 암호자산" } },
  { forecastAssetId: "EFA", group: "스타일·지역", symbol: yahoo("EFA", "선진국 주식 ETF", "EFA", "미국·캐나다 제외 선진국 주식") },
  { forecastAssetId: "EEM", group: "스타일·지역", symbol: yahoo("EEM", "신흥국 주식 ETF", "EEM", "신흥국 주식시장") },
  { forecastAssetId: "IWD", group: "스타일·지역", symbol: yahoo("IWD", "미국 가치주 ETF", "IWD", "미국 대형 가치주") },
  { forecastAssetId: "IWF", group: "스타일·지역", symbol: yahoo("IWF", "미국 성장주 ETF", "IWF", "미국 대형 성장주") },
  { forecastAssetId: "MTUM", group: "스타일·지역", symbol: yahoo("MTUM", "미국 모멘텀 ETF", "MTUM", "상대 모멘텀이 강한 미국 주식") },
  { forecastAssetId: "USMV", group: "스타일·지역", symbol: yahoo("USMV", "미국 저변동성 ETF", "USMV", "변동성이 낮은 미국 주식") },
  { forecastAssetId: "XLB", group: "미국 섹터", symbol: yahoo("XLB", "소재 섹터 ETF", "XLB", "미국 소재 업종") },
  { forecastAssetId: "XLC", group: "미국 섹터", symbol: yahoo("XLC", "커뮤니케이션 섹터 ETF", "XLC", "미국 커뮤니케이션서비스 업종") },
  { forecastAssetId: "VOX", group: "미국 섹터", symbol: yahoo("VOX", "통신서비스 ETF", "VOX", "미국 통신서비스 업종") },
  { forecastAssetId: "XLE", group: "미국 섹터", symbol: yahoo("XLE", "에너지 섹터 ETF", "XLE", "미국 에너지 업종") },
  { forecastAssetId: "XLF", group: "미국 섹터", symbol: yahoo("XLF", "금융 섹터 ETF", "XLF", "미국 금융 업종") },
  { forecastAssetId: "XLI", group: "미국 섹터", symbol: yahoo("XLI", "산업재 섹터 ETF", "XLI", "미국 산업재 업종") },
  { forecastAssetId: "XLK", group: "미국 섹터", symbol: yahoo("XLK", "기술 섹터 ETF", "XLK", "미국 정보기술 업종") },
  { forecastAssetId: "XLP", group: "미국 섹터", symbol: yahoo("XLP", "필수소비재 섹터 ETF", "XLP", "미국 필수소비재 업종") },
  { forecastAssetId: "XLRE", group: "미국 섹터", symbol: yahoo("XLRE", "부동산 섹터 ETF", "XLRE", "미국 부동산 업종") },
  { forecastAssetId: "IYR", group: "미국 섹터", symbol: yahoo("IYR", "미국 부동산 ETF", "IYR", "미국 상장 부동산 자산") },
  { forecastAssetId: "XLU", group: "미국 섹터", symbol: yahoo("XLU", "유틸리티 섹터 ETF", "XLU", "미국 유틸리티 업종") },
  { forecastAssetId: "XLV", group: "미국 섹터", symbol: yahoo("XLV", "헬스케어 섹터 ETF", "XLV", "미국 헬스케어 업종") },
  { forecastAssetId: "XLY", group: "미국 섹터", symbol: yahoo("XLY", "임의소비재 섹터 ETF", "XLY", "미국 임의소비재 업종") },
  { forecastAssetId: "TSLA", group: "개별 종목", symbol: yahoo("TSLA", "Tesla, Inc.", "TSLA", "고변동성 전기차 종목") },
  { forecastAssetId: "NVDA", group: "개별 종목", symbol: yahoo("NVDA", "NVIDIA Corporation", "NVDA", "고변동성 반도체 종목") },
];
