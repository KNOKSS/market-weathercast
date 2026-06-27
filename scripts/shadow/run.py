from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
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


calibration = load_module("market_weather_shadow_calibration", ROOT / "scripts" / "calibration" / "run.py")
causal = load_module("market_weather_shadow_causal", ROOT / "scripts" / "causal_interval" / "run.py")

SHADOW_DIR = ROOT / "research-results" / "market-weather-shadow-v1"
MODEL_PATH = SHADOW_DIR / "frozen-model.json"
FORECAST_LEDGER = SHADOW_DIR / "forecast-ledger.jsonl"
SETTLEMENT_LEDGER = SHADOW_DIR / "settlement-ledger.jsonl"
BENCHMARK_LEDGER = SHADOW_DIR / "benchmark-ledger.jsonl"
EVALUATION_POLICY = SHADOW_DIR / "evaluation-policy.json"
PUBLIC_FORECAST = ROOT / "public" / "data" / "tomorrow-forecast.json"
MAIN_PANEL = ROOT / "research-results" / "market-weather-eod-panel-v1" / "panel.jsonl.gz"
TRANSFER_PANEL = ROOT / "research-results" / "market-weather-transfer-panel-v1" / "panel.jsonl.gz"
SPLIT_PATH = ROOT / "research-results" / "market-weather-baseline-evaluation-v1" / "split-manifest.json"
CANDIDATE_MANIFEST = ROOT / "research-results" / "market-weather-presealed-candidate-v2" / "manifest.json"
RECENT_LOOKBACK = 252
SHRINKAGE = 100
TRANSFER_CLUSTERS = {
    "XLC": "technology-communications",
    "XLRE": "defensive-real-assets",
    "TSLA": "individual-high-volatility",
    "NVDA": "individual-high-volatility",
    "ETHUSDT": "crypto",
}


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def hash_value(value) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def cluster_maps(split: dict):
    mapping = {asset: cluster for cluster, assets in split["policy"]["trainingClusters"].items() for asset in assets}
    return {**mapping, **TRANSFER_CLUSTERS}


