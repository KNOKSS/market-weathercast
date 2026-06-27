import type { DatasetAssetDefinition } from "../dataset/types";
import { REQUIRED_EQUITY_SECTORS } from "../dataset/universe";
import type { BaseSnapshot, NumericFeatures } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export interface ContextEnvironment {
  definitions: Map<string, DatasetAssetDefinition>;
  series: Map<string, BaseSnapshot[]>;
}

export interface ContextSnapshot {
  features: NumericFeatures;
  contextAsOf: Record<string, string | null>;
  fullContextReady: boolean;
}

function asOf(series: BaseSnapshot[] | undefined, date: string, strictBefore = false): BaseSnapshot | null {
  if (!series?.length) return null;
  let low = 0;
  let high = series.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const allowed = strictBefore ? series[middle].date < date : series[middle].date <= date;
    if (allowed) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer >= 0 ? series[answer] : null;
}

function daysBetween(left: string, right: string): number {
  return Math.floor((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / DAY);
}

function value(snapshot: BaseSnapshot | null, key: string): number | null {
  return snapshot?.features[key] ?? null;
}

export function contextAt(target: DatasetAssetDefinition, date: string, environment: ContextEnvironment): ContextSnapshot {
  const ids = ["SPY", "VIX", "TLT", "IEF", "HYG", "UUP", "GLD", "DBC"];
  const snapshots = new Map(ids.map((id) => [id, asOf(environment.series.get(id), date)]));
  // A Binance candle labelled t closes at the end of UTC day t. At the US
  // close on t it is not complete, so only a candle with source date < t is legal.
  const btc = asOf(environment.series.get("BTCUSDT"), date, true);
  const contextAsOf: Record<string, string | null> = Object.fromEntries(ids.map((id) => [id, snapshots.get(id)?.date ?? null]));
  contextAsOf.BTCUSDT_PRIOR = btc?.date ?? null;

  const spy = snapshots.get("SPY") ?? null;
  const vix = snapshots.get("VIX") ?? null;
  const features: NumericFeatures = {
    spyReturn1: value(spy, "return1"),
    spyReturn5: value(spy, "return5"),
    spyReturn20: value(spy, "return20"),
    spyAtrPercentile252: value(spy, "atrPercentile252"),
    spyRealizedVol20Percent: value(spy, "realizedVol20Percent"),
    vixLevel: vix?.close ?? null,
    vixReturn1: value(vix, "return1"),
    vixClosePercentile252: value(vix, "closePercentile252"),
    tltReturn5: value(snapshots.get("TLT") ?? null, "return5"),
    iefReturn5: value(snapshots.get("IEF") ?? null, "return5"),
    hygReturn5: value(snapshots.get("HYG") ?? null, "return5"),
    uupReturn5: value(snapshots.get("UUP") ?? null, "return5"),
    gldReturn5: value(snapshots.get("GLD") ?? null, "return5"),
    dbcReturn5: value(snapshots.get("DBC") ?? null, "return5"),
    btcPriorDayReturn1: value(btc, "return1"),
    btcPriorDayVolPercentile252: value(btc, "realizedVolPercentile252"),
    sectorBreadthUp1Percent: null,
    sectorBreadthAboveSma20Percent: null,
    sectorBreadthCount: null,
    contextMaximumAgeDays: null,
  };

  const sectorSnapshots = [...environment.definitions.values()]
    .filter((asset) => asset.modelUse === "target" && asset.sector !== null && REQUIRED_EQUITY_SECTORS.includes(asset.sector as typeof REQUIRED_EQUITY_SECTORS[number]))
    .map((asset) => asOf(environment.series.get(asset.id), date))
    .filter((snapshot): snapshot is BaseSnapshot => snapshot !== null && daysBetween(snapshot.date, date) <= 4);
  if (sectorSnapshots.length >= 8) {
    features.sectorBreadthCount = sectorSnapshots.length;
    features.sectorBreadthUp1Percent = sectorSnapshots.filter((snapshot) => (snapshot.features.return1 ?? 0) > 0).length / sectorSnapshots.length * 100;
    features.sectorBreadthAboveSma20Percent = sectorSnapshots.filter((snapshot) => (snapshot.features.smaGap20 ?? -Infinity) > 0).length / sectorSnapshots.length * 100;
  }

  const contextDates = Object.values(contextAsOf).filter((sourceDate): sourceDate is string => sourceDate !== null);
  features.contextMaximumAgeDays = contextDates.length ? Math.max(...contextDates.map((sourceDate) => daysBetween(sourceDate, date))) : null;
  Object.keys(features).forEach((key) => {
    const current = features[key];
    if (current !== null) features[key] = Math.round(current * 1_000_000) / 1_000_000;
  });
  const required = [
    "spyReturn1", "spyReturn5", "spyReturn20", "spyAtrPercentile252", "vixLevel", "vixClosePercentile252",
    "tltReturn5", "iefReturn5", "hygReturn5", "uupReturn5", "gldReturn5", "dbcReturn5",
    "btcPriorDayReturn1", "btcPriorDayVolPercentile252", "sectorBreadthUp1Percent", "sectorBreadthAboveSma20Percent",
  ];
  const allPresent = required.every((key) => features[key] !== null && Number.isFinite(features[key]));
  const agesLegal = features.contextMaximumAgeDays !== null && features.contextMaximumAgeDays <= (target.calendar === "24/7" ? 4 : 1);
  return { features, contextAsOf, fullContextReady: allPresent && agesLegal };
}
