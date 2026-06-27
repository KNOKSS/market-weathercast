import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAssetData } from "../backtest/dataLoader";
import { auditAsset, findRedundancy, QUALITY_POLICY } from "./quality";
import { createDatasetCard, createDatasetReport } from "./report";
import type { DatasetAuditResult, LoadedDatasetAsset } from "./types";
import { AS_OF_DATE, DATASET_ID, REPRESENTATIVE_UNIVERSE, REQUIRED_EQUITY_SECTORS } from "./universe";

const refresh = process.argv.includes("--refresh");
const root = process.cwd();
const rawDirectory = path.resolve(root, "research-data", "raw");
const outputDirectory = path.resolve(root, "research-results", DATASET_ID);

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const loadedAssets: LoadedDatasetAsset[] = [];
  console.log(`[dataset] ${DATASET_ID}`);
  console.log(`[dataset] refresh=${refresh} asOf=${AS_OF_DATE} assets=${REPRESENTATIVE_UNIVERSE.length}`);
  for (const definition of REPRESENTATIVE_UNIVERSE) {
    console.log(`[data] ${definition.id}: ${definition.cohort} / ${definition.purpose}`);
    const loaded = await loadAssetData(definition, AS_OF_DATE, refresh, rawDirectory);
    loadedAssets.push({ definition, ...loaded });
    console.log(`[data] ${definition.id}: ${loaded.manifest.observations} rows, ${loaded.manifest.startDate}..${loaded.manifest.endDate}`);
  }
  const spy = loadedAssets.find((asset) => asset.definition.id === "SPY");
  if (!spy) throw new Error("SPY is required as the US trading-calendar reference");
  const spyDates = new Set(spy.data.candles.map((candle) => candle.date));
  const audits = loadedAssets.map((asset) => auditAsset(asset, spyDates, AS_OF_DATE));
  const redundancy = findRedundancy(loadedAssets);
  const failedAssets = audits.filter((audit) => audit.qualityGate === "fail").map((audit) => audit.assetId);
  const reviewAssets = audits.filter((audit) => audit.qualityGate === "review").map((audit) => audit.assetId);
  const staleAssets = audits.filter((audit) => audit.issues.some((issue) => issue.code === "STALE_DATA")).map((audit) => audit.assetId);
  const presentSectors = new Set(REPRESENTATIVE_UNIVERSE.filter((asset) => asset.modelUse === "target").map((asset) => asset.sector).filter((sector): sector is string => Boolean(sector)));
  const developmentTargetIds = REPRESENTATIVE_UNIVERSE.filter((asset) => asset.modelUse === "target").map((asset) => asset.id);
  const result: DatasetAuditResult = {
    schemaVersion: 1,
    datasetId: DATASET_ID,
    generatedAt: new Date().toISOString(),
    asOfDate: AS_OF_DATE,
    policy: { ...QUALITY_POLICY, lockedHoldoutPolicy: "locked-transfer-holdout 자산의 가격 데이터는 무결성만 검사합니다. 특징 선택, 모델 선택, 확률 보정, 임계값 튜닝에는 사용하지 않으며 최종 전이성 시험에서 한 번만 엽니다." },
    universe: REPRESENTATIVE_UNIVERSE,
    manifest: loadedAssets.map((asset) => asset.manifest),
    audits,
    redundancy,
    gates: {
      allDevelopmentTargetsPass: audits.filter((audit) => developmentTargetIds.includes(audit.assetId)).every((audit) => audit.qualityGate !== "fail"),
      allElevenEquitySectorsPresent: REQUIRED_EQUITY_SECTORS.every((sector) => presentSectors.has(sector)),
      noFailedAssets: failedAssets.length === 0,
      staleAssets,
      failedAssets,
      reviewAssets,
    },
  };
  const universeHash = createHash("sha256").update(JSON.stringify(REPRESENTATIVE_UNIVERSE)).digest("hex");
  await writeJson(path.join(outputDirectory, "universe.json"), { datasetId: DATASET_ID, sha256: universeHash, assets: REPRESENTATIVE_UNIVERSE });
  await writeJson(path.join(outputDirectory, "data-manifest.json"), result.manifest);
  await writeJson(path.join(outputDirectory, "quality-audit.json"), result);
  await writeJson(path.join(outputDirectory, "redundancy.json"), redundancy);
  await writeFile(path.join(outputDirectory, "report.md"), createDatasetReport(result), "utf8");
  await writeFile(path.join(outputDirectory, "DATASET_CARD.md"), createDatasetCard(result), "utf8");
  console.log(`[done] ${path.relative(root, outputDirectory).replaceAll("\\", "/")}`);
  console.log(`[gate] sectors=${result.gates.allElevenEquitySectorsPresent} development=${result.gates.allDevelopmentTargetsPass} noFailures=${result.gates.noFailedAssets}`);
  console.log(`[gate] failed=${failedAssets.join(",") || "none"} review=${reviewAssets.join(",") || "none"}`);
}

main().catch((error) => {
  console.error("[dataset] failed", error);
  process.exitCode = 1;
});
