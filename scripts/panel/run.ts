import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import path from "node:path";
import { loadAssetData } from "../backtest/dataLoader";
import type { HistoricalCandle } from "../backtest/types";
import type { LoadedDatasetAsset } from "../dataset/types";
import { AS_OF_DATE, DATASET_ID, REPRESENTATIVE_UNIVERSE } from "../dataset/universe";
import { buildPanelRows } from "./builder";
import type { ContextEnvironment } from "./context";
import { computeBaseSeries, FEATURE_DEFINITIONS } from "./features";
import { createDataContract, createPanelReport } from "./report";
import type { PanelAssetSummary, PanelBuildReport, PanelRow } from "./types";
import { verifyAssetPanel } from "./verification";

const PANEL_ID = "market-weather-eod-panel-v1";
const refresh = process.argv.includes("--refresh");
const root = process.cwd();
const rawDirectory = path.resolve(root, "research-data", "raw");
const outputDirectory = path.resolve(root, "research-results", PANEL_ID);
const panelPath = path.join(outputDirectory, "panel.jsonl.gz");

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarizeRows(assetId: string, sector: string | null, rows: PanelRow[]): PanelAssetSummary {
  const full = rows.filter((row) => row.fullContextReady);
  const featureNames = new Set(rows.flatMap((row) => Object.keys(row.features)));
  const missingFeatureCounts: Record<string, number> = {};
  featureNames.forEach((name) => {
    const missing = rows.filter((row) => row.features[name] === null).length;
    if (missing > 0) missingFeatureCounts[name] = missing;
  });
  const rate = (selector: (row: PanelRow) => number) => rows.reduce((sum, row) => sum + selector(row), 0) / rows.length * 100;
  return {
    assetId,
    sector,
    rows: rows.length,
    firstDate: rows[0].date,
    lastDate: rows.at(-1)!.date,
    fullContextPercent: round(full.length / rows.length * 100),
    firstFullContextDate: full[0]?.date ?? null,
    up1Rate: round(rate((row) => row.labels.up1)),
    up3Rate: round(rate((row) => row.labels.up3)),
    up5Rate: round(rate((row) => row.labels.up5)),
    historicalTailRate: round(rate((row) => row.labels.historicalTailEvent1)),
    missingFeatureCounts,
  };
}

