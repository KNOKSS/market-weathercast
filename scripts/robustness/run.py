from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "modeling"))
import run as modeling  # noqa: E402


def load_calibration_module():
    path = ROOT / "scripts" / "calibration" / "run.py"
    spec = importlib.util.spec_from_file_location("market_weather_calibration", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import calibration module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calibration = load_calibration_module()


OUTPUT_DIR = ROOT / "research-results" / "market-weather-robustness-v1"
CALIBRATION_DIR = ROOT / "research-results" / "market-weather-calibration-v1"
ROBUSTNESS_ID = "market-weather-robustness-v1"
EXPECTED_CANDIDATE_HASH = "24ad1b0b59b5a924e6cbff35cd0b5513e13672cdc1dbc5ff2fd6bf8b2e7d341a"
BOOTSTRAP_SAMPLES = modeling.BOOTSTRAP_SAMPLES
RANGE_FEATURES = calibration.RANGE_FEATURES
TAIL_FEATURES = calibration.TAIL_FEATURES
RANGE_LAMBDA = calibration.RANGE_LAMBDA
TAIL_LAMBDA = calibration.TAIL_LAMBDA
ADAPTIVE_STRENGTH = 1.0


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def json_safe(value):
    return calibration.json_safe(value)


def records_for_window(history: list[dict], start: str, end: str, role: str | None = None) -> list[dict]:
    by_asset = defaultdict(list)
    for record in history:
        if start <= record["date"] <= end and (role is None or record["role"] == role):
            by_asset[record["asset"]].append(record)
    result = []
    for asset_records in by_asset.values():
        ordered = sorted(asset_records, key=lambda item: item["date"])
        result.extend(ordered[5:])  # Same five-period purge used by the frozen inner protocol.
    return sorted(result, key=lambda item: (item["asset"], item["date"]))


def ranked_records_for_keys(history: list[dict], model, keys: set[tuple[str, str]]) -> list[dict]:
    required_assets = {asset for asset, _ in keys}
    by_asset = defaultdict(list)
    for record in history:
        if record["asset"] in required_assets:
            by_asset[record["asset"]].append(record)
    ranked = []
    for asset, asset_records in by_asset.items():
        ordered = sorted(asset_records, key=lambda item: item["date"])
        predictions = model.predict(ordered)
        actual_ranges = modeling.target(ordered, "range_y")
        for index, record in enumerate(ordered):
            if (asset, record["date"]) not in keys or index < calibration.LOOKBACK:
                continue
            prior_predictions = predictions[index - calibration.LOOKBACK:index]
            prior_ranges = actual_ranges[index - calibration.LOOKBACK:index]
            prior_median = float(np.median(prior_ranges))
            threshold = float(np.quantile(prior_ranges, 0.90))
            ranked.append({
                **record,
                "range_prediction": float(predictions[index]),
                "prediction_percentile252": float(100 * np.mean(prior_predictions <= predictions[index])),
                "actual_range_atr_ratio": record["range_y"] / max(record["atr_direct"], 0.01),
                "actual_range_prior_median_ratio": record["range_y"] / max(prior_median, 0.01),
                "historical_high_range_event": int(record["range_y"] > threshold),
            })
    return sorted(ranked, key=lambda item: (item["asset"], item["date"]))


def range_evaluation(records: list[dict], prediction: np.ndarray, atr_scale: float) -> dict:
    baseline = modeling.target(records, "atr_direct") * atr_scale
    candidate_metrics = modeling.range_metrics(records, prediction)
    baseline_metrics = modeling.range_metrics(records, baseline)
    bootstrap = modeling.bootstrap_delta(records, prediction, baseline, "range_y", modeling.mae)
    return {
        "candidate": candidate_metrics,
        "atrScaledBaseline": baseline_metrics,
        "maeDelta": candidate_metrics["mae"] - baseline_metrics["mae"],
        "spearmanDelta": candidate_metrics["spearman"] - baseline_metrics["spearman"],
        "bootstrapCandidateMinusBaselineMae": bootstrap,
    }


def weather_evaluation(records: list[dict]) -> dict:
    bins = calibration.asset_equal_bin_metrics(records)
    bootstrap = calibration.bootstrap_weather_delta(records)
    quiet, storm = bins["quiet"], bins["storm"]
    return {
        "bins": bins,
        "stormMinusQuietPriorMedianRatio": storm["actualRangePriorMedianRatio"] - quiet["actualRangePriorMedianRatio"],
        "stormMinusQuietHighRangeEventRate": storm["highRangeEventRate"] - quiet["highRangeEventRate"],
        "bootstrap": bootstrap,
    }


def tail_evaluation(records: list[dict], prediction: np.ndarray, base_rate: float) -> dict:
    baseline = np.full(len(records), base_rate)
    candidate_metrics = modeling.probability_metrics(records, prediction, "tail_y")
    baseline_metrics = modeling.probability_metrics(records, baseline, "tail_y")
    bootstrap = modeling.bootstrap_delta(records, prediction, baseline, "tail_y", modeling.brier)
    return {
        "candidate": candidate_metrics,
        "trainBaseRate": baseline_metrics,
        "brierDelta": candidate_metrics["brier"] - baseline_metrics["brier"],
        "aucDeltaFromRandom": candidate_metrics["rocAuc"] - 0.5,
        "bootstrapCandidateMinusBaseBrier": bootstrap,
    }


def fit_candidate(train_records: list[dict]):
    return (
        modeling.fit_ridge(train_records, RANGE_FEATURES, RANGE_LAMBDA),
        modeling.fit_logistic(train_records, TAIL_FEATURES, TAIL_LAMBDA, "tail_y"),
        modeling.fit_atr_scale(train_records),
        modeling.weighted_base_rate(train_records, "tail_y"),
    )


def tail_candidate(records: list[dict], tail_model, recent_prior: dict, base_rate: float) -> np.ndarray:
    raw = tail_model.predict(records)
    return calibration.adaptive_probability(records, raw, recent_prior, base_rate, ADAPTIVE_STRENGTH)


def fold_stability(train: list[dict], history: list[dict]) -> list[dict]:
    results = []
    for fold_index, (train_end, validation_start, validation_end) in enumerate(modeling.INNER_CORE_FOLDS, start=1):
        fold_train, _ = modeling.inner_fold(train, train_end, validation_start, validation_end)
        range_model, tail_model, atr_scale, base_rate = fit_candidate(fold_train)
        recent_prior = calibration.build_recent_prior(history, base_rate)
        cohorts = {}
        for cohort, role in (("seen-assets", "development"), ("asset-holdout", "asset-holdout")):
            evaluation_records = records_for_window(history, validation_start, validation_end, role)
            keys = {(item["asset"], item["date"]) for item in evaluation_records}
            ranked = ranked_records_for_keys(history, range_model, keys)
            cohorts[cohort] = {
                "rows": len(evaluation_records),
                "assets": len({item["asset"] for item in evaluation_records}),
                "range": range_evaluation(evaluation_records, range_model.predict(evaluation_records), atr_scale),
                "weather": weather_evaluation(ranked),
                "tail": tail_evaluation(evaluation_records, tail_candidate(evaluation_records, tail_model, recent_prior, base_rate), base_rate),
            }
        results.append({
            "fold": fold_index,
            "trainEnd": train_end,
            "validationStart": validation_start,
            "validationEnd": validation_end,
            "trainingRows": len(fold_train),
            "cohorts": cohorts,
        })
        print(f"[fold] {fold_index}: train={len(fold_train):,} {validation_start[:4]}-{validation_end[:4]}", flush=True)
    return results


def oof_global_quantiles(train_records: list[dict]) -> tuple[dict, int]:
    oof_records, predictions, _ = calibration.make_oof_predictions(train_records, "range")
    quantiles, _ = calibration.conformal_quantiles(oof_records, predictions)
    return quantiles, len(oof_records)


def cluster_transfer(train: list[dict], validation: list[dict], history: list[dict], clusters: dict[str, list[str]]) -> list[dict]:
    results = []
    for cluster, assets in clusters.items():
        reduced_train = [item for item in train if item["cluster"] != cluster]
        removed_rows = len(train) - len(reduced_train)
        range_model, tail_model, atr_scale, base_rate = fit_candidate(reduced_train)
        recent_prior = calibration.build_recent_prior(history, base_rate)
        evaluation_records = [item for item in validation if item["cluster"] == cluster]
        if not evaluation_records:
            continue
        keys = {(item["asset"], item["date"]) for item in evaluation_records}
        cluster_history = [item for item in history if item["cluster"] == cluster]
        ranked = ranked_records_for_keys(cluster_history, range_model, keys)
        global_q, oof_rows = oof_global_quantiles(reduced_train)
        range_prediction = range_model.predict(evaluation_records)
        interval = calibration.interval_metrics(evaluation_records, range_prediction, global_q, {}, "global")
        tail_prediction = tail_candidate(evaluation_records, tail_model, recent_prior, base_rate)
        result = {
            "cluster": cluster,
            "declaredAssets": assets,
            "removedTrainingRows": removed_rows,
            "trainingRows": len(reduced_train),
            "alreadyZeroShotCluster": removed_rows == 0,
            "evaluationRows": len(evaluation_records),
            "evaluationAssets": sorted({item["asset"] for item in evaluation_records}),
            "range": range_evaluation(evaluation_records, range_prediction, atr_scale),
            "globalFallbackInterval": {**interval, "oofCalibrationRows": oof_rows},
            "weather": weather_evaluation(ranked),
            "tail": tail_evaluation(evaluation_records, tail_prediction, base_rate),
        }
        results.append(result)
        print(f"[cluster] {cluster}: removed={removed_rows:,} eval={len(evaluation_records):,}", flush=True)
    return results


def fold_gate(results: list[dict]) -> dict:
    rows = []
    for fold in results:
        for cohort_name, cohort in fold["cohorts"].items():
            rows.append({
                "fold": fold["fold"],
                "cohort": cohort_name,
                "rangeMaeImproves": cohort["range"]["maeDelta"] < 0,
                "rangeBootstrapUpperBelowZero": cohort["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"][1] < 0,
                "weatherRangeEndpointPositive": cohort["weather"]["stormMinusQuietPriorMedianRatio"] > 0,
                "weatherRiskEndpointPositive": cohort["weather"]["stormMinusQuietHighRangeEventRate"] > 0,
                "weatherRangeBootstrapLowerAboveZero": cohort["weather"]["bootstrap"]["stormMinusQuietActualRangePriorMedianRatio"]["ci95"][0] > 0,
                "weatherRiskBootstrapLowerAboveZero": cohort["weather"]["bootstrap"]["stormMinusQuietHighRangeEventRate"]["ci95"][0] > 0,
                "tailBrierImproves": cohort["tail"]["brierDelta"] < 0,
                "tailBootstrapUpperBelowZero": cohort["tail"]["bootstrapCandidateMinusBaseBrier"]["ci95"][1] < 0,
                "tailAucAboveRandom": cohort["tail"]["candidate"]["rocAuc"] > 0.5,
            })
    def rate(key):
        return float(np.mean([item[key] for item in rows]))
    return {
        "evaluations": len(rows),
        "details": rows,
        "passRates": {key: rate(key) for key in rows[0] if key not in {"fold", "cohort"}},
    }


def cluster_gate(results: list[dict]) -> dict:
    rows = []
    for item in results:
        rows.append({
            "cluster": item["cluster"],
            "rangeMaeImproves": item["range"]["maeDelta"] < 0,
            "rangeBootstrapUpperBelowZero": item["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"][1] < 0,
            "intervalCoverageErrorAtMost10Points": item["globalFallbackInterval"]["meanAbsoluteCoverageError"] <= 0.10,
            "weatherRangeEndpointPositive": item["weather"]["stormMinusQuietPriorMedianRatio"] > 0,
            "weatherRiskEndpointPositive": item["weather"]["stormMinusQuietHighRangeEventRate"] > 0,
            "tailBrierImproves": item["tail"]["brierDelta"] < 0,
            "tailAucAboveRandom": item["tail"]["candidate"]["rocAuc"] > 0.5,
        })
    def rate(key):
        return float(np.mean([item[key] for item in rows]))
    return {"clusters": len(rows), "details": rows, "passRates": {key: rate(key) for key in rows[0] if key != "cluster"}}


def artifact_hash(payload: dict) -> str:
    encoded = json.dumps(json_safe(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def markdown_report(report: dict) -> str:
    fold_gate_result, cluster_gate_result = report["gates"]["timeStability"], report["gates"]["clusterTransfer"]
    lines = [
        "# 시장기상청 후보 강건성 연구 v1", "", "## 연구 경계", "",
        f"- 동결 후보 해시: `{report['candidateArtifactSha256']}`",
        f"- 봉인 시험 라벨 사용: {report['verification']['sealedTestLabelsUsed']}",
        "- 앱 공식 변경: 없음", "- 후보 계수·특성·경계값 재튜닝: 없음", "",
        "## 2015~2022 시기 안정성", "",
        "|구간|집단|변동폭 MAE Δ|변동폭 Spearman|폭풍−잔잔 변동폭|폭풍−잔잔 사건률|꼬리위험 Brier Δ|꼬리위험 AUC|", "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for fold in report["timeStability"]:
        period = f"{fold['validationStart'][:4]}–{fold['validationEnd'][:4]}"
        for cohort_name, cohort in fold["cohorts"].items():
            lines.append(
                f"|{period}|{cohort_name}|{cohort['range']['maeDelta']:.4f}|{cohort['range']['candidate']['spearman']:.3f}|"
                f"{cohort['weather']['stormMinusQuietPriorMedianRatio']:.3f}|{cohort['weather']['stormMinusQuietHighRangeEventRate'] * 100:.1f}%p|"
                f"{cohort['tail']['brierDelta']:.4f}|{cohort['tail']['candidate']['rocAuc']:.3f}|"
            )
    lines += ["", "### 시기별 통과율", ""]
    for name, value in fold_gate_result["passRates"].items():
        lines.append(f"- {name}: {value * 100:.1f}%")
    lines += ["", "## 경제군 완전 제외 전이", "", "|제외 경제군|제거 학습행|평가 자산|변동폭 MAE Δ|80% 구간 포함률|폭풍−잔잔 사건률|꼬리위험 Brier Δ|AUC|", "|---|---:|---|---:|---:|---:|---:|---:|"]
    for item in report["clusterTransfer"]:
        lines.append(
            f"|{item['cluster']}|{item['removedTrainingRows']:,}|{', '.join(item['evaluationAssets'])}|{item['range']['maeDelta']:.4f}|"
            f"{item['globalFallbackInterval']['coverage80'] * 100:.1f}%|{item['weather']['stormMinusQuietHighRangeEventRate'] * 100:.1f}%p|"
            f"{item['tail']['brierDelta']:.4f}|{item['tail']['candidate']['rocAuc']:.3f}|"
        )
    lines += ["", "### 경제군별 통과율", ""]
    for name, value in cluster_gate_result["passRates"].items():
        lines.append(f"- {name}: {value * 100:.1f}%")
    lines += ["", "## 연구 결정", ""]
    lines.extend(f"- {note}" for note in report["decisionNotes"])
    lines += ["", "2025년 이후 봉인 시험과 XLC·XLRE·TSLA·NVDA·ETH 전이 홀드아웃은 열지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    candidate_manifest = load_json(CALIBRATION_DIR / "manifest.json")
    split_manifest = load_json(modeling.BASELINE_DIR / "split-manifest.json")
    train, validation_seen, validation_holdout, data_audit = modeling.load_records()
    history, history_audit = calibration.load_history(split_manifest)
    validation = sorted(validation_seen + validation_holdout, key=lambda item: (item["asset"], item["date"]))

    if candidate_manifest["artifactSha256"] != EXPECTED_CANDIDATE_HASH:
        raise RuntimeError("Frozen candidate hash changed before robustness evaluation")

    print("[robustness] expanding walk-forward stability", flush=True)
    time_results = fold_stability(train, history)
    print("[robustness] leave-one-cluster-out transfer", flush=True)
    cluster_results = cluster_transfer(train, validation, history, split_manifest["policy"]["trainingClusters"])
    time_gate, transfer_gate = fold_gate(time_results), cluster_gate(cluster_results)

    verification = {
        "candidateHashMatchesFrozenSpec": candidate_manifest["artifactSha256"] == EXPECTED_CANDIDATE_HASH,
        "sealedTestLabelsUsed": 0,
        "assetHoldoutRowsUsedForForecastTraining": 0,
        "latestEvaluationDate": max(item["date"] for item in validation),
        "latestEvaluationPrecedesSealedTest": max(item["date"] for item in validation) < "2025-01-01",
        "everyTimeFoldTrainingPrecedesEvaluation": all(item["trainEnd"] < item["validationStart"] for item in time_results),
        "everyNonZeroClusterRemovedFromTraining": all(item["removedTrainingRows"] > 0 for item in cluster_results if not item["alreadyZeroShotCluster"]),
        "cryptoRecordedAsAlreadyZeroShot": any(item["cluster"] == "crypto" and item["alreadyZeroShotCluster"] for item in cluster_results),
        "directionModelAbsent": True,
        "appFormulaChanged": False,
    }
    technical_failures = [
        key for key in (
            "candidateHashMatchesFrozenSpec", "latestEvaluationPrecedesSealedTest", "everyTimeFoldTrainingPrecedesEvaluation",
            "everyNonZeroClusterRemovedFromTraining", "cryptoRecordedAsAlreadyZeroShot", "directionModelAbsent",
        ) if not verification[key]
    ]
    if technical_failures:
        raise RuntimeError(f"Robustness protocol failed: {technical_failures}")

    # These are deliberately demanding diagnostics, not tuning targets.
    time_core_pass = (
        time_gate["passRates"]["rangeMaeImproves"] >= 0.75
        and time_gate["passRates"]["weatherRangeEndpointPositive"] == 1.0
        and time_gate["passRates"]["weatherRiskEndpointPositive"] >= 0.75
        and time_gate["passRates"]["tailBrierImproves"] >= 0.75
    )
    transfer_core_pass = (
        transfer_gate["passRates"]["rangeMaeImproves"] >= 0.80
        and transfer_gate["passRates"]["intervalCoverageErrorAtMost10Points"] >= 0.80
        and transfer_gate["passRates"]["weatherRangeEndpointPositive"] == 1.0
        and transfer_gate["passRates"]["weatherRiskEndpointPositive"] >= 0.80
        and transfer_gate["passRates"]["tailBrierImproves"] >= 0.60
    )
    status = "pre-sealed-robustness-passed" if time_core_pass and transfer_core_pass else "research-revision-required"
    decision_notes = [
        f"시기 안정성 핵심 게이트: {time_core_pass}.",
        f"경제군 전이 핵심 게이트: {transfer_core_pass}.",
        f"봉인 시험 전 상태: `{status}`.",
        "bootstrap 유의성은 효과 방향의 보조 진단으로 기록했으며, 모든 작은 하위집단에서 유의할 것을 승격 조건으로 강제하지 않았습니다.",
        "실패 구간이나 경제군이 있으면 봉인 시험을 열기 전에 원인을 분석하되, 같은 검증 결과에 맞춘 무제한 재튜닝은 하지 않습니다.",
    ]
    artifact_payload = {
        "robustnessId": ROBUSTNESS_ID,
        "candidateArtifactSha256": candidate_manifest["artifactSha256"],
        "timeStability": time_results,
        "clusterTransfer": cluster_results,
        "gates": {"timeStability": time_gate, "clusterTransfer": transfer_gate},
        "status": status,
    }
    artifact_sha = artifact_hash(artifact_payload)
    report = {
        "schemaVersion": 1,
        "robustnessId": ROBUSTNESS_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "candidateArtifactSha256": candidate_manifest["artifactSha256"],
        "dataAudit": {**data_audit, **history_audit},
        **artifact_payload,
        "artifactSha256": artifact_sha,
        "verification": verification,
        "decisionNotes": decision_notes,
    }
    safe = json_safe(report)
    (OUTPUT_DIR / "robustness-results.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe), encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "robustnessId": ROBUSTNESS_ID,
        "generatedAt": report["generatedAt"],
        "candidateArtifactSha256": candidate_manifest["artifactSha256"],
        "artifactSha256": artifact_sha,
        "status": status,
        "sealedTestLabelsUsed": 0,
        "appFormulaChanged": False,
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] time-core={time_core_pass} transfer-core={transfer_core_pass}")
    print(f"[done] status={status}")
    print(f"[done] artifact sha256={artifact_sha}")
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
