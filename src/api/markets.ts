import type { MarketData, MarketSymbol } from "../types/market";
import { fetchBinanceMarket } from "./binance";
import { fetchYahooMarket } from "./yahoo";

export async function fetchMarket(symbol: MarketSymbol): Promise<MarketData> {
  if (symbol.source === "binance") {
    return fetchBinanceMarket(symbol);
  }

  return fetchYahooMarket(symbol);
}
