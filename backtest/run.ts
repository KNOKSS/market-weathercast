import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { configSnapshot, EXPERIMENT } from "./config";
import { loadAssetData } from "./dataLoader";
import { createMarkdownReport } from "./report";
import { replayAsset } from "./replay";
import { assetEqualSummary, pooledObservationSummary, summarizeAsset, summarizeVixAgainstSp500 } from "./statistics";
import type { BacktestObservation, BacktestSummary, DataManifestEntry } from "./types";
import { verifyAssetReplay } from "./verification";

const refresh = process.argv.includes("--refresh");
const outputDirectory = path.resolve(process.cwd(), "backtest-results", EXPERIMENT.experimentId);
const observationDirectory = path.join(outputDirectory, "observations");

async function writeJson(filePath: string, value: unknown, pretty = true) {
  await writeFile(filePath, JSON.stringify(value, null, pretty ? 2 : undefined), "utf8");
}

async function main() {
  await mkdir(observationDirectory, { recursive: true });
  const config = configSnapshot();
  config.engineSource.sha256 = createHash("sha256")
    .update(await readFile(path.resolve(process.cwd(), config.engineSource.file)))
    .digest("hex");
  const manifest: DataManifestEntry[] = [];
  const allObservations: BacktestObservation[] = [];
  const verification: Record<string, boolean | number | string> = {
    mockDataExcluded: true,
    temporalSplit: "60/20/20 chronological",
    finalTestReservedFromTuning: true,
  };
  const assetSummaries = [];

  console.log(`[backtest] ${config.experimentId}`);
  console.log(`[backtest] refresh=${refresh} endDate=${config.endDate}`);

  for (const asset of config.assets) {
    console.log(`[data] ${asset.id}: loading ${asset.source} daily history`);
    const loaded = await loadAssetData(asset, config.endDate, refresh);
    manifest.push(loaded.manifest);
    console.log(`[data] ${asset.id}: ${loaded.data.candles.length} candles, ${loaded.manifest.startDate}..${loaded.manifest.endDate}`);

    const observations = replayAsset(asset, loaded.data.candles, config.minimumHistory, config.split);
    Object.assign(verification, verifyAssetReplay(asset, loaded.data.candles, observations, config.minimumHistory));
    allObservations.push(...observations);
    await writeJson(path.join(observationDirectory, `${asset.id}.json`), observations, false);

    const summary = summarizeAsset(
      asset,
      observations,
      config.bootstrapSamples,
      config.randomBaselineRuns,
      config.randomSeed,
    );
    assetSummaries.push(summary);
    console.log(`[replay] ${asset.id}: train=${summary.sample.train} validation=${summary.sample.validation} test=${summary.sample.test}`);
  }

  const pooled = pooledObservationSummary(allObservations, config.bootstrapSamples, config.randomSeed);
  const summary: BacktestSummary = {
    config,
    dataManifest: manifest,
    verification,
    assets: assetSummaries,
    pooled: {
      includedAssets: config.assets.filter((asset) => asset.role !== "risk-proxy").map((asset) => asset.id),
      excludedFromDirectionalPool: config.assets.filter((asset) => asset.role === "risk-proxy").map((asset) => asset.id),
      observationWeighted: pooled,
      assetEqual: assetEqualSummary(assetSummaries),
    },
    crossAsset: {
      vixWeatherAgainstSp500: summarizeVixAgainstSp500(
        allObservations,
        config.bootstrapSamples,
        config.randomSeed,
      ),
    },
  };

  await writeJson(path.join(outputDirectory, "config.json"), config);
  await writeJson(path.join(outputDirectory, "data-manifest.json"), manifest);
  await writeJson(path.join(outputDirectory, "summary.json"), summary);
  await writeFile(path.join(outputDirectory, "report.md"), createMarkdownReport(summary), "utf8");

  console.log(`[done] ${path.relative(process.cwd(), outputDirectory).replaceAll("\\", "/")}`);
  console.log(`[done] observations=${allObservations.length} checks=${Object.keys(verification).length}`);
}

main().catch((error) => {
  console.error("[backtest] failed", error);
  process.exitCode = 1;
});
