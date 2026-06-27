import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetDefinition, CachedAssetData, DataManifestEntry, HistoricalCandle } from "./types";

const DEFAULT_RAW_DATA_DIR = path.resolve(process.cwd(), "backtest-data", "raw");
const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const BINANCE_API = "https://api.binance.com/api/v3/klines";

interface YahooResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
  };
}

type BinanceRow = [number, string, string, string, string, string, number, ...unknown[]];

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "market-weather-backtest/0.1", accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 900);
    }
  }
  throw lastError;
}

function validateCandles(asset: AssetDefinition, candles: HistoricalCandle[]): HistoricalCandle[] {
  const unique = new Map<string, HistoricalCandle>();
  candles.forEach((candle) => {
    const valid = [candle.open, candle.high, candle.low, candle.close, candle.volume]
      .every((value) => Number.isFinite(value)) && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0;
    if (valid && candle.high >= candle.low) unique.set(candle.date, candle);
  });
  const sorted = [...unique.values()].sort((a, b) => a.time - b.time);
  if (sorted.length < 100) throw new Error(`${asset.id}: only ${sorted.length} valid daily candles`);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].time <= sorted[index - 1].time) throw new Error(`${asset.id}: non-monotonic timestamps`);
  }
  return sorted;
}

async function fetchYahoo(asset: AssetDefinition, endDate: string): Promise<CachedAssetData> {
  const period1 = Math.floor(Date.parse(`${asset.startDate}T00:00:00.000Z`) / 1000);
  const period2 = Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) + 24 * 60 * 60 * 1000) / 1000);
  const url = `${YAHOO_CHART}/${encodeURIComponent(asset.remoteSymbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
  const payload = await fetchJson<YahooResponse>(url);
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  if (!result?.timestamp || !quote) throw new Error(`${asset.id}: Yahoo response is missing candles`);

  const candles = result.timestamp.flatMap((seconds, index) => {
    const rawOpen = quote.open?.[index];
    const rawHigh = quote.high?.[index];
    const rawLow = quote.low?.[index];
    const rawClose = quote.close?.[index];
    if ([rawOpen, rawHigh, rawLow, rawClose].some((value) => value == null)) return [];
    const date = isoDate(seconds * 1000);
    if (date < asset.startDate || date > endDate) return [];
    const adjustedClose = adjusted[index];
    const factor = adjustedClose && rawClose && Number.isFinite(adjustedClose / rawClose)
      ? adjustedClose / rawClose
      : 1;
    return [{
      date,
      time: seconds * 1000,
      open: Number(rawOpen) * factor,
      high: Number(rawHigh) * factor,
      low: Number(rawLow) * factor,
      close: Number(rawClose) * factor,
      volume: Number(quote.volume?.[index] ?? 0),
    }];
  });

  return {
    schemaVersion: 1,
    asset,
    fetchedAt: new Date().toISOString(),
    sourceUrl: url,
    adjustment: "Yahoo adjusted-close factor applied to OHLC; provider volume retained",
    candles: validateCandles(asset, candles),
  };
}

async function fetchBinance(asset: AssetDefinition, endDate: string): Promise<CachedAssetData> {
  const endTime = Date.parse(`${endDate}T23:59:59.999Z`);
  let cursor = Date.parse(`${asset.startDate}T00:00:00.000Z`);
  const rows: BinanceRow[] = [];

  while (cursor <= endTime) {
    const url = `${BINANCE_API}?symbol=${encodeURIComponent(asset.remoteSymbol)}&interval=1d&limit=1000&startTime=${cursor}&endTime=${endTime}`;
    const batch = await fetchJson<BinanceRow[]>(url);
    if (batch.length === 0) break;
    rows.push(...batch);
    const next = Number(batch.at(-1)?.[0] ?? cursor) + 24 * 60 * 60 * 1000;
    if (next <= cursor) throw new Error(`${asset.id}: Binance pagination did not advance`);
    cursor = next;
    if (batch.length < 1000) break;
    await sleep(180);
  }

  const candles = rows.flatMap((row) => {
    const date = isoDate(row[0]);
    if (date < asset.startDate || date > endDate) return [];
    return [{
      date,
      time: row[0],
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }];
  });

  return {
    schemaVersion: 1,
    asset,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `${BINANCE_API}?symbol=${asset.remoteSymbol}&interval=1d&paginated=true`,
    adjustment: "Native Binance spot OHLCV; no corporate-action adjustment required",
    candles: validateCandles(asset, candles),
  };
}

export async function loadAssetData(
  asset: AssetDefinition,
  endDate: string,
  refresh: boolean,
  rawDataDirectory = DEFAULT_RAW_DATA_DIR,
): Promise<{ data: CachedAssetData; manifest: DataManifestEntry }> {
  await mkdir(rawDataDirectory, { recursive: true });
  const cachePath = path.join(rawDataDirectory, `${asset.id}.json`);
  let data: CachedAssetData | null = null;

  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as CachedAssetData;
      if (cached.schemaVersion === 1 && cached.asset.remoteSymbol === asset.remoteSymbol && cached.candles.at(-1)?.date === endDate) {
        data = { ...cached, candles: validateCandles(asset, cached.candles) };
      }
    } catch {
      data = null;
    }
  }

  if (!data) {
    data = asset.source === "yahoo" ? await fetchYahoo(asset, endDate) : await fetchBinance(asset, endDate);
    await writeFile(cachePath, JSON.stringify(data), "utf8");
  }

  const relativeCache = path.relative(process.cwd(), cachePath).replaceAll("\\", "/");
  return {
    data,
    manifest: {
      assetId: asset.id,
      source: asset.source,
      remoteSymbol: asset.remoteSymbol,
      startDate: data.candles[0].date,
      endDate: data.candles.at(-1)!.date,
      observations: data.candles.length,
      sha256: sha256(data.candles),
      cacheFile: relativeCache,
      adjustment: data.adjustment,
    },
  };
}