function countRegimes(rows: PanelRow[], accumulator: Record<string, number>) {
  const regimes: Array<[string, string, string]> = [
    ["GFC_2007_2009", "2007-07-01", "2009-06-30"],
    ["EURO_2011", "2011-05-01", "2011-12-31"],
    ["COVID_2020", "2020-02-01", "2020-12-31"],
    ["TIGHTENING_2022", "2022-01-01", "2022-12-31"],
    ["RECENT_2024_2026", "2024-01-01", "2026-06-18"],
  ];
  regimes.forEach(([id, start, end]) => {
    accumulator[id] = (accumulator[id] ?? 0) + rows.filter((row) => row.date >= start && row.date <= end).length;
  });
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function hashUncompressedGzip(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath).pipe(createGunzip());
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const eligibleDefinitions = REPRESENTATIVE_UNIVERSE.filter((asset) => asset.modelUse !== "locked-holdout");
  const targetDefinitions = eligibleDefinitions.filter((asset) => asset.modelUse === "target");
  const loaded = new Map<string, LoadedDatasetAsset>();
  console.log(`[panel] ${PANEL_ID} refresh=${refresh} targets=${targetDefinitions.length}`);
  for (const definition of eligibleDefinitions) {
    const result = await loadAssetData(definition, AS_OF_DATE, refresh, rawDirectory);
    loaded.set(definition.id, { definition, ...result });
  }
  const series = new Map<string, ReturnType<typeof computeBaseSeries>>();
  for (const definition of eligibleDefinitions) {
    console.log(`[features] ${definition.id}`);
    series.set(definition.id, computeBaseSeries(definition, loaded.get(definition.id)!.data.candles));
  }
  const environment: ContextEnvironment = {
    definitions: new Map(eligibleDefinitions.map((asset) => [asset.id, asset])),
    series,
  };
  const spyCandles = loaded.get("SPY")?.data.candles;
  if (!spyCandles) throw new Error("SPY candles are required for relative labels");

  const gzip = createGzip({ level: 9 });
  const file = createWriteStream(panelPath);
  gzip.pipe(file);
  const hash = createHash("sha256");
  const summaries: PanelAssetSummary[] = [];
  const verification: Record<string, boolean | number | string> = {};
  const samples: PanelRow[] = [];
  const regimeAssetDays: Record<string, number> = {};
  let totalRows = 0;

  for (const asset of targetDefinitions) {
    const candles = loaded.get(asset.id)!.data.candles;
    const assetSeries = series.get(asset.id)!;
    const rows = buildPanelRows(asset, candles, assetSeries, environment, spyCandles);
    if (!rows.length) throw new Error(`${asset.id}: no panel rows`);
    Object.assign(verification, verifyAssetPanel(asset, candles, assetSeries, rows));
    summaries.push(summarizeRows(asset.id, asset.sector, rows));
    countRegimes(rows, regimeAssetDays);
    samples.push(...rows.slice(0, 1), ...rows.slice(-1));
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      hash.update(line);
      if (!gzip.write(line)) await new Promise<void>((resolve) => gzip.once("drain", resolve));
      totalRows += 1;
    }
    console.log(`[panel] ${asset.id}: rows=${rows.length} fullContext=${summaries.at(-1)!.fullContextPercent}%`);
  }
  gzip.end();
  await finished(file);
  const outputHash = hash.digest("hex");

  verification.lockedHoldoutsExcluded = !targetDefinitions.some((asset) => asset.modelUse === "locked-holdout");
  verification.panelContainsTargetsOnly = targetDefinitions.length === summaries.length;
  verification.allTPlus1LabelsAligned = Object.entries(verification).filter(([key]) => key.endsWith(".tPlus1LabelAlignment")).every(([, value]) => value === true);
  verification.allPastOnlyRecomputationsInvariant = Object.entries(verification).filter(([key]) => key.endsWith(".pastOnlyTruncationInvariant")).every(([, value]) => value === true);
  verification.allContextDatesLegal = Object.entries(verification).filter(([key]) => key.endsWith(".contextNeverAfterTarget")).every(([, value]) => value === true);
  verification.noTrainValidationTestAssignedYet = true;
  verification.panelRows = totalRows;
  verification.outputRoundTripHashMatches = await hashUncompressedGzip(panelPath) === outputHash;
  const booleanFailures = Object.entries(verification).filter(([, value]) => value === false).map(([key]) => key);
  if (booleanFailures.length) throw new Error(`Panel verification failed: ${booleanFailures.join(", ")}`);

  const report: PanelBuildReport = {
    schemaVersion: 1,
    panelId: PANEL_ID,
    generatedAt: new Date().toISOString(),
    asOfDate: AS_OF_DATE,
    forecastContract: {
      usAssets: "정규장 t 종가 확정 직후 t+1/t+3/t+5 거래일을 예보",
      cryptoAssets: "UTC 일봉 t가 완전히 닫힌 직후 다음 1/3/5 UTC 일봉을 예보",
      btcContextForUs: "미국 t 장 마감 전에 이미 완결된 source date < t BTC 일봉만 사용",
      labelConvention: "각 자산 고유 거래달력 기준 close-to-close; 범위·True Range는 t+1 OHLC",
    },
    sourceUniverseId: DATASET_ID,
    output: { file: "panel.jsonl.gz", rows: totalRows, sha256: outputHash, format: "gzip-compressed UTF-8 JSON Lines; hash is over uncompressed JSONL" },
    assets: summaries,
    featureDefinitions: FEATURE_DEFINITIONS,
    regimeAssetDays,
    verification,
    warnings: [
      "weatherScore v0.1 값은 일봉을 분봉 입력에도 넣은 기준선 재생이며 신규 모델의 정답 변수가 아닙니다.",
      "전체 문맥 특징은 BTC와 HYG의 252기간 이력이 준비된 2018년 이후에 주로 사용 가능합니다. 장기 Core 모델과 최근 Full-context 모델을 분리 비교해야 합니다.",
      "Yahoo/Binance 단일 공급자 의존은 남아 있으며 공식 성능 확정 전에 이중 공급자 표본 대조가 필요합니다.",
      "잠금 홀드아웃 XLC·XLRE·TSLA·NVDA·ETHUSDT는 패널 생성에서 완전히 제외했습니다.",
      "시간 분할과 purge/embargo는 다음 단계에서 적용합니다. 현재 파일을 무작위 분할하면 안 됩니다.",
    ],
  };
  await writeJson(path.join(outputDirectory, "schema.json"), { panelId: PANEL_ID, forecastContract: report.forecastContract, features: FEATURE_DEFINITIONS, labelKeys: Object.keys(samples[0].labels) });
  await writeJson(path.join(outputDirectory, "build-report.json"), report);
  await writeJson(path.join(outputDirectory, "sample-rows.json"), samples);
  await writeFile(path.join(outputDirectory, "report.md"), createPanelReport(report), "utf8");
  await writeFile(path.join(outputDirectory, "DATA_CONTRACT.md"), createDataContract(report), "utf8");
  console.log(`[done] rows=${totalRows} sha256=${outputHash}`);
  console.log(`[done] ${path.relative(root, outputDirectory).replaceAll("\\", "/")}`);
}

main().catch((error) => {
  console.error("[panel] failed", error);
  process.exitCode = 1;
});
