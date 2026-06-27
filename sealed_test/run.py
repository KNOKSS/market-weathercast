from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "modeling"))
import run as modeling  # noqa: E402


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calibration = load_module("market_weather_calibration_sealed", ROOT / "scripts" / "calibration" / "run.py")
causal = load_module("market_weather_causal_interval_sealed", ROOT / "scripts" / "causal_interval" / "run.py")
PANEL_PATH = modeling.PANEL_PATH
SPLIT_PATH = modeling.BASELINE_DIR / "split-manifest.json"
CANDIDATE_DIR = ROOT / "research-results" / "market-weather-presealed-candidate-v2"
OUTPUT_DIR = ROOT / "research-results" / "market-weather-sealed-test-v2"
TEST_ID = "market-weather-sealed-test-v2"
EXPECTED_HASHES = {
    "sourceCalibrationFileSha256": (ROOT / "research-results" / "market-weather-calibration-v1" / "calibration-artifacts.json"),
    "sourceRobustnessFileSha256": (ROOT / "research-results" / "market-weather-robustness-v1" / "robustness-results.json"),
    "sourceCausalIntervalFileSha256": (ROOT / "research-results" / "market-weather-causal-interval-v2" / "causal-interval-results.json"),
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_all_records(split_manifest: dict):
    summaries = {item["assetId"]: item for item in split_manifest["assets"]}
    clusters = split_manifest["policy"]["trainingClusters"]
    asset_cluster = {asset: cluster for cluster, assets in clusters.items() for asset in assets}
    history, pretest_train, test = [], [], []
    with gzip.open(PANEL_PATH, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            summary = summaries[row["assetId"]]
            record = modeling.extract_record(row, "sealed-audit", asset_cluster[row["assetId"]])
            record.update({
                "role": summary["assetRole"],
                "last_validation_date": summary["lastValidationDate"],
                "first_test_date": summary["firstSealedTestDate"],
            })
            history.append(record)
            if summary["assetRole"] == "development" and record["date"] <= summary["lastValidationDate"]:
                pretest_train.append(record)
            if record["date"] >= summary["firstSealedTestDate"]:
                test.append(record)
    return (
        sorted(history, key=lambda item: (item["asset"], item["date"])),
        sorted(pretest_train, key=lambda item: (item["asset"], item["date"])),
        sorted(test, key=lambda item: (item["asset"], item["date"])),
    )


def extend_tape_for_test(tape: dict, history: list[dict], model):
    records = [item for item in history if item["date"] >= "2025-01-01"]
    predictions = model.predict(records)
    for item, prediction in zip(records, predictions):
        tape[(item["asset"], item["date"])] = float(prediction)
    return len(records)


def weather_from_causal_tape(history: list[dict], test_records: list[dict], tape: dict):
    test_keys = {(item["asset"], item["date"]) for item in test_records}
    by_asset = defaultdict(list)
    for item in history:
        by_asset[item["asset"]].append(item)
    output = []
    for asset, records in by_asset.items():
        prior_predictions, prior_ranges = deque(maxlen=252), deque(maxlen=252)
        for item in sorted(records, key=lambda row: row["date"]):
            key = (asset, item["date"])
            prediction = tape.get(key)
            if prediction is not None and key in test_keys and len(prior_predictions) == 252:
                prior_prediction_array = np.asarray(prior_predictions)
                prior_range_array = np.asarray(prior_ranges)
                output.append({
                    **item,
                    "range_prediction": float(prediction),
                    "prediction_percentile252": float(100 * np.mean(prior_prediction_array <= prediction)),
                    "actual_range_atr_ratio": item["range_y"] / max(item["atr_direct"], 0.01),
                    "actual_range_prior_median_ratio": item["range_y"] / max(float(np.median(prior_range_array)), 0.01),
                    "historical_high_range_event": int(item["range_y"] > float(np.quantile(prior_range_array, 0.90))),
                })
            if prediction is not None:
                prior_predictions.append(float(prediction))
                prior_ranges.append(item["range_y"])
    if len(output) != len(test_records):
        raise RuntimeError(f"Weather history missing for {len(test_records) - len(output)} sealed rows")
    return sorted(output, key=lambda item: (item["asset"], item["date"]))


def interval_metrics(records, bounds, scheme):
    selected_bounds = {scheme: bounds[scheme]}
    return causal.metrics(records, selected_bounds)[scheme]


def interval_asset_pass_rate(records, bounds, scheme):
    results = {}
    for asset in sorted({item["asset"] for item in records}):
        indices = np.asarray([i for i, item in enumerate(records) if item["asset"] == asset], dtype=int)
        metrics = causal.metrics(records, {scheme: bounds[scheme]}, indices)[scheme]
        results[asset] = metrics
    return float(np.mean([item["meanAbsoluteCoverageError"] <= 0.10 for item in results.values()])), results


def cohort_result(records, weather_records, range_model, tail_model, atr_scale, base_rate, recent_prior, interval_bounds):
    range_prediction = range_model.predict(records)
    range_baseline = modeling.target(records, "atr_direct") * atr_scale
    range_candidate_metrics = modeling.range_metrics(records, range_prediction)
    range_baseline_metrics = modeling.range_metrics(records, range_baseline)
    range_bootstrap = modeling.bootstrap_delta(records, range_prediction, range_baseline, "range_y", modeling.mae)

    selected_interval = interval_metrics(records, interval_bounds, "shrunk252")
    asset_interval_pass_rate, asset_intervals = interval_asset_pass_rate(records, interval_bounds, "shrunk252")

    weather_bins = calibration.asset_equal_bin_metrics(weather_records)
    weather_bootstrap = calibration.bootstrap_weather_delta(weather_records)
    weather_range_delta = weather_bins["storm"]["actualRangePriorMedianRatio"] - weather_bins["quiet"]["actualRangePriorMedianRatio"]
    weather_risk_delta = weather_bins["storm"]["highRangeEventRate"] - weather_bins["quiet"]["highRangeEventRate"]

    raw_tail = tail_model.predict(records)
    tail_prediction = calibration.adaptive_probability(records, raw_tail, recent_prior, base_rate, 1.0)
    tail_baseline = np.full(len(records), base_rate)
    tail_candidate_metrics = modeling.probability_metrics(records, tail_prediction, "tail_y")
    tail_baseline_metrics = modeling.probability_metrics(records, tail_baseline, "tail_y")
    tail_bootstrap = modeling.bootstrap_delta(records, tail_prediction, tail_baseline, "tail_y", modeling.brier)

    return {
        "rows": len(records),
        "assets": len({item["asset"] for item in records}),
        "range": {
            "candidate": range_candidate_metrics,
            "atrScaledBaseline": range_baseline_metrics,
            "maeDelta": range_candidate_metrics["mae"] - range_baseline_metrics["mae"],
            "bootstrapCandidateMinusBaselineMae": range_bootstrap,
        },
        "interval": {"metrics": selected_interval, "assetPassRate": asset_interval_pass_rate, "byAsset": asset_intervals},
        "weather": {
            "bins": weather_bins,
            "stormMinusQuietPriorMedianRatio": weather_range_delta,
            "stormMinusQuietHighRangeEventRate": weather_risk_delta,
            "bootstrap": weather_bootstrap,
        },
        "tail": {
            "candidate": tail_candidate_metrics,
            "trainBaseRate": tail_baseline_metrics,
            "brierDelta": tail_candidate_metrics["brier"] - tail_baseline_metrics["brier"],
            "bootstrapCandidateMinusBaseBrier": tail_bootstrap,
        },
    }


def yearly_diagnostics(records, weather, range_model, tail_model, atr_scale, base_rate, recent_prior, bounds):
    output = {}
    for year in sorted({item["date"][:4] for item in records}):
        indices = np.asarray([i for i, item in enumerate(records) if item["date"].startswith(year)], dtype=int)
        subset = [records[i] for i in indices]
        weather_subset = [item for item in weather if item["date"].startswith(year)]
        subset_bounds = {
            scheme: {coverage: [values[0][indices], values[1][indices]] for coverage, values in scheme_bounds.items()}
            for scheme, scheme_bounds in bounds.items()
        }
        output[year] = cohort_result(subset, weather_subset, range_model, tail_model, atr_scale, base_rate, recent_prior, subset_bounds)
    return output


def layer_decisions(cohorts):
    range_pass = all(
        item["range"]["maeDelta"] < 0 and item["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"][1] < 0
        for item in cohorts.values()
    )
    interval_pass = all(
        item["interval"]["metrics"]["meanAbsoluteCoverageError"] <= 0.05 and item["interval"]["assetPassRate"] >= 0.80
        for item in cohorts.values()
    )
    weather_pass = all(
        item["weather"]["stormMinusQuietPriorMedianRatio"] > 0 and item["weather"]["stormMinusQuietHighRangeEventRate"] > 0
        for item in cohorts.values()
    )
    tail_pass = all(
        item["tail"]["brierDelta"] < 0 and item["tail"]["candidate"]["rocAuc"] > 0.5
        for item in cohorts.values()
    )
    return {"range": range_pass, "interval": interval_pass, "weather": weather_pass, "tail": tail_pass, "overall": range_pass and interval_pass and weather_pass and tail_pass}


def markdown_report(report):
    lines = [
        "# 2025+ 봉인 시험 결과 v2", "", "## 시험 무결성", "",
        f"- 후보: `{report['candidateId']}`", f"- 시험 실행 횟수: {report['testRunNumber']}",
        f"- 시험 행: {report['dataAudit']['sealedTestRows']:,}", "- 결과 확인 후 재튜닝: 없음", "- 앱 공식 변경: 없음", "",
        "## 핵심 결과", "", "|집단|변동폭 MAE Δ|MAE 95% CI|50% 포함률|80% 포함률|폭풍−잔잔 사건률|꼬리위험 Brier Δ|꼬리위험 AUC|", "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for cohort, item in report["cohorts"].items():
        range_ci = item["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"]
        lines.append(
            f"|{cohort}|{item['range']['maeDelta']:.4f}|[{range_ci[0]:.4f}, {range_ci[1]:.4f}]|"
            f"{item['interval']['metrics']['coverage50'] * 100:.1f}%|{item['interval']['metrics']['coverage80'] * 100:.1f}%|"
            f"{item['weather']['stormMinusQuietHighRangeEventRate'] * 100:.1f}%p|{item['tail']['brierDelta']:.4f}|{item['tail']['candidate']['rocAuc']:.3f}|"
        )
    lines += ["", "## 계층 판정", ""]
    for layer, passed in report["layerDecisions"].items():
        lines.append(f"- {layer}: {'통과' if passed else '탈락'}")
    lines += ["", "## 해석", ""] + [f"- {note}" for note in report["decisionNotes"]]
    lines += ["", "XLC·XLRE·TSLA·NVDA·ETH 최종 전이 홀드아웃은 아직 열지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    if (OUTPUT_DIR / "manifest.json").exists():
        raise RuntimeError("Sealed test output already exists; one-shot rerun is forbidden")
    candidate_manifest = load_json(CANDIDATE_DIR / "manifest.json")
    for key, path in EXPECTED_HASHES.items():
        actual = file_hash(path)
        if actual != candidate_manifest[key]:
            raise RuntimeError(f"Frozen source hash mismatch for {key}: {actual}")
    split_manifest = load_json(SPLIT_PATH)

    # The sealed labels are opened for the first and only time below.
    history, pretest_train, test = load_all_records(split_manifest)
    seen_test = [item for item in test if item["role"] == "development"]
    holdout_test = [item for item in test if item["role"] == "asset-holdout"]
    print(f"[sealed] opened rows={len(test):,} seen={len(seen_test):,} holdout={len(holdout_test):,}", flush=True)

    range_model = modeling.fit_ridge(pretest_train, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
    tail_model = modeling.fit_logistic(pretest_train, calibration.TAIL_FEATURES, calibration.TAIL_LAMBDA, "tail_y")
    atr_scale = modeling.fit_atr_scale(pretest_train)
    base_rate = modeling.weighted_base_rate(pretest_train, "tail_y")

    original_train, _, _, original_audit = modeling.load_records()
    tape, tape_audit = causal.build_causal_prediction_tape(original_train, history)
    extended_rows = extend_tape_for_test(tape, history, range_model)
    global_q, cluster_q, calibration_rows = causal.calibration_quantiles(history, tape, "2025-01-01")
    bounds = causal.causal_bounds(history, test, tape, global_q, cluster_q)
    weather = weather_from_causal_tape(history, test, tape)
    recent_prior = calibration.build_recent_prior(history, base_rate)

    cohort_records = {"seen-assets": seen_test, "asset-holdout": holdout_test}
    cohort_weather = {name: [item for item in weather if item["role"] == ("development" if name == "seen-assets" else "asset-holdout")] for name in cohort_records}
    cohort_bounds = {}
    test_index = {(item["asset"], item["date"]): index for index, item in enumerate(test)}
    for name, records in cohort_records.items():
        indices = np.asarray([test_index[(item["asset"], item["date"])] for item in records], dtype=int)
        cohort_bounds[name] = {
            scheme: {coverage: [values[0][indices], values[1][indices]] for coverage, values in scheme_bounds.items()}
            for scheme, scheme_bounds in bounds.items()
        }
    cohorts = {
        name: cohort_result(records, cohort_weather[name], range_model, tail_model, atr_scale, base_rate, recent_prior, cohort_bounds[name])
        for name, records in cohort_records.items()
    }
    yearly = {
        name: yearly_diagnostics(records, cohort_weather[name], range_model, tail_model, atr_scale, base_rate, recent_prior, cohort_bounds[name])
        for name, records in cohort_records.items()
    }
    decisions = layer_decisions(cohorts)
    decision_notes = [
        f"변동폭 계층: {'봉인 시험 통과' if decisions['range'] else '봉인 시험 탈락'}.",
        f"예측구간 계층: {'봉인 시험 통과' if decisions['interval'] else '봉인 시험 탈락'}.",
        f"날씨 등급 계층: {'봉인 시험 통과' if decisions['weather'] else '봉인 시험 탈락'}.",
        f"꼬리위험 계층: {'봉인 시험 통과' if decisions['tail'] else '봉인 시험 탈락'}.",
        "이 결과를 이용해 동일 2025+ 시험에 재튜닝하지 않습니다.",
    ]
    report = {
        "schemaVersion": 2,
        "sealedTestId": TEST_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "candidateId": candidate_manifest["candidateId"],
        "candidateManifest": candidate_manifest,
        "testRunNumber": 1,
        "dataAudit": {
            "pretestTrainingRows": len(pretest_train),
            "sealedTestRows": len(test),
            "sealedSeenRows": len(seen_test),
            "sealedAssetHoldoutRows": len(holdout_test),
            "firstTestDate": min(item["date"] for item in test),
            "lastTestDate": max(item["date"] for item in test),
            "transferHoldoutsPresent": False,
            "originalModelAuditBeforeOpening": original_audit,
        },
        "protocol": {"refitThrough": "2024 validation end", "intervalScheme": "shrunk252", "calibrationRows": calibration_rows, "causalTapeExtendedRows": extended_rows, "bootstrapSamples": modeling.BOOTSTRAP_SAMPLES, "blockLength": modeling.BLOCK_LENGTH},
        "causalTapeAudit": tape_audit,
        "cohorts": cohorts,
        "yearlyDiagnostics": yearly,
        "layerDecisions": decisions,
        "verification": {"sourceHashesMatchedBeforeOpening": True, "singleRun": True, "sealedLabelsOpened": True, "transferHoldoutsOpened": False, "directionModelAbsent": True, "appFormulaChanged": False},
        "decisionNotes": decision_notes,
    }
    safe = calibration.json_safe(report)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=False)
    (OUTPUT_DIR / "sealed-test-results.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe), encoding="utf-8")
    results_hash = file_hash(OUTPUT_DIR / "sealed-test-results.json")
    manifest = {"schemaVersion": 2, "sealedTestId": TEST_ID, "generatedAt": report["generatedAt"], "candidateId": candidate_manifest["candidateId"], "testRunNumber": 1, "resultsSha256": results_hash, "layerDecisions": decisions, "transferHoldoutsOpened": False, "appFormulaChanged": False}
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] decisions={decisions}", flush=True)
    print(f"[done] results sha256={results_hash}", flush=True)
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT).as_posix()}", flush=True)


if __name__ == "__main__":
    main()
