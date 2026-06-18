import type { MarketSymbol } from "../types/market";

interface StationIdentityProps {
  symbol: MarketSymbol;
}

interface StationMeta {
  emblem: string;
  market: string;
  tone: string;
}

function getStationMeta(symbol: MarketSymbol): StationMeta {
  const remoteSymbol = symbol.remoteSymbol.toUpperCase();

  if (symbol.kind === "crypto") {
    if (remoteSymbol.startsWith("BTC")) return { emblem: "₿", market: "24시간 코인 시장", tone: "btc" };
    if (remoteSymbol.startsWith("ETH")) return { emblem: "◆", market: "24시간 코인 시장", tone: "eth" };
    if (remoteSymbol.startsWith("SOL")) return { emblem: "≋", market: "24시간 코인 시장", tone: "sol" };
    return { emblem: "◈", market: "24시간 코인 시장", tone: "crypto" };
  }

  if (remoteSymbol === "^KS11" || remoteSymbol.endsWith(".KS") || remoteSymbol.endsWith(".KQ")) {
    return { emblem: "🇰🇷", market: "한국 시장", tone: "kr" };
  }
  if (remoteSymbol === "^N225" || remoteSymbol.endsWith(".T")) {
    return { emblem: "🇯🇵", market: "일본 시장", tone: "jp" };
  }
  if (remoteSymbol === "^FTSE" || remoteSymbol.endsWith(".L")) {
    return { emblem: "🇬🇧", market: "영국 시장", tone: "gb" };
  }
  if (remoteSymbol === "^HSI" || remoteSymbol.endsWith(".HK")) {
    return { emblem: "🇭🇰", market: "홍콩 시장", tone: "hk" };
  }
  if (remoteSymbol.includes("STOXX") || remoteSymbol.includes("GDAXI") || remoteSymbol.endsWith(".DE")) {
    return { emblem: "🇪🇺", market: "유럽 시장", tone: "eu" };
  }

  return { emblem: "🇺🇸", market: "미국 시장", tone: "us" };
}

export function StationIdentity({ symbol }: StationIdentityProps) {
  const meta = getStationMeta(symbol);

  return (
    <div className={`station-identity station-${meta.tone}`} aria-label={`${symbol.shortLabel} 관측소, ${meta.market}`}>
      <span className="station-emblem" aria-hidden="true">{meta.emblem}</span>
      <span className="station-copy">
        <small>현재 관측소 · {meta.market}</small>
        <strong>{symbol.shortLabel} 관측소</strong>
      </span>
    </div>
  );
}