def load_main_history(split: dict):
    summaries = {item["assetId"]: item for item in split["assets"]}
    clusters = cluster_maps(split)
    history, training = [], []
    with gzip.open(MAIN_PANEL, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            summary = summaries[row["assetId"]]
            record = modeling.extract_record(row, "shadow-history", clusters[row["assetId"]])
            record["role"] = summary["assetRole"]
            history.append(record)
            if summary["assetRole"] == "development" and row["date"] <= summary["lastValidationDate"]:
                training.append(record)
    return sorted(history, key=lambda x: (x["asset"], x["date"])), sorted(training, key=lambda x: (x["asset"], x["date"]))


def serialize_model(model):
    return {
        "task": model.task,
        "features": model.features,
        "regularization": model.regularization,
        "mean": model.standardizer.mean.tolist(),
        "scale": model.standardizer.scale.tolist(),
        "coefficients": model.coefficients.tolist(),
    }


def deserialize_model(value):
    return modeling.LinearModel(
        value["features"],
        modeling.Standardizer(np.asarray(value["mean"]), np.asarray(value["scale"])),
        np.asarray(value["coefficients"]),
        value["regularization"],
        value["task"],
    )


def freeze_model(force: bool):
    if MODEL_PATH.exists() and not force:
        print(f"[shadow:freeze] already frozen: {MODEL_PATH.relative_to(ROOT).as_posix()}")
        return
    if force and (FORECAST_LEDGER.exists() or SETTLEMENT_LEDGER.exists()):
        raise RuntimeError("Cannot replace the frozen model after an official ledger exists")
    split = load_json(SPLIT_PATH)
    history, training = load_main_history(split)
    range_model = modeling.fit_ridge(training, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
    tail_model = modeling.fit_logistic(training, calibration.TAIL_FEATURES, calibration.TAIL_LAMBDA, "tail_y")
    base_rate = modeling.weighted_base_rate(training, "tail_y")
    original_train, _, _, _ = modeling.load_records()
    tape, tape_audit = causal.build_causal_prediction_tape(original_train, history)
    global_q, _, calibration_rows = causal.calibration_quantiles(history, tape, "2025-01-01")
    body = {
        "schemaVersion": 1,
        "modelId": "market-weather-shadow-frozen-v1",
        "frozenAt": datetime.now(timezone.utc).isoformat(),
        "candidateId": load_json(CANDIDATE_MANIFEST)["candidateId"],
        "trainingPolicy": "development assets only, labels through each asset's frozen 2024 validation end",
        "trainingRows": len(training),
        "trainingLastDate": max(item["date"] for item in training),
        "rangeModel": serialize_model(range_model),
        "tailModel": serialize_model(tail_model),
        "tailBaseRate": base_rate,
        "interval": {
            "scheme": "shrunk252",
            "lookback": RECENT_LOOKBACK,
            "shrinkageStrength": SHRINKAGE,
            "minimumHistory": 60,
            "globalCausalOofQuantiles": {key: global_q[key] for key in ("q10", "q25", "q75", "q90")},
            "calibrationRows": calibration_rows,
        },
        "weather": {"lookback": 252, "bins": [0, 25, 75, 90, 100]},
        "tail": {"status": "experimental-internal", "recentPriorLookback": 252, "priorStrength": 100, "logOddsAdjustment": 1.0},
        "directionForecast": None,
        "sourceHashes": {
            "candidateManifest": file_hash(CANDIDATE_MANIFEST),
            "mainPanel": file_hash(MAIN_PANEL),
            "splitManifest": file_hash(SPLIT_PATH),
        },
        "causalTapeAudit": tape_audit,
        "appFormulaChanged": False,
    }
    artifact = {**body, "artifactSha256": hash_value(body)}
    SHADOW_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[shadow:freeze] rows={len(training):,} global-oof={calibration_rows:,}")
    print(f"[shadow:freeze] artifact={artifact['artifactSha256']}")


def inference_record(row: dict, cluster: str):
    synthetic = {**row, "labels": {"nextDayTrueRange": 0, "historicalTailEvent1": 0, "up1": 0}}
    return modeling.extract_record(synthetic, "shadow-inference", cluster)


def quantiles(values: list[float]):
    array = np.asarray(values)
    return {f"q{int(level * 100):02d}": float(np.quantile(array, level)) for level in (0.10, 0.25, 0.75, 0.90)}


def blend(global_q: dict, asset_q: dict, n: int):
    weight = n / (n + SHRINKAGE)
    return {key: weight * asset_q[key] + (1 - weight) * global_q[key] for key in ("q10", "q25", "q75", "q90")}


def logit(p: float):
    p = min(max(p, 1e-8), 1 - 1e-8)
    return math.log(p / (1 - p))


def sigmoid(x: float):
    return 1 / (1 + math.exp(-x))


def weather_grade(percentile: float):
    if percentile < 25:
        return "quiet", "고요"
    if percentile < 75:
        return "normal", "보통"
    if percentile < 90:
        return "strong", "강풍"
    return "storm", "폭풍"


def verify_ledger(path: Path):
    rows, previous = [], "GENESIS"
    if not path.exists():
        return rows, previous
    with path.open("r", encoding="utf-8") as handle:
        for number, line in enumerate(handle, 1):
            row = json.loads(line)
            row_hash = row.pop("recordHash")
            if row.get("previousHash") != previous or hash_value(row) != row_hash:
                raise RuntimeError(f"{path.name}: hash-chain failure at line {number}")
            row["recordHash"] = row_hash
            rows.append(row)
            previous = row_hash
    return rows, previous


def append_chain(path: Path, bodies: list[dict]):
    existing, previous = verify_ledger(path)
    with path.open("a", encoding="utf-8") as handle:
        for body in bodies:
            record = {**body, "previousHash": previous}
            record_hash = hash_value(record)
            handle.write(canonical({**record, "recordHash": record_hash}) + "\n")
            previous = record_hash
    return len(existing), previous


def load_snapshot(dry_run: bool):
    path = SHADOW_DIR / ("dry-run-snapshot.json" if dry_run else "pending-snapshot.json")
    checksum_path = SHADOW_DIR / ("dry-run-snapshot.sha256" if dry_run else "pending-snapshot.sha256")
    if not checksum_path.exists() or checksum_path.read_text(encoding="utf-8").strip() != file_hash(path):
        raise RuntimeError("Snapshot file checksum mismatch")
    snapshot = load_json(path)
    expected_mode = "dry-run" if dry_run else "pending-official"
    if snapshot["mode"] != expected_mode:
        raise RuntimeError(f"Snapshot mode mismatch: expected {expected_mode}")
    return path, snapshot


def validate_snapshot_contract(snapshot: dict, official: bool):
    sources = {item["assetId"]: item for item in snapshot["sourceManifest"]}
    latest = {row["assetId"]: row for row in snapshot["inferenceRows"]}
    if len(latest) != len(snapshot["inferenceRows"]):
        raise RuntimeError("Snapshot contains duplicate inference assets")
    for row in snapshot["inferenceRows"]:
        if "labels" in row:
            raise RuntimeError(f"{row['assetId']}: inference row must not contain labels")
        if sources[row["assetId"]]["lastClosedDate"] != row["date"]:
            raise RuntimeError(f"{row['assetId']}: inference date differs from source close")
        if any(value is not None and value > row["date"] for value in row["contextAsOf"].values()):
            raise RuntimeError(f"{row['assetId']}: context date is after forecast cutoff")
        btc_prior = row["contextAsOf"].get("BTCUSDT_PRIOR")
        if row["forecastPolicy"] == "US_CLOSE" and (btc_prior is None or btc_prior >= row["date"]):
            raise RuntimeError(f"{row['assetId']}: same-day UTC crypto context is not legal at US close")
    for row in snapshot["recentResolvedRows"]:
        if row["date"] >= latest[row["assetId"]]["date"]:
            raise RuntimeError(f"{row['assetId']}: resolved history overlaps inference date")
    if not official:
        return
    generated = datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00")).astimezone(timezone.utc)
    yesterday = (generated.date() - timedelta(days=1)).isoformat()
    us_dates = {row["date"] for row in snapshot["inferenceRows"] if row["forecastPolicy"] == "US_CLOSE"}
    if len(us_dates) != 1:
        raise RuntimeError(f"Official snapshot requires one synchronized US close date, got {sorted(us_dates)}")
    us_date = next(iter(us_dates))
    if (generated.date() - datetime.fromisoformat(us_date).date()).days > 4:
        raise RuntimeError(f"US source is stale for official forecast: {us_date}")
    if us_date == generated.date().isoformat() and generated.hour < 22:
        raise RuntimeError("Same-UTC-day US candle is not accepted before 22:00 UTC")
    crypto_dates = {row["date"] for row in snapshot["inferenceRows"] if row["forecastPolicy"] == "UTC_DAILY_CLOSE"}
    if crypto_dates != {yesterday}:
        raise RuntimeError(f"Official crypto snapshot must end on the last fully closed UTC day {yesterday}, got {sorted(crypto_dates)}")


def build_forecasts(snapshot: dict, artifact: dict):
    split = load_json(SPLIT_PATH)
    clusters = cluster_maps(split)
    range_model, tail_model = deserialize_model(artifact["rangeModel"]), deserialize_model(artifact["tailModel"])
    base_rate = artifact["tailBaseRate"]
    history = defaultdict(list)
    for row in snapshot["recentResolvedRows"]:
        history[row["assetId"]].append(modeling.extract_record(row, "shadow-resolved", clusters[row["assetId"]]))
    output = []
    created_at = datetime.now(timezone.utc).isoformat()
    for row in snapshot["inferenceRows"]:
        asset, as_of = row["assetId"], row["date"]
        record = inference_record(row, clusters[asset])
        prediction = float(range_model.predict([record])[0])
        prior = sorted([item for item in history[asset] if item["date"] < as_of], key=lambda x: x["date"])[-RECENT_LOOKBACK:]
        if len(prior) < 60:
            raise RuntimeError(f"{asset}: only {len(prior)} causal residuals")
        prior_predictions = range_model.predict(prior)
        ratios = [item["range_y"] / max(float(pred), .01) for item, pred in zip(prior, prior_predictions)]
        q = blend(artifact["interval"]["globalCausalOofQuantiles"], quantiles(ratios), len(ratios))
        percentile = 100 * float(np.mean(prior_predictions <= prediction))
        grade_id, grade_label = weather_grade(percentile)
        raw_tail = float(tail_model.predict([record])[0])
        recent_tail = [item["tail_y"] for item in prior]
        adaptive_prior = (sum(recent_tail) + 100 * base_rate) / (len(recent_tail) + 100)
        tail_probability = sigmoid(logit(raw_tail) + logit(adaptive_prior) - logit(base_rate))
        source = next(item for item in snapshot["sourceManifest"] if item["assetId"] == asset)
        body = {
            "schemaVersion": 1,
            "recordType": "forecast",
            "forecastId": f"{artifact['modelId']}:{asset}:{as_of}",
            "createdAt": created_at,
            "assetId": asset,
            "asOfDate": as_of,
            "forecastPolicy": row["forecastPolicy"],
            "modelArtifactSha256": artifact["artifactSha256"],
            "snapshotPayloadSha256": snapshot["payloadSha256"],
            "sourceCandlesSha256": source["candlesSha256"],
            "sourceFetchedAt": source["fetchedAt"],
            "contextAsOf": row["contextAsOf"],
            "forecast": {
                "nextDayTrueRangePercent": prediction,
                "interval50": [prediction * q["q25"], prediction * q["q75"]],
                "interval80": [prediction * q["q10"], prediction * q["q90"]],
                "weatherPercentile252": percentile,
                "weatherGrade": grade_id,
                "weatherLabel": grade_label,
                "tailRiskProbabilityExperimental": tail_probability,
                "direction": None,
            },
            "calibrationHistory": {"observations": len(prior), "lastResolvedDate": prior[-1]["date"]},
        }
        output.append(body)
    return output


def ensure_evaluation_policy():
    if EVALUATION_POLICY.exists():
        policy = load_json(EVALUATION_POLICY)
        if hash_value({key: value for key, value in policy.items() if key != "policySha256"}) != policy["policySha256"]:
            raise RuntimeError("Evaluation policy hash mismatch")
        return policy
    settlements, _ = verify_ledger(SETTLEMENT_LEDGER)
    if settlements:
        raise RuntimeError("Evaluation policy cannot be created after outcomes are settled")
    split = load_json(SPLIT_PATH)
    _, training = load_main_history(split)
    body = {
        "schemaVersion": 1,
        "policyId": "market-weather-shadow-evaluation-v1",
        "registeredAt": datetime.now(timezone.utc).isoformat(),
        "registeredBeforeAnySettlement": True,
        "primaryTarget": "next-day true range percent",
        "primaryBaseline": "training-fitted ATR14 scale",
        "atrScale": modeling.fit_atr_scale(training),
        "secondaryBaseline": "last observed next-day true range",
        "intervalTargets": {"50": 0.50, "80": 0.80},
        "weatherEvent": "actual true range above the asset's prior 252-observation 90th percentile",
        "tailMetric": "Brier score; experimental and not promotion-eligible",
        "checkpointsTradingDays": [60, 120],
        "noTuningBeforeCheckpoint": True,
    }
    policy = {**body, "policySha256": hash_value(body)}
    EVALUATION_POLICY.write_text(json.dumps(policy, ensure_ascii=False, indent=2), encoding="utf-8")
    return policy


def register_benchmarks():
    policy = ensure_evaluation_policy()
    _, snapshot = load_snapshot(False)
    validate_snapshot_contract(snapshot, official=True)
    forecasts, _ = verify_ledger(FORECAST_LEDGER)
    existing, _ = verify_ledger(BENCHMARK_LEDGER)
    existing_ids = {item["forecastId"] for item in existing}
    split = load_json(SPLIT_PATH)
    clusters = cluster_maps(split)
    inference = {row["assetId"]: row for row in snapshot["inferenceRows"]}
    history = defaultdict(list)
    for row in snapshot["recentResolvedRows"]:
        history[row["assetId"]].append(modeling.extract_record(row, "benchmark-history", clusters[row["assetId"]]))
    bodies = []
    for forecast_row in forecasts:
        if forecast_row["forecastId"] in existing_ids:
            continue
        row = inference.get(forecast_row["assetId"])
        if row is None or row["date"] != forecast_row["asOfDate"] or row["features"]["atr14Percent"] is None:
            continue
        prior = sorted([item for item in history[row["assetId"]] if item["date"] < row["date"]], key=lambda item: item["date"])[-252:]
        if len(prior) < 252:
            raise RuntimeError(f"{row['assetId']}: insufficient benchmark history")
        actual_ranges = np.asarray([item["range_y"] for item in prior])
        bodies.append({
            "schemaVersion": 1,
            "recordType": "benchmark-registration",
            "forecastId": forecast_row["forecastId"],
            "forecastRecordHash": forecast_row["recordHash"],
            "registeredAt": datetime.now(timezone.utc).isoformat(),
            "evaluationPolicySha256": policy["policySha256"],
            "baselines": {
                "atrScaledTrueRangePercent": float(row["features"]["atr14Percent"]) * policy["atrScale"],
                "lastObservedTrueRangePercent": float(actual_ranges[-1]),
            },
            "weatherReference": {
                "observations": len(actual_ranges),
                "medianTrueRangePercent": float(np.median(actual_ranges)),
                "highRangeThresholdPercent": float(np.quantile(actual_ranges, .90)),
                "trueRangeQuantilesPercent": {
                    "q25": float(np.quantile(actual_ranges, .25)),
                    "q75": float(np.quantile(actual_ranges, .75)),
                    "q90": float(np.quantile(actual_ranges, .90)),
                },
            },
        })
    if bodies:
        _, head = append_chain(BENCHMARK_LEDGER, bodies)
        print(f"[shadow:register] benchmarks={len(bodies)} chainHead={head}")
    else:
        print("[shadow:register] no unregistered forecasts matched the current official snapshot")


def forecast(dry_run: bool):
    if not MODEL_PATH.exists():
        raise RuntimeError("Run shadow:freeze first")
    artifact = load_json(MODEL_PATH)
    if hash_value({key: value for key, value in artifact.items() if key != "artifactSha256"}) != artifact["artifactSha256"]:
        raise RuntimeError("Frozen model artifact hash mismatch")
    snapshot_path, snapshot = load_snapshot(dry_run)
    validate_snapshot_contract(snapshot, official=not dry_run)
    forecasts = build_forecasts(snapshot, artifact)
    if dry_run:
        preview = {
            "schemaVersion": 1,
            "mode": "dry-run",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "snapshotFileSha256": file_hash(snapshot_path),
            "forecasts": forecasts,
            "note": "Not part of the official prospective ledger.",
        }
        path = SHADOW_DIR / "dry-run-forecast-preview.json"
        path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[shadow:forecast] dry-run forecasts={len(forecasts)} file={path.relative_to(ROOT).as_posix()}")
        return
    existing, _ = verify_ledger(FORECAST_LEDGER)
    existing_ids = {row["forecastId"] for row in existing}
    duplicates = [row for row in forecasts if row["forecastId"] in existing_ids]
    new_forecasts = [row for row in forecasts if row["forecastId"] not in existing_ids]
    if not new_forecasts:
        print(f"[shadow:forecast] no new closes; skipped existing={len(duplicates)}")
        return
    _, head = append_chain(FORECAST_LEDGER, new_forecasts)
    print(f"[shadow:forecast] official forecasts={len(new_forecasts)} skippedExisting={len(duplicates)} chainHead={head}")


def settle(dry_run: bool):
    forecasts, _ = verify_ledger(FORECAST_LEDGER)
    if not forecasts:
        print("[shadow:settle] no official forecasts")
        return
    _, snapshot = load_snapshot(dry_run)
    validate_snapshot_contract(snapshot, official=not dry_run)
    resolved = {(row["assetId"], row["date"]): row for row in snapshot["recentResolvedRows"]}
    prior_settlements, _ = verify_ledger(SETTLEMENT_LEDGER)
    settled_ids = {row["forecastId"] for row in prior_settlements}
    now = datetime.now(timezone.utc).isoformat()
    bodies = []
    for forecast_row in forecasts:
        if forecast_row["forecastId"] in settled_ids:
            continue
        actual = resolved.get((forecast_row["assetId"], forecast_row["asOfDate"]))
        if actual is None:
            continue
        truth = actual["labels"]["nextDayTrueRange"]
        prediction = forecast_row["forecast"]["nextDayTrueRangePercent"]
        interval50, interval80 = forecast_row["forecast"]["interval50"], forecast_row["forecast"]["interval80"]
        bodies.append({
            "schemaVersion": 1,
            "recordType": "settlement",
            "forecastId": forecast_row["forecastId"],
            "forecastRecordHash": forecast_row["recordHash"],
            "settledAt": now,
            "assetId": forecast_row["assetId"],
            "asOfDate": forecast_row["asOfDate"],
            "actual": {"nextDayTrueRangePercent": truth, "tailEvent": actual["labels"]["historicalTailEvent1"]},
            "errors": {
                "absoluteRangeError": abs(truth - prediction),
                "covered50": interval50[0] <= truth <= interval50[1],
                "covered80": interval80[0] <= truth <= interval80[1],
            },
        })
    if dry_run:
        path = SHADOW_DIR / "dry-run-settlement-preview.json"
        path.write_text(json.dumps({"mode": "dry-run", "settlements": bodies}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[shadow:settle] dry-run settleable={len(bodies)}")
    elif bodies:
        _, head = append_chain(SETTLEMENT_LEDGER, bodies)
        print(f"[shadow:settle] appended={len(bodies)} chainHead={head}")
    else:
        print("[shadow:settle] no newly resolved forecasts")


def audit():
    forecasts, forecast_head = verify_ledger(FORECAST_LEDGER)
    settlements, settlement_head = verify_ledger(SETTLEMENT_LEDGER)
    benchmarks, benchmark_head = verify_ledger(BENCHMARK_LEDGER)
    forecast_hashes = {item["forecastId"]: item["recordHash"] for item in forecasts}
    orphans = [item["forecastId"] for item in settlements if forecast_hashes.get(item["forecastId"]) != item["forecastRecordHash"]]
    benchmark_orphans = [item["forecastId"] for item in benchmarks if forecast_hashes.get(item["forecastId"]) != item["forecastRecordHash"]]
    if orphans or benchmark_orphans:
        raise RuntimeError(f"Settlement references invalid forecast hashes: {orphans[:3]}")
    report = {
        "auditedAt": datetime.now(timezone.utc).isoformat(),
        "forecasts": len(forecasts),
        "settlements": len(settlements),
        "benchmarks": len(benchmarks),
        "unsettled": len(forecasts) - len(settlements),
        "forecastChainHead": forecast_head,
        "settlementChainHead": settlement_head,
        "benchmarkChainHead": benchmark_head,
        "orphanSettlements": len(orphans),
        "orphanBenchmarks": len(benchmark_orphans),
        "modelArtifactSha256": load_json(MODEL_PATH)["artifactSha256"] if MODEL_PATH.exists() else None,
    }
    SHADOW_DIR.mkdir(parents=True, exist_ok=True)
    (SHADOW_DIR / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[shadow:audit] {report}")


def report_status():
    forecasts, forecast_head = verify_ledger(FORECAST_LEDGER)
    benchmarks, benchmark_head = verify_ledger(BENCHMARK_LEDGER)
    settlements, settlement_head = verify_ledger(SETTLEMENT_LEDGER)
    latest = {}
    for item in forecasts:
        current = latest.get(item["assetId"])
        if current is None or item["asOfDate"] > current["asOfDate"]:
            latest[item["assetId"]] = item
    weather_counts = defaultdict(int)
    for item in latest.values():
        weather_counts[item["forecast"]["weatherGrade"]] += 1
    benchmark_by_id = {item["forecastId"]: item for item in benchmarks}
    forecast_by_id = {item["forecastId"]: item for item in forecasts}
    paired = [(forecast_by_id[item["forecastId"]], benchmark_by_id.get(item["forecastId"]), item) for item in settlements if item["forecastId"] in forecast_by_id]
    performance = None
    if paired:
        truths = np.asarray([item[2]["actual"]["nextDayTrueRangePercent"] for item in paired])
        predictions = np.asarray([item[0]["forecast"]["nextDayTrueRangePercent"] for item in paired])
        valid_benchmarks = [item for item in paired if item[1] is not None]
        tail_truth = np.asarray([item[2]["actual"]["tailEvent"] for item in paired])
        tail_probability = np.asarray([item[0]["forecast"]["tailRiskProbabilityExperimental"] for item in paired])
        performance = {
            "settled": len(paired),
            "rangeMae": float(np.mean(np.abs(truths - predictions))),
            "coverage50": float(np.mean([item[2]["errors"]["covered50"] for item in paired])),
            "coverage80": float(np.mean([item[2]["errors"]["covered80"] for item in paired])),
            "tailBrierExperimental": float(np.mean((tail_truth - tail_probability) ** 2)),
        }
        if valid_benchmarks:
            benchmark_truth = np.asarray([item[2]["actual"]["nextDayTrueRangePercent"] for item in valid_benchmarks])
            performance["atrBaselineMae"] = float(np.mean(np.abs(benchmark_truth - np.asarray([item[1]["baselines"]["atrScaledTrueRangePercent"] for item in valid_benchmarks]))))
            performance["lastRangeBaselineMae"] = float(np.mean(np.abs(benchmark_truth - np.asarray([item[1]["baselines"]["lastObservedTrueRangePercent"] for item in valid_benchmarks]))))
    status = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "modelArtifactSha256": load_json(MODEL_PATH)["artifactSha256"],
        "officialForecasts": len(forecasts),
        "registeredBenchmarks": len(benchmarks),
        "settlements": len(settlements),
        "unsettled": len(forecasts) - len(settlements),
        "latestAssets": len(latest),
        "latestWeatherCounts": dict(weather_counts),
        "performance": performance,
        "chainHeads": {"forecast": forecast_head, "benchmark": benchmark_head, "settlement": settlement_head},
    }
    (SHADOW_DIR / "STATUS.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# 시장기상청 공식 Shadow 예보", "",
        f"- 생성 시각(UTC): {status['generatedAt']}",
        f"- 공식 예보: {len(forecasts)}건 · 기준선 등록: {len(benchmarks)}건 · 정산: {len(settlements)}건",
        f"- 현재 상태: {'성과 판정 대기' if not settlements else '전향 성과 누적 중'}", "",
        "|자산|기준일|예상 True Range|50% 구간|80% 구간|날씨|꼬리위험(실험)|", "|---|---|---:|---:|---:|---|---:|",
    ]
    for asset, item in sorted(latest.items()):
        forecast = item["forecast"]
        lines.append(
            f"|{asset}|{item['asOfDate']}|{forecast['nextDayTrueRangePercent']:.2f}%|"
            f"{forecast['interval50'][0]:.2f}~{forecast['interval50'][1]:.2f}%|"
            f"{forecast['interval80'][0]:.2f}~{forecast['interval80'][1]:.2f}%|"
            f"{forecast['weatherLabel']}|{forecast['tailRiskProbabilityExperimental'] * 100:.1f}%|"
        )
    lines += ["", "방향·수익률·매매 신호는 예측하지 않습니다. 꼬리위험은 아직 내부 실험값입니다.", ""]
    if performance:
        lines += ["## 누적 정산", "", f"- Range MAE: {performance['rangeMae']:.4f}", f"- 50% 포함률: {performance['coverage50'] * 100:.1f}%", f"- 80% 포함률: {performance['coverage80'] * 100:.1f}%", ""]
    (SHADOW_DIR / "LATEST_FORECAST.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"[shadow:report] forecasts={len(forecasts)} settlements={len(settlements)} latest={len(latest)}")


def export_public_forecast():
    forecasts, forecast_head = verify_ledger(FORECAST_LEDGER)
    settlements, settlement_head = verify_ledger(SETTLEMENT_LEDGER)
    if not forecasts:
        raise RuntimeError("No official forecasts are available to publish")
    latest = {}
    for item in forecasts:
        current = latest.get(item["assetId"])
        if current is None or item["asOfDate"] > current["asOfDate"]:
            latest[item["assetId"]] = item
    settlement_by_id = {item["forecastId"]: item for item in settlements}
    public_forecasts = []
    for asset, item in sorted(latest.items()):
        forecast = item["forecast"]
        settlement = settlement_by_id.get(item["forecastId"])
        public_forecasts.append({
            "assetId": asset,
            "asOfDate": item["asOfDate"],
            "forecastPolicy": item["forecastPolicy"],
            "createdAt": item["createdAt"],
            "expectedTrueRangePercent": round(forecast["nextDayTrueRangePercent"], 6),
            "interval50": [round(value, 6) for value in forecast["interval50"]],
            "interval80": [round(value, 6) for value in forecast["interval80"]],
            "weatherPercentile252": round(forecast["weatherPercentile252"], 4),
            "weatherGrade": forecast["weatherGrade"],
            "weatherLabel": forecast["weatherLabel"],
            "status": "settled" if settlement else "pending",
            "settlement": None if settlement is None else {
                "actualTrueRangePercent": settlement["actual"]["nextDayTrueRangePercent"],
                "covered50": settlement["errors"]["covered50"],
                "covered80": settlement["errors"]["covered80"],
                "settledAt": settlement["settledAt"],
            },
        })
    recent_settlements = []
    for item in sorted(settlements, key=lambda row: row["settledAt"], reverse=True)[:30]:
        forecast = next((row for row in forecasts if row["forecastId"] == item["forecastId"]), None)
        if forecast is None:
            continue
        recent_settlements.append({
            "assetId": item["assetId"],
            "asOfDate": item["asOfDate"],
            "expectedTrueRangePercent": round(forecast["forecast"]["nextDayTrueRangePercent"], 6),
            "actualTrueRangePercent": item["actual"]["nextDayTrueRangePercent"],
            "covered50": item["errors"]["covered50"],
            "covered80": item["errors"]["covered80"],
            "settledAt": item["settledAt"],
        })
    body = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": {
            "id": "market-weather-shadow-frozen-v1",
            "version": "v2",
            "status": "official-shadow",
            "target": "next-day true range",
            "directionForecast": False,
        },
        "aliases": {"SP500": "SPY", "NASDAQ": "QQQ"},
        "forecasts": public_forecasts,
        "recentSettlements": recent_settlements,
        "integrity": {
            "forecastChainHead": forecast_head,
            "settlementChainHead": settlement_head,
            "officialForecasts": len(forecasts),
            "settlements": len(settlements),
        },
        "disclosure": "예상 변동폭은 상승·하락 방향이나 매매 신호를 뜻하지 않습니다.",
    }
    PUBLIC_FORECAST.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_FORECAST.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[shadow:export] assets={len(public_forecasts)} settlements={len(recent_settlements)} file={PUBLIC_FORECAST.relative_to(ROOT).as_posix()}")


def self_test():
    if not MODEL_PATH.exists():
        raise RuntimeError("Run shadow:freeze first")
    _, snapshot = load_snapshot(True)
    official_forecasts_before = len(verify_ledger(FORECAST_LEDGER)[0])
    official_settlements_before = len(verify_ledger(SETTLEMENT_LEDGER)[0])
    validate_snapshot_contract(snapshot, official=False)
    artifact = load_json(MODEL_PATH)
    forecasts = build_forecasts(snapshot, artifact)
    checks = {
        "inferenceRowsContainNoLabels": all("labels" not in row for row in snapshot["inferenceRows"]),
        "allResolvedRowsStrictlyEarlier": all(row["date"] < next(item["date"] for item in snapshot["inferenceRows"] if item["assetId"] == row["assetId"]) for row in snapshot["recentResolvedRows"]),
        "allForecastsHaveNoDirection": all(item["forecast"]["direction"] is None for item in forecasts),
        "allIntervalsOrdered": all(
            0 < item["forecast"]["interval80"][0] <= item["forecast"]["interval50"][0]
            <= item["forecast"]["nextDayTrueRangePercent"]
            <= item["forecast"]["interval50"][1] <= item["forecast"]["interval80"][1]
            for item in forecasts
        ),
        "allCalibrationHistoriesCausal": all(item["calibrationHistory"]["lastResolvedDate"] < item["asOfDate"] for item in forecasts),
        "forecastIdsUnique": len({item["forecastId"] for item in forecasts}) == len(forecasts),
        "officialLedgersUntouchedByDryRun": official_forecasts_before == len(verify_ledger(FORECAST_LEDGER)[0]) and official_settlements_before == len(verify_ledger(SETTLEMENT_LEDGER)[0]),
    }
    test_path = SHADOW_DIR / ".hash-chain-self-test.jsonl"
    if test_path.exists():
        test_path.unlink()
    append_chain(test_path, [{"id": 1}, {"id": 2}])
    verify_ledger(test_path)
    lines = test_path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["id"] = 999
    lines[0] = canonical(tampered)
    test_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    rejected = False
    try:
        verify_ledger(test_path)
    except RuntimeError:
        rejected = True
    finally:
        test_path.unlink(missing_ok=True)
    checks["tamperedLedgerRejected"] = rejected
    checks["staleOfficialSnapshotRejected"] = False
    try:
        validate_snapshot_contract(snapshot, official=True)
    except RuntimeError:
        checks["staleOfficialSnapshotRejected"] = True
    if not all(checks.values()):
        raise RuntimeError(f"Shadow self-test failed: {[key for key, value in checks.items() if not value]}")
    report = {"verifiedAt": datetime.now(timezone.utc).isoformat(), "checks": checks, "forecastPreviewRows": len(forecasts), "status": "passed"}
    (SHADOW_DIR / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[shadow:self-test] passed checks={len(checks)} forecasts={len(forecasts)}")


def main():
    parser = argparse.ArgumentParser(description="Prospective market-weather shadow test")
    parser.add_argument("command", choices=("freeze", "forecast", "register", "settle", "audit", "report", "export", "self-test"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.command == "freeze":
        freeze_model(args.force)
    elif args.command == "forecast":
        forecast(args.dry_run)
    elif args.command == "settle":
        settle(args.dry_run)
    elif args.command == "register":
        register_benchmarks()
    elif args.command == "audit":
        audit()
    elif args.command == "report":
        report_status()
    elif args.command == "export":
        export_public_forecast()
    else:
        self_test()


if __name__ == "__main__":
    main()
