import type { MarketKind, MarketSymbol, SymbolSearchResult } from "../types/market";

interface YahooSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  typeDisp?: string;
}

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

const ALLOWED_EXCHANGES = new Set([
  "NMS",
  "NGM",
  "NCM",
  "NAS",
  "NYQ",
  "ASE",
  "PCX",
  "BTS",
  "SNP",
  "NIM",
]);

function classifyKind(quoteType: string | undefined): MarketKind {
  if (quoteType === "INDEX") {
    return "index";
  }
  return "stock";
}

function makeDescription(quote: YahooSearchQuote): string {
  const exchange = quote.exchDisp || quote.exchange || "US Market";
  const type = quote.typeDisp || quote.quoteType || "Equity";
  return `${exchange} ${type} 관측소`;
}

export async function searchYahooSymbols(query: string): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 1) {
    return [];
  }

  const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const payload = (await response.json()) as YahooSearchResponse;
  const quotes = payload.quotes ?? [];

  return quotes
    .filter((quote) => {
      if (!quote.symbol) {
        return false;
      }
      const quoteType = quote.quoteType ?? "";
      const exchange = quote.exchange ?? "";
      return (
        ["EQUITY", "ETF", "INDEX"].includes(quoteType) &&
        (ALLOWED_EXCHANGES.has(exchange) || quote.symbol.startsWith("^"))
      );
    })
    .slice(0, 8)
    .map((quote) => {
      const remoteSymbol = quote.symbol!;
      const shortLabel = remoteSymbol.replace(/^\^/, "");
      const label = quote.longname || quote.shortname || remoteSymbol;

      const symbol: MarketSymbol = {
        id: `YH:${remoteSymbol}`,
        label,
        shortLabel,
        kind: classifyKind(quote.quoteType),
        source: "yahoo",
        remoteSymbol,
        description: makeDescription(quote),
        userAdded: true,
      };

      return {
        symbol,
        exchange: quote.exchDisp || quote.exchange || "US Market",
        quoteType: quote.typeDisp || quote.quoteType || "Equity",
      };
    });
}
