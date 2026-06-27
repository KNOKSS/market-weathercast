import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import path from "node:path";
import { loadAssetData } from "../backtest/dataLoader";
import type { LoadedDatasetAsset } from "../dataset/types";
import { AS_OF_DATE, REPRESENTATIVE_UNIVERSE } from "../dataset/universe";
import { buildPanelRows } from "../panel/builder";
import type { ContextEnvironment } from "../panel/context";
import { computeBaseSeries } from "../panel/features";
import type { PanelRow } from "../panel/types";
import { verifyAssetPanel } from "../panel/verification";

const PANEL_ID = "market-weather-transfer-panel-v1";
const root = process.cwd();
const rawDirectory = path.resolve(root, "research-data", "raw");
const outputDirectory = path.resolve(root, "research-results", PANEL_ID);
const panelPath = path.join(outputDirectory, "panel.jsonl.gz");

async function hashUncompressedGzip(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(filePath).pipe(createGunzip());
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

async function main() {
  if (await import("node:fs").then(({ existsSync }) => existsSync(panelPath))) {
    throw new Error("Transfer panel already exists; locked holdout labels may only be opened once");
  }
  await mkdir(outputDirectory, { recursive: true });
  const targets = REPRESENTATIVE_UNIVERSE.filter((asset) => asset.modelUse === "locked-holdout");
  const loaded = new Map<string, LoadedDatasetAsset>();
  for (const definition of REPRESENTATIVE_UNIVERSE) {
    const result = await loadAssetData(definition, AS_OF_DATE, false, rawDirectory);
    loaded.set(definition.id, { definition, ...result });
  }
  const series = new Map<string, ReturnType<typeof computeBaseSeries>>();
  for (const definition of REPRESENTATIVE_UNIVERSE) {
    series.set(definition.id, computeBaseSeries(definition, loaded.get(definition.id)!.data.candles));
  }
  const environment: ContextEnvironment = {
    definitions: new Map(REPRESENTATIVE_UNIVERSE.map((asset) => [asset.id, asset])),
    series,
  };
  const spyCandles = loaded.get("SPY")!.data.candles;
  const gzip = createGzip({ level: 9 });
  const file = createWriteStream(panelPath);
  gzip.pipe(file);
  const digest = createHash("sha256");
  const verification: Record<string, boolean | number | string> = {};
  const assets = [];
  let rows = 0;
  for (const asset of targets) {
    const candles = loaded.get(asset.id)!.data.candles;
    const assetSeries = series.get(asset.id)!;
    const panelRows = buildPanelRows(asset, candles, assetSeries, environment, spyCandles);
    Object.assign(verification, verifyAssetPanel(asset, candles, assetSeries, panelRows));
    for (const row of panelRows) {
      const line = `${JSON.stringify(row)}\n`;
      digest.update(line);
      if (!gzip.write(line)) await new Promise<void>((resolve) => gzip.once("drain", resolve));
      rows += 1;
    }
    assets.push({ assetId: asset.id, rows: panelRows.length, firstDate: panelRows[0].date, lastDate: panelRows.at(-1)!.date });
    console.log(`[transfer-panel] ${asset.id}: ${panelRows.length}`);
  }
  gzip.end();
  await finished(file);
  const sha256 = digest.digest("hex");
  verification.allTPlus1LabelsAligned = Object.entries(verification).filter(([key]) => key.endsWith(".tPlus1LabelAlignment")).every(([, value]) => value === true);
  verification.allPastOnlyRecomputationsInvariant = Object.entries(verification).filter(([key]) => key.endsWith(".pastOnlyTruncationInvariant")).every(([, value]) => value === true);
  verification.allContextDatesLegal = Object.entries(verification).filter(([key]) => key.endsWith(".contextNeverAfterTarget")).every(([, value]) => value === true);
  verification.outputRoundTripHashMatches = await hashUncompressedGzip(panelPath) === sha256;
  verification.onlyLockedTransferHoldouts = targets.every((asset) => asset.modelUse === "locked-holdout");
  const failures = Object.entries(verification).filter(([, value]) => value === false).map(([key]) => key);
  if (failures.length) throw new Error(`Transfer panel verification failed: ${failures.join(", ")}`);
  const report = {
    schemaVersion: 1,
    panelId: PANEL_ID,
    generatedAt: new Date().toISOString(),
    asOfDate: AS_OF_DATE,
    output: { file: "panel.jsonl.gz", rows, sha256, format: "gzip JSONL; hash over uncompressed rows" },
    assets,
    verification,
    policy: "Created once after candidate v2 and sealed-test protocol were frozen. No feature, threshold, or model selection may use these labels.",
  };
  await writeFile(path.join(outputDirectory, "build-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`[done] rows=${rows} sha256=${sha256}`);
}

main().catch((error) => {
  console.error("[transfer-panel] failed", error);
  process.exitCode = 1;
});
