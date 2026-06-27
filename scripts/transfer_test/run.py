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


calibration = load_module("market_weather_calibration_transfer", ROOT / "scripts" / "calibration" / "run.py")
causal = load_module("market_weather_causal_transfer", ROOT / "scripts" / "causal_interval" / "run.py")
sealed = load_module("market_weather_sealed_helpers_transfer", ROOT / "scripts" / "sealed_test" / "run.py")
TRANSFER_PANEL_DIR = ROOT / "research-results" / "market-weather-transfer-panel-v1"
TRANSFER_PANEL_PATH = TRANSFER_PANEL_DIR / "panel.jsonl.gz"
CANDIDATE_DIR = ROOT / "research-results" / "market-weather-presealed-candidate-v2"
OUTPUT_DIR = ROOT / "research-results" / "market-weather-transfer-test-v2"
TEST_ID = "market-weather-transfer-test-v2"
CLUSTERS = {
    "XLC": "technology-communications",
    "XLRE": "defensive-real-assets",
    "TSLA": "individual-high-volatility",
    "NVDA": "individual-high-volatility",
    "ETHUSDT": "crypto",
}
GROUPS = {
    "sector-etf": {"XLC", "XLRE"},
    "high-volatility-stocks": {"TSLA", "NVDA"},
    "crypto": {"ETHUSDT"},
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def file_hash(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_pretest_training(split_manifest):
    summaries = {item["assetId"]: item for item in split_manifest["assets"]}
    clusters = split_manifest["policy"]["trainingClusters"]
    asset_cluster = {asset: cluster for cluster, assets in clusters.items() for asset in assets}
    output = []
    with gzip.open(modeling.PANEL_PATH, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            summary = summaries[row["assetId"]]
            if summary["assetRole"] != "development" or row["date"] > summary["lastValidationDate"]:
                continue
            record = modeling.extract_record(row, "transfer-pretest-train", asset_cluster[row["assetId"]])
            record["role"] = "development"
            output.append(record)
    return sorted(output, key=lambda item: (item["asset"], item["date"]))


def load_transfer_records(us_test_start: str, crypto_test_start: str):
    history, test = [], []
    with gzip.open(TRANSFER_PANEL_PATH, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            record = modeling.extract_record(row, "locked-transfer", CLUSTERS[row["assetId"]])
            record["role"] = "locked-transfer-holdout"
            history.append(record)
            start = crypto_test_start if row["assetId"] == "ETHUSDT" else us_test_start
            if row["date"] >= start:
                test.append(record)
    return (
        sorted(history, key=lambda item: (item["asset"], item["date"])),
        sorted(test, key=lambda item: (item["asset"], item["date"])),
    )


def extend_transfer_tape(tape, history, model):
    records = [item for item in history if item["date"] >= "2025-01-01"]
    predictions = model.predict(records)
    for item, prediction in zip(records, predictions):
        tape[(item["asset"], item["date"])] = float(prediction)
    return len(records)


def weather_from_tape(history, test, tape):
    keys = {(item["asset"], item["date"]) for item in test}
    by_asset = defaultdict(list)
    for item in history:
        by_asset[item["asset"]].append(item)
    output = []
    for asset, records in by_asset.items():
        prior_predictions, prior_ranges = deque(maxlen=252), deque(maxlen=252)
        for item in sorted(records, key=lambda row: row["date"]):
            key = (asset, item["date"])
            prediction = tape.get(key)
            if prediction is not None and key in keys and len(prior_predictions) == 252:
                prior_prediction_array, prior_range_array = np.asarray(prior_predictions), np.asarray(prior_ranges)
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
    if len(output) != len(test):
        raise RuntimeError(f"Missing transfer weather records: {len(test) - len(output)}")
    return sorted(output, key=lambda item: (item["asset"], item["date"]))


def subset_bounds(all_records, subset, bounds):
    index = {(item["asset"], item["date"]): i for i, item in enumerate(all_records)}
    indices = np.asarray([index[(item["asset"], item["date"])] for item in subset], dtype=int)
    return {
        scheme: {coverage: [values[0][indices], values[1][indices]] for coverage, values in scheme_bounds.items()}
        for scheme, scheme_bounds in bounds.items()
    }


def asset_improvement_counts(by_asset):
    return {
        "range": sum(item["range"]["maeDelta"] < 0 for item in by_asset.values()),
        "tail": sum(item["tail"]["brierDelta"] < 0 for item in by_asset.values()),
        "assets": len(by_asset),
    }


def decisions(overall, groups, by_asset):
    counts = asset_improvement_counts(by_asset)
    range_pass = overall["range"]["maeDelta"] < 0 and overall["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"][1] < 0 and counts["range"] >= 3
    interval_pass = overall["interval"]["metrics"]["meanAbsoluteCoverageError"] <= 0.05 and overall["interval"]["assetPassRate"] >= 0.80
    weather_pass = all(item["weather"]["stormMinusQuietPriorMedianRatio"] > 0 and item["weather"]["stormMinusQuietHighRangeEventRate"] > 0 for item in [overall, *groups.values()])
    tail_pass = overall["tail"]["brierDelta"] < 0 and overall["tail"]["candidate"]["rocAuc"] > 0.5 and counts["tail"] >= 3
    return {"range": range_pass, "interval": interval_pass, "weather": weather_pass, "tail": tail_pass, "overall": range_pass and interval_pass and weather_pass and tail_pass, "assetImprovementCounts": counts}


def markdown_report(report):
    lines = [
        "# 최종 자산 전이 시험 v2", "", "## 시험 범위", "",
        f"- 패널 해시: `{report['transferPanelSha256']}`", f"- 2025+ 시험 행: {report['dataAudit']['testRows']:,}",
        "- 후보 재튜닝: 없음", "- 앱 공식 변경: 없음", "", "## 전체 결과", "",
        "|변동폭 MAE Δ|MAE 95% CI|50% 포함률|80% 포함률|폭풍−잔잔 사건률|꼬리 Brier Δ|꼬리 AUC|", "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    item = report["overall"]
    ci = item["range"]["bootstrapCandidateMinusBaselineMae"]["ci95"]
    lines.append(f"|{item['range']['maeDelta']:.4f}|[{ci[0]:.4f}, {ci[1]:.4f}]|{item['interval']['metrics']['coverage50'] * 100:.1f}%|{item['interval']['metrics']['coverage80'] * 100:.1f}%|{item['weather']['stormMinusQuietHighRangeEventRate'] * 100:.1f}%p|{item['tail']['brierDelta']:.4f}|{item['tail']['candidate']['rocAuc']:.3f}|")
    lines += ["", "## 자산별", "", "|자산|변동폭 MAE Δ|50% 포함률|80% 포함률|폭풍−잔잔 사건률|꼬리 Brier Δ|꼬리 AUC|", "|---|---:|---:|---:|---:|---:|---:|"]
    for asset, result in report["byAsset"].items():
        lines.append(f"|{asset}|{result['range']['maeDelta']:.4f}|{result['interval']['metrics']['coverage50'] * 100:.1f}%|{result['interval']['metrics']['coverage80'] * 100:.1f}%|{result['weather']['stormMinusQuietHighRangeEventRate'] * 100:.1f}%p|{result['tail']['brierDelta']:.4f}|{result['tail']['candidate']['rocAuc']:.3f}|")
    lines += ["", "## 계층 판정", ""]
    for layer, value in report["layerDecisions"].items():
        if isinstance(value, bool):
            lines.append(f"- {layer}: {'통과' if value else '탈락'}")
    lines += ["", "## 해석", ""] + [f"- {note}" for note in report["decisionNotes"]]
    lines += ["", "동일 전이 시험에 맞춘 재튜닝은 금지됩니다.", ""]
    return "\n".join(lines)


def main():
    if (OUTPUT_DIR / "manifest.json").exists():
        raise RuntimeError("Transfer test already exists; rerun is forbidden")
    panel_report = load_json(TRANSFER_PANEL_DIR / "build-report.json")
    candidate_manifest = load_json(CANDIDATE_DIR / "manifest.json")
    split_manifest = load_json(modeling.BASELINE_DIR / "split-manifest.json")
    summary = {item["assetId"]: item for item in split_manifest["assets"]}
    us_start, crypto_start = summary["SPY"]["firstSealedTestDate"], summary["BTCUSDT"]["firstSealedTestDate"]
    pretest_train = load_pretest_training(split_manifest)
    transfer_history, test = load_transfer_records(us_start, crypto_start)
    print(f"[transfer] opened test rows={len(test):,}", flush=True)

    range_model = modeling.fit_ridge(pretest_train, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
    tail_model = modeling.fit_logistic(pretest_train, calibration.TAIL_FEATURES, calibration.TAIL_LAMBDA, "tail_y")
    atr_scale, base_rate = modeling.fit_atr_scale(pretest_train), modeling.weighted_base_rate(pretest_train, "tail_y")

    original_train, _, _, _ = modeling.load_records()
    development_history, _ = calibration.load_history(split_manifest)
    development_tape, development_tape_audit = causal.build_causal_prediction_tape(original_train, development_history)
    global_q, cluster_q, calibration_rows = causal.calibration_quantiles(development_history, development_tape, "2025-01-01")

    transfer_tape, transfer_tape_audit = causal.build_causal_prediction_tape(original_train, transfer_history)
    extended_rows = extend_transfer_tape(transfer_tape, transfer_history, range_model)
    bounds = causal.causal_bounds(transfer_history, test, transfer_tape, global_q, cluster_q)
    weather = weather_from_tape(transfer_history, test, transfer_tape)
    recent_prior = calibration.build_recent_prior(transfer_history, base_rate)

    def evaluate(records):
        keys = {(item["asset"], item["date"]) for item in records}
        weather_records = [item for item in weather if (item["asset"], item["date"]) in keys]
        return sealed.cohort_result(records, weather_records, range_model, tail_model, atr_scale, base_rate, recent_prior, subset_bounds(test, records, bounds))

    overall = evaluate(test)
    groups = {name: evaluate([item for item in test if item["asset"] in assets]) for name, assets in GROUPS.items()}
    by_asset = {asset: evaluate([item for item in test if item["asset"] == asset]) for asset in sorted(CLUSTERS)}
    layer_decisions = decisions(overall, groups, by_asset)
    notes = [
        f"변동폭: {'통과' if layer_decisions['range'] else '탈락'} · 개선 자산 {layer_decisions['assetImprovementCounts']['range']}/5.",
        f"예측구간: {'통과' if layer_decisions['interval'] else '탈락'} · 자산 통과율 {overall['interval']['assetPassRate'] * 100:.1f}%.",
        f"날씨 등급: {'통과' if layer_decisions['weather'] else '탈락'}.",
        f"꼬리위험: {'통과' if layer_decisions['tail'] else '탈락'} · 개선 자산 {layer_decisions['assetImprovementCounts']['tail']}/5.",
        "이 결과로 동일 자산·기간에 재튜닝하지 않습니다.",
    ]
    report = {
        "schemaVersion": 2,
        "transferTestId": TEST_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "candidateId": candidate_manifest["candidateId"],
        "transferPanelSha256": panel_report["output"]["sha256"],
        "dataAudit": {"pretestTrainingRows": len(pretest_train), "transferHistoryRows": len(transfer_history), "testRows": len(test), "firstTestDate": min(item["date"] for item in test), "lastTestDate": max(item["date"] for item in test), "assets": sorted(CLUSTERS)},
        "protocol": {"usTestStart": us_start, "cryptoTestStart": crypto_start, "intervalScheme": "shrunk252", "calibrationRows": calibration_rows, "transferTapeExtendedRows": extended_rows},
        "developmentTapeAudit": development_tape_audit,
        "transferTapeAudit": transfer_tape_audit,
        "overall": overall,
        "groups": groups,
        "byAsset": by_asset,
        "layerDecisions": layer_decisions,
        "verification": {"singleRun": True, "candidateFormulaChanged": False, "developmentTrainingContainsTransferAssets": False, "allTransferPredictionTapesCausal": all(item["causal"] for item in transfer_tape_audit), "appFormulaChanged": False},
        "decisionNotes": notes,
    }
    safe = calibration.json_safe(report)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=False)
    (OUTPUT_DIR / "transfer-test-results.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe), encoding="utf-8")
    result_hash = file_hash(OUTPUT_DIR / "transfer-test-results.json")
    manifest = {"schemaVersion": 2, "transferTestId": TEST_ID, "generatedAt": report["generatedAt"], "candidateId": candidate_manifest["candidateId"], "resultsSha256": result_hash, "layerDecisions": layer_decisions, "appFormulaChanged": False}
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] decisions={layer_decisions}", flush=True)
    print(f"[done] results sha256={result_hash}", flush=True)


if __name__ == "__main__":
    main()
