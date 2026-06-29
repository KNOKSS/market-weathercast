import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedAssetData } from "../backtest/types";
import { loadAssetData } from "../backtest/dataLoader";
import { REPRESENTATIVE_UNIVERSE } from "../dataset/universe";
import { buildInferenceRow, buildRecentShadowRows } from "../panel/builder";
import type { ContextEnvironment } from "../panel/context";
import { computeBaseSeries } from "../panel/features";

const ROOT = process.cwd();
const RAW_DIR = path.resolve(ROOT, "research-data", "raw");
const SHADOW_DIR = path.resolve(ROOT, "research-results", "market-weather-shadow-v1");
const dryRun = process.argv.includes("--dry-run");
const refresh = process.argv.includes("--refresh");
const outputPath = path.join(SHADOW_DIR, dryRun ? "dry-run-snapshot.json" : "pending-snapshot.json");
const checksumPath = path.join(SHADOW_DIR, dryRun ? "dry-run-snapshot.sha256" : "pending-snapshot.sha256");

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main() {
  const loaded = new Map<string, CachedAssetData>();
  const sourceManifest = [];
  const latestFullyClosedUtcDate = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  for (const asset of REPRESENTATIVE_UNIVERSE) {
    console.log(`[shadow:snapshot] fetch ${asset.id}`);
    const file = path.join(RAW_DIR, `${asset.id}.json`);
    const data = refresh
      ? (await loadAssetData(asset, latestFullyClosedUtcDate, true, RAW_DIR)).data
      : JSON.parse(await readFile(file, "utf8")) as CachedAssetData;
    if (data.asset.remoteSymbol !== asset.remoteSymbol || data.candles.length < 301) throw new Error(`${asset.id}: invalid cached source`);
    const dates = data.candles.map((candle) => candle.date);
    if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && date <= dates[index - 1])) throw new Error(`${asset.id}: duplicate or non-monotonic dates`);
    loaded.set(asset.id, data);
    sourceManifest.push({ assetId: asset.id, fetchedAt: data.fetchedAt, requestedThroughDate: latestFullyClosedUtcDate, lastClosedDate: dates.at(-1), observations: dates.length, candlesSha256: hash(data.candles) });
  }

  // Shadow output needs only the latest inference row and 400 resolved rows.
  // 1,300 candles still leave the full 756-day trailing quantile history for
  // every exported row and avoid recomputing decades that cannot affect them.
  const workingCandles = new Map(REPRESENTATIVE_UNIVERSE.map((asset) => [asset.id, loaded.get(asset.id)!.candles.slice(-1_300)]));
  const forecastAssets = REPRESENTATIVE_UNIVERSE.filter((asset) => asset.modelUse === "target" || asset.modelUse === "locked-holdout");
  const contextIds = new Set(["SPY", "VIX", "TLT", "IEF", "HYG", "UUP", "GLD", "DBC", "BTCUSDT"]);
  const activeDefinitions = REPRESENTATIVE_UNIVERSE.filter((asset) => forecastAssets.includes(asset) || contextIds.has(asset.id));
  const series = new Map<string, ReturnType<typeof computeBaseSeries>>();
  for (const asset of activeDefinitions) {
    console.log(`[shadow:snapshot] features ${asset.id}`);
    series.set(asset.id, computeBaseSeries(asset, workingCandles.get(asset.id)!));
  }
  const environment: ContextEnvironment = {
    definitions: new Map(activeDefinitions.map((asset) => [asset.id, asset])),
    series,
  };
  const inferenceRows = [];
  const recentResolvedRows = [];
  for (const asset of forecastAssets) {
    const snapshots = series.get(asset.id)!;
    const latest = buildInferenceRow(asset, snapshots.at(-1)!, environment);
    if (!latest) throw new Error(`${asset.id}: latest inference row is not feature-complete`);
    inferenceRows.push(latest);
    recentResolvedRows.push(...buildRecentShadowRows(asset, workingCandles.get(asset.id)!, snapshots, environment));
  }
  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    snapshotId: `shadow-snapshot-${generatedAt}`,
    generatedAt,
    mode: dryRun ? "dry-run" : "pending-official",
    refreshedFromProviders: refresh,
    policy: {
      forecastTiming: "US assets after confirmed US close; crypto after confirmed UTC daily close",
      labels: "resolved row t uses only candle t+1; inference row has no labels",
      training: "frozen candidate v2 coefficients are refit only through 2024-12-31 for the full shadow period",
    },
    sourceManifest,
    inferenceRows,
    recentResolvedRows,
  };
  const envelope = { ...payload, payloadSha256: hash(payload) };
  await mkdir(SHADOW_DIR, { recursive: true });
  const serialized = JSON.stringify(envelope);
  await writeFile(outputPath, serialized, "utf8");
  await writeFile(checksumPath, createHash("sha256").update(serialized).digest("hex") + "\n", "utf8");
  console.log(`[shadow:snapshot] mode=${envelope.mode} forecasts=${inferenceRows.length} resolved=${recentResolvedRows.length}`);
  console.log(`[shadow:snapshot] sha256=${envelope.payloadSha256}`);
  console.log(`[shadow:snapshot] ${path.relative(ROOT, outputPath).replaceAll("\\", "/")}`);
}

main().catch((error) => {
  console.error("[shadow:snapshot] failed", error);
  process.exitCode = 1;
});
