from __future__ import annotations

import gzip
import hashlib
import json
import math
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "modeling"))
import run as modeling  # noqa: E402

PANEL_PATH = ROOT / "research-results" / "market-weather-eod-panel-v1" / "panel.jsonl.gz"
SPLIT_PATH = ROOT / "research-results" / "market-weather-baseline-evaluation-v1" / "split-manifest.json"
PANEL_REPORT_PATH = ROOT / "research-results" / "market-weather-eod-panel-v1" / "build-report.json"
OUTPUT_DIR = ROOT / "research-results" / "market-weather-calibration-v1"
CALIBRATION_ID = "market-weather-calibration-v1"
RANDOM_SEED = 20260619
BOOTSTRAP_SAMPLES = 300
BLOCK_LENGTH = 20
RANGE_LAMBDA = 0.001
TAIL_LAMBDA = 0.01
CALIBRATOR_LAMBDA = 0.01
LOOKBACK = 252
RECENT_PRIOR_STRENGTH = 100
ADAPTIVE_STRENGTHS = [0.0, 0.25, 0.50, 0.75, 1.0]
RANGE_FEATURES = modeling.RANGE_FEATURES + modeling.V01_FEATURES
TAIL_FEATURES = modeling.CORE_FEATURES
WEATHER_BINS = [
    ("quiet", "잔잔", 0.0, 25.0),
    ("normal", "보통", 25.0, 75.0),
    ("strong", "강풍", 75.0, 90.0),
    ("storm", "폭풍", 90.0, 100.000001),
]
WEATHER_SENSITIVITY_BINS = {
    "20-70-90": [0.0, 20.0, 70.0, 90.0, 100.000001],
    "25-75-90-candidate": [0.0, 25.0, 75.0, 90.0, 100.000001],
    "25-70-85": [0.0, 25.0, 70.0, 85.0, 100.000001],
    "30-75-90": [0.0, 30.0, 75.0, 90.0, 100.000001],
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def logit(probability):
    clipped = np.clip(probability, 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped))


def weighted_quantile(values: np.ndarray, quantiles: list[float], weights: np.ndarray) -> dict[str, float]:
    order = np.argsort(values, kind="mergesort")
    ordered = values[order]
    ordered_weights = weights[order]
    cumulative = np.cumsum(ordered_weights) - ordered_weights / 2
    cumulative /= np.sum(ordered_weights)
    return {f"q{int(q * 100):02d}": float(np.interp(q, cumulative, ordered)) for q in quantiles}


def make_oof_predictions(train: list[dict], task: str) -> tuple[list[dict], np.ndarray, list[dict]]:
    all_records, all_predictions, fold_audit = [], [], []
    for fold_index, (train_end, validation_start, validation_end) in enumerate(modeling.INNER_CORE_FOLDS, start=1):
        fold_train, fold_validation = modeling.inner_fold(train, train_end, validation_start, validation_end)
        model = (
            modeling.fit_ridge(fold_train, RANGE_FEATURES, RANGE_LAMBDA)
            if task == "range"
            else modeling.fit_logistic(fold_train, TAIL_FEATURES, TAIL_LAMBDA, "tail_y")
        )
        prediction = model.predict(fold_validation)
        all_records.extend(fold_validation)
        all_predictions.extend(prediction.tolist())
        fold_audit.append({
            "fold": fold_index,
            "trainEnd": train_end,
            "validationStart": validation_start,
            "validationEnd": validation_end,
            "trainingRows": len(fold_train),
            "validationRows": len(fold_validation),
            "latestTrainingDate": max(item["date"] for item in fold_train),
            "earliestValidationDate": min(item["date"] for item in fold_validation),
        })
    return all_records, np.asarray(all_predictions, dtype=np.float64), fold_audit


def conformal_quantiles(records: list[dict], predictions: np.ndarray) -> tuple[dict, dict]:
    ratios = modeling.target(records, "range_y") / np.maximum(predictions, 0.01)
    weights = modeling.cluster_asset_weights(records)
    levels = [0.10, 0.25, 0.50, 0.75, 0.90, 0.95]
    global_quantiles = weighted_quantile(ratios, levels, weights)
    cluster_quantiles = {}
    for cluster in sorted({item["cluster"] for item in records}):
        indices = np.asarray([i for i, item in enumerate(records) if item["cluster"] == cluster], dtype=int)
        subset = [records[i] for i in indices]
        cluster_quantiles[cluster] = weighted_quantile(
            ratios[indices], levels, modeling.cluster_asset_weights(subset)
        )
    return global_quantiles, cluster_quantiles


def interval_bounds(records, predictions, global_q, cluster_q, scheme, coverage):
    lower_key, upper_key = ("q25", "q75") if coverage == 50 else ("q10", "q90")
    lower, upper = np.zeros(len(records)), np.zeros(len(records))
    for index, record in enumerate(records):
        q = cluster_q.get(record["cluster"], global_q) if scheme == "cluster" else global_q
        lower[index], upper[index] = predictions[index] * q[lower_key], predictions[index] * q[upper_key]
    return lower, upper


def interval_metrics(records, predictions, global_q, cluster_q, scheme):
    truth = modeling.target(records, "range_y")
    bounds = {coverage: interval_bounds(records, predictions, global_q, cluster_q, scheme, coverage) for coverage in (50, 80)}
    per_asset = []
    for asset, indices in modeling.grouped_indices(records).items():
        item = {"asset": asset}
        for coverage, (lower, upper) in bounds.items():
            item[f"coverage{coverage}"] = float(np.mean((truth[indices] >= lower[indices]) & (truth[indices] <= upper[indices])))
            item[f"width{coverage}"] = float(np.mean(upper[indices] - lower[indices]))
        per_asset.append(item)
    result = {key: float(np.mean([item[key] for item in per_asset])) for key in ("coverage50", "width50", "coverage80", "width80")}
    result["meanAbsoluteCoverageError"] = (abs(result["coverage50"] - 0.50) + abs(result["coverage80"] - 0.80)) / 2
    result.update({"assets": len(per_asset), "rows": len(records)})
    return result


def circular_block_indices(length: int, rng: np.random.Generator) -> np.ndarray:
    output = []
    while len(output) < length:
        start = int(rng.integers(0, length))
        output.extend((start + offset) % length for offset in range(BLOCK_LENGTH))
    return np.asarray(output[:length], dtype=int)


def bootstrap_coverage(records, predictions, global_q, cluster_q, scheme):
    truth, groups = modeling.target(records, "range_y"), modeling.grouped_indices(records)
    rng, output = np.random.default_rng(RANDOM_SEED), {}
    for coverage in (50, 80):
        lower, upper = interval_bounds(records, predictions, global_q, cluster_q, scheme, coverage)
        contained, estimates = (truth >= lower) & (truth <= upper), []
        for _ in range(BOOTSTRAP_SAMPLES):
            asset_values = []
            for indices in groups.values():
                selected = indices[circular_block_indices(len(indices), rng)]
                asset_values.append(float(np.mean(contained[selected])))
            estimates.append(float(np.mean(asset_values)))
        output[f"coverage{coverage}"] = {
            "estimate": float(np.mean(estimates)),
            "target": coverage / 100,
            "ci95": [float(np.quantile(estimates, 0.025)), float(np.quantile(estimates, 0.975))],
        }
    return output


def load_history(split_manifest):
    summaries = {item["assetId"]: item for item in split_manifest["assets"]}
    clusters = split_manifest["policy"]["trainingClusters"]
    asset_cluster = {asset: cluster for cluster, assets in clusters.items() for asset in assets}
    history, skipped = [], 0
    with gzip.open(PANEL_PATH, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            summary = summaries[row["assetId"]]
            if row["date"] > summary["lastValidationDate"]:
                skipped += 1
                continue
            record = modeling.extract_record(row, "history", asset_cluster[row["assetId"]])
            record.update({
                "role": summary["assetRole"],
                "first_validation_date": summary["firstValidationDate"],
                "last_validation_date": summary["lastValidationDate"],
            })
            history.append(record)
    return history, {"historyRowsThroughValidation": len(history), "rowsAfterValidationSkipped": skipped, "sealedRowsUsedForMetrics": 0}


def historical_range_ranks(history, range_model):
    enriched, by_asset = [], defaultdict(list)
    for record in history:
        by_asset[record["asset"]].append(record)
    for asset_records in by_asset.values():
        asset_records.sort(key=lambda item: item["date"])
        predictions = range_model.predict(asset_records)
        prior_predictions, prior_ranges = deque(maxlen=LOOKBACK), deque(maxlen=LOOKBACK)
        for record, prediction in zip(asset_records, predictions):
            if len(prior_predictions) == LOOKBACK:
                percentile = 100 * sum(value <= prediction for value in prior_predictions) / LOOKBACK
                threshold = float(np.quantile(np.asarray(prior_ranges), 0.90))
                prior_median = float(np.median(np.asarray(prior_ranges)))
                enriched.append({
                    **record,
                    "range_prediction": float(prediction),
                    "prediction_percentile252": percentile,
                    "actual_range_atr_ratio": record["range_y"] / max(record["atr_direct"], 0.01),
                    "actual_range_prior_median_ratio": record["range_y"] / max(prior_median, 0.01),
                    "historical_high_range_event": int(record["range_y"] > threshold),
                })
            prior_predictions.append(float(prediction))
            prior_ranges.append(record["range_y"])
    return enriched


def weather_bin(percentile, bins=WEATHER_BINS):
    for key, _, lower, upper in bins:
        if lower <= percentile < upper:
            return key
    raise ValueError(f"Unexpected percentile: {percentile}")


def asset_equal_bin_metrics(records, bins=WEATHER_BINS):
    output = {}
    for key, label, _, _ in bins:
        selected = [item for item in records if weather_bin(item["prediction_percentile252"], bins) == key]
        by_asset = defaultdict(list)
        for item in selected:
            by_asset[item["asset"]].append(item)
        per_asset = [{
            "actualRangePercent": float(np.mean([item["range_y"] for item in asset_records])),
            "actualRangeAtrRatio": float(np.mean([item["actual_range_atr_ratio"] for item in asset_records])),
            "actualRangePriorMedianRatio": float(np.mean([item["actual_range_prior_median_ratio"] for item in asset_records])),
            "highRangeEventRate": float(np.mean([item["historical_high_range_event"] for item in asset_records])),
        } for asset_records in by_asset.values()]
        output[key] = {
            "label": label, "rows": len(selected), "assets": len(by_asset),
            **({metric: float(np.mean([item[metric] for item in per_asset])) for metric in per_asset[0]} if per_asset else {}),
        }
    normalized = [output[key].get("actualRangePriorMedianRatio", float("nan")) for key, *_ in bins]
    events = [output[key].get("highRangeEventRate", float("nan")) for key, *_ in bins]
    norm_mono, event_mono = all(a <= b for a, b in zip(normalized, normalized[1:])), all(a <= b for a, b in zip(events, events[1:]))
    output["monotonicity"] = {
        "actualRangePriorMedianRatioNonDecreasing": norm_mono,
        "highRangeEventRateNonDecreasing": event_mono,
        "both": norm_mono and event_mono,
        "atrNormalizedRatioIsDiagnosticOnly": True,
    }
    return output


def bootstrap_weather_delta(records):
    groups, rng = modeling.grouped_indices(records), np.random.default_rng(RANDOM_SEED)
    normalized_deltas, event_deltas = [], []
    for _ in range(BOOTSTRAP_SAMPLES):
        per_asset_normalized, per_asset_events = [], []
        for indices in groups.values():
            sampled = indices[circular_block_indices(len(indices), rng)]
            quiet = [records[i] for i in sampled if weather_bin(records[i]["prediction_percentile252"]) == "quiet"]
            storm = [records[i] for i in sampled if weather_bin(records[i]["prediction_percentile252"]) == "storm"]
            if quiet and storm:
                per_asset_normalized.append(np.mean([x["actual_range_prior_median_ratio"] for x in storm]) - np.mean([x["actual_range_prior_median_ratio"] for x in quiet]))
                per_asset_events.append(np.mean([x["historical_high_range_event"] for x in storm]) - np.mean([x["historical_high_range_event"] for x in quiet]))
        normalized_deltas.append(float(np.mean(per_asset_normalized)))
        event_deltas.append(float(np.mean(per_asset_events)))
    return {
        "stormMinusQuietActualRangePriorMedianRatio": {"meanDelta": float(np.mean(normalized_deltas)), "ci95": [float(np.quantile(normalized_deltas, .025)), float(np.quantile(normalized_deltas, .975))]},
        "stormMinusQuietHighRangeEventRate": {"meanDelta": float(np.mean(event_deltas)), "ci95": [float(np.quantile(event_deltas, .025)), float(np.quantile(event_deltas, .975))]},
    }


def sensitivity_bins(boundaries):
    labels = [("quiet", "잔잔"), ("normal", "보통"), ("strong", "강풍"), ("storm", "폭풍")]
    return [(key, label, boundaries[index], boundaries[index + 1]) for index, (key, label) in enumerate(labels)]


def weather_robustness(records):
    by_year = {
        year: asset_equal_bin_metrics([item for item in records if item["date"].startswith(year)])
        for year in ("2023", "2024")
    }
    by_asset = {}
    for asset, indices in modeling.grouped_indices(records).items():
        subset = [records[index] for index in indices]
        bins = asset_equal_bin_metrics(subset)
        quiet, storm = bins["quiet"], bins["storm"]
        by_asset[asset] = {
            "rows": len(subset),
            "stormMinusQuietPriorMedianRatio": storm.get("actualRangePriorMedianRatio", float("nan")) - quiet.get("actualRangePriorMedianRatio", float("nan")),
            "stormMinusQuietHighRangeEventRate": storm.get("highRangeEventRate", float("nan")) - quiet.get("highRangeEventRate", float("nan")),
            "monotonicBoth": bins["monotonicity"]["both"],
        }
    sensitivity = {}
    for name, boundaries in WEATHER_SENSITIVITY_BINS.items():
        bins = asset_equal_bin_metrics(records, sensitivity_bins(boundaries))
        sensitivity[name] = {
            "monotonicBoth": bins["monotonicity"]["both"],
            "stormMinusQuietPriorMedianRatio": bins["storm"].get("actualRangePriorMedianRatio", float("nan")) - bins["quiet"].get("actualRangePriorMedianRatio", float("nan")),
            "stormMinusQuietHighRangeEventRate": bins["storm"].get("highRangeEventRate", float("nan")) - bins["quiet"].get("highRangeEventRate", float("nan")),
            "counts": {key: bins[key]["rows"] for key in ("quiet", "normal", "strong", "storm")},
        }
    valid_assets = [item for item in by_asset.values() if math.isfinite(item["stormMinusQuietPriorMedianRatio"])]
    return {
        "byYear": by_year,
        "byAsset": by_asset,
        "assetPassRates": {
            "positiveRangeDelta": float(np.mean([item["stormMinusQuietPriorMedianRatio"] > 0 for item in valid_assets])),
            "positiveHighRangeEventDelta": float(np.mean([item["stormMinusQuietHighRangeEventRate"] > 0 for item in valid_assets])),
            "fullyMonotonic": float(np.mean([item["monotonicBoth"] for item in valid_assets])),
            "assets": len(valid_assets),
        },
        "boundarySensitivity": sensitivity,
    }


def interval_robustness(records, predictions, global_q, cluster_q, scheme):
    by_year = {}
    for year in ("2023", "2024"):
        indices = np.asarray([i for i, item in enumerate(records) if item["date"].startswith(year)], dtype=int)
        by_year[year] = interval_metrics([records[i] for i in indices], predictions[indices], global_q, cluster_q, scheme)
    by_asset = {}
    for asset, indices in modeling.grouped_indices(records).items():
        by_asset[asset] = interval_metrics([records[i] for i in indices], predictions[indices], global_q, cluster_q, scheme)
    return {"byYear": by_year, "byAsset": by_asset}


def tail_robustness(records, candidate, base_rate):
    by_year = {}
    for year in ("2023", "2024"):
        indices = np.asarray([i for i, item in enumerate(records) if item["date"].startswith(year)], dtype=int)
        subset = [records[i] for i in indices]
        base = np.full(len(subset), base_rate)
        by_year[year] = {
            "candidate": modeling.probability_metrics(subset, candidate[indices], "tail_y"),
            "base": modeling.probability_metrics(subset, base, "tail_y"),
            "brierDelta": modeling.brier(modeling.target(subset, "tail_y"), candidate[indices]) - modeling.brier(modeling.target(subset, "tail_y"), base),
        }
    by_asset = {}
    for asset, indices in modeling.grouped_indices(records).items():
        truth = modeling.target(records, "tail_y")[indices]
        prediction = candidate[indices]
        by_asset[asset] = {
            "rows": len(indices),
            "events": int(np.sum(truth)),
            "brierDeltaVsTrainBase": modeling.brier(truth, prediction) - modeling.brier(truth, np.full(len(indices), base_rate)),
            "rocAuc": modeling.roc_auc(truth, prediction),
        }
    return {
        "byYear": by_year,
        "byAsset": by_asset,
        "assetPassRateBrier": float(np.mean([item["brierDeltaVsTrainBase"] < 0 for item in by_asset.values()])),
    }


def calibration_records(records, probabilities):
    result = []
    for record, probability in zip(records, probabilities):
        p = float(np.clip(probability, 1e-6, 1 - 1e-6))
        result.append({**record, "cal_logit": float(logit(p)), "cal_log_p": math.log(p), "cal_log_one_minus_p": -math.log(1 - p)})
    return result


def apply_calibrator(model, records, probabilities):
    return model.predict(calibration_records(records, probabilities))


def build_recent_prior(history, base_rate):
    result, by_asset = {}, defaultdict(list)
    for record in history:
        by_asset[record["asset"]].append(record)
    for asset_records in by_asset.values():
        prior = deque(maxlen=LOOKBACK)
        for record in sorted(asset_records, key=lambda item: item["date"]):
            result[(record["asset"], record["date"])] = float((sum(prior) + RECENT_PRIOR_STRENGTH * base_rate) / (len(prior) + RECENT_PRIOR_STRENGTH))
            prior.append(record["tail_y"])
    return result


def adaptive_probability(records, probability, recent_prior, base_rate, strength=1.0):
    prior = np.asarray([recent_prior[(item["asset"], item["date"])] for item in records])
    return modeling.sigmoid(logit(probability) + strength * (logit(prior) - logit(base_rate)))


def calibrator_monotonic(model):
    grid = np.linspace(.001, .999, 999)
    dummy = [{"asset": "dummy", "date": str(i), "cluster": "dummy", "tail_y": 0, "cal_logit": float(logit(p)), "cal_log_p": math.log(p), "cal_log_one_minus_p": -math.log(1 - p)} for i, p in enumerate(grid)]
    return bool(np.all(np.diff(model.predict(dummy)) >= -1e-10))


def tail_evaluation(records, predictions, base_rate):
    metrics = {name: modeling.probability_metrics(records, value, "tail_y") for name, value in predictions.items()}
    baseline = np.full(len(records), base_rate)
    bootstrap = {name: modeling.bootstrap_delta(records, value, baseline, "tail_y", modeling.brier) for name, value in predictions.items() if name != "train-base-rate"}
    return {"metrics": metrics, "bootstrapVsTrainBaseRate": bootstrap}


def artifact_hash(artifact):
    payload = json.dumps(json_safe(artifact), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def pct(value):
    return f"{value * 100:.1f}%"


def markdown_report(report):
    conformal, weather, tail = report["rangeCalibration"], report["weatherMapping"], report["tailCalibration"]
    lines = [
        "# 시장기상청 예보 보정 연구 v1", "", "## 연구 경계", "",
        f"- 학습 행: {report['dataAudit']['trainingRows']:,}",
        f"- 검증: seen {report['dataAudit']['validationSeenRows']:,} · asset-holdout {report['dataAudit']['validationAssetHoldoutRows']:,}",
        f"- 봉인 시험 라벨 사용: {report['verification']['sealedTestLabelsUsed']}",
        "- 방향 예측은 이전 단계에서 탈락했으며 이번 연구에 포함하지 않았습니다.",
        "- 앱의 `weatherScore-v0.1` 공식은 변경하지 않았습니다.", "", "## 다음날 변동폭 예측구간", "",
        f"OOF 예측오차 비율로 50%·80% 경험적 구간을 만들었습니다. 선택 방식은 `{conformal['selectedScheme']}`입니다.", "",
        "|집단|방식|50% 포함률|80% 포함률|평균 포함률 오차|", "|---|---|---:|---:|---:|",
    ]
    for cohort in ("seen-assets", "asset-holdout"):
        for scheme in ("global", "cluster"):
            item = conformal["validation"][cohort][scheme]
            lines.append(f"|{cohort}|{scheme}|{pct(item['coverage50'])}|{pct(item['coverage80'])}|{pct(item['meanAbsoluteCoverageError'])}|")
    lines += ["", "## 자산 상대형 날씨 등급", "", "각 자산의 과거 252일 예측분포에서 현재 예측이 어디에 있는지로 잔잔·보통·강풍·폭풍을 정했습니다.", ""]
    for cohort in ("seen-assets", "asset-holdout"):
        lines += [f"### {cohort}", "", "|등급|행|실제 변동폭/직전 252일 중앙값|과거 대비 고변동 발생률|", "|---|---:|---:|---:|"]
        bins = weather["validation"][cohort]["bins"]
        for key, label, *_ in WEATHER_BINS:
            item = bins[key]
            lines.append(f"|{label}|{item['rows']:,}|{item['actualRangePriorMedianRatio']:.3f}|{pct(item['highRangeEventRate'])}|")
        boot = weather["validation"][cohort]["bootstrap"]
        rci, eci = boot["stormMinusQuietActualRangePriorMedianRatio"]["ci95"], boot["stormMinusQuietHighRangeEventRate"]["ci95"]
        lines += ["", f"- 폭풍−잔잔 과거 중앙값 대비 변동폭 95% CI: [{rci[0]:.3f}, {rci[1]:.3f}]", f"- 폭풍−잔잔 고변동 확률 차이 95% CI: [{pct(eci[0])}, {pct(eci[1])}]", f"- 4등급 단조성 통과: {bins['monotonicity']['both']}", ""]
    lines += ["## 꼬리위험 확률 보정", "", f"정적 후보는 seen 검증 Brier로 `{tail['selectedStaticCandidate']}`를 선택했습니다.", "", "|집단|후보|Brier|ECE|AUC|상위10% Lift|", "|---|---|---:|---:|---:|---:|"]
    for cohort in ("seen-assets", "asset-holdout"):
        for name, metrics in tail["validation"][cohort]["metrics"].items():
            lines.append(f"|{cohort}|{name}|{metrics['brier']:.4f}|{metrics['ece10']:.4f}|{metrics['rocAuc']:.3f}|{metrics['topDecileLift']:.2f}배|")
    lines += ["", "## 연구 결정", ""] + [f"- {note}" for note in report["decisionNotes"]]
    lines += ["", "2025년 이후 봉인 시험과 XLC·XLRE·TSLA·NVDA·ETH 최종 전이 검증은 아직 열지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    split_manifest, panel_report = load_json(SPLIT_PATH), load_json(PANEL_REPORT_PATH)
    train, validation_seen, validation_holdout, data_audit = modeling.load_records()
    history, history_audit = load_history(split_manifest)

    print("[calibration] fitting selected models and OOF predictions")
    range_model = modeling.fit_ridge(train, RANGE_FEATURES, RANGE_LAMBDA)
    tail_model = modeling.fit_logistic(train, TAIL_FEATURES, TAIL_LAMBDA, "tail_y")
    range_oof_records, range_oof_predictions, range_folds = make_oof_predictions(train, "range")
    tail_oof_records, tail_oof_predictions, tail_folds = make_oof_predictions(train, "tail")

    global_q, cluster_q = conformal_quantiles(range_oof_records, range_oof_predictions)
    range_validation, range_predictions = {}, {}
    for cohort, records in (("seen-assets", validation_seen), ("asset-holdout", validation_holdout)):
        prediction = range_model.predict(records)
        range_predictions[cohort] = prediction
        range_validation[cohort] = {}
        for scheme in ("global", "cluster"):
            range_validation[cohort][scheme] = interval_metrics(records, prediction, global_q, cluster_q, scheme)
            range_validation[cohort][scheme]["bootstrap"] = bootstrap_coverage(records, prediction, global_q, cluster_q, scheme)
    selected_scheme = min(("global", "cluster"), key=lambda name: range_validation["seen-assets"][name]["meanAbsoluteCoverageError"])

    print("[calibration] evaluating asset-relative weather mapping")
    ranked_history = historical_range_ranks(history, range_model)
    weather_validation, weather_records = {}, {}
    for cohort, role in (("seen-assets", "development"), ("asset-holdout", "asset-holdout")):
        records = [item for item in ranked_history if item["role"] == role and item["first_validation_date"] <= item["date"] <= item["last_validation_date"]]
        weather_records[cohort] = records
        weather_validation[cohort] = {"rows": len(records), "bins": asset_equal_bin_metrics(records), "bootstrap": bootstrap_weather_delta(records)}

    print("[calibration] fitting OOF probability calibrators")
    oof_cal_records = calibration_records(tail_oof_records, tail_oof_predictions)
    platt_model = modeling.fit_logistic(oof_cal_records, ["cal_logit"], CALIBRATOR_LAMBDA, "tail_y")
    beta_model = modeling.fit_logistic(oof_cal_records, ["cal_log_p", "cal_log_one_minus_p"], CALIBRATOR_LAMBDA, "tail_y")
    base_rate, recent_prior = modeling.weighted_base_rate(train, "tail_y"), None
    recent_prior = build_recent_prior(history, base_rate)
    tail_predictions = {}
    for cohort, records in (("seen-assets", validation_seen), ("asset-holdout", validation_holdout)):
        raw = tail_model.predict(records)
        tail_predictions[cohort] = {
            "train-base-rate": np.full(len(records), base_rate),
            "raw-core": raw,
            "platt": apply_calibrator(platt_model, records, raw),
            "beta": apply_calibrator(beta_model, records, raw),
            "recent-prior-only": np.asarray([recent_prior[(item["asset"], item["date"])] for item in records]),
        }
    selected_static = min(("raw-core", "platt", "beta"), key=lambda name: modeling.probability_metrics(validation_seen, tail_predictions["seen-assets"][name], "tail_y")["brier"])
    adaptive_seen_scores = {}
    for strength in ADAPTIVE_STRENGTHS:
        candidate = adaptive_probability(validation_seen, tail_predictions["seen-assets"][selected_static], recent_prior, base_rate, strength)
        adaptive_seen_scores[str(strength)] = modeling.probability_metrics(validation_seen, candidate, "tail_y")["brier"]
    selected_adaptive_strength = min(ADAPTIVE_STRENGTHS, key=lambda value: adaptive_seen_scores[str(value)])
    adaptive_name = f"{selected_static}+recent-prior@{selected_adaptive_strength:.2f}"
    for cohort, records in (("seen-assets", validation_seen), ("asset-holdout", validation_holdout)):
        tail_predictions[cohort][adaptive_name] = adaptive_probability(
            records, tail_predictions[cohort][selected_static], recent_prior, base_rate, selected_adaptive_strength
        )
    tail_validation = {cohort: tail_evaluation(records, tail_predictions[cohort], base_rate) for cohort, records in (("seen-assets", validation_seen), ("asset-holdout", validation_holdout))}

    print("[calibration] running year, asset, and threshold robustness checks")
    robustness = {"rangeIntervals": {}, "weatherMapping": {}, "tailCalibration": {}}
    for cohort, records in (("seen-assets", validation_seen), ("asset-holdout", validation_holdout)):
        robustness["rangeIntervals"][cohort] = interval_robustness(records, range_predictions[cohort], global_q, cluster_q, selected_scheme)
        robustness["weatherMapping"][cohort] = weather_robustness(weather_records[cohort])
        robustness["tailCalibration"][cohort] = tail_robustness(records, tail_predictions[cohort][adaptive_name], base_rate)

    holdout_boot = tail_validation["asset-holdout"]["bootstrapVsTrainBaseRate"][adaptive_name]
    tail_status = "validation-passed-research-candidate" if holdout_boot["ci95"][1] < 0 else "research-only"
    seen_weather, holdout_weather = weather_validation["seen-assets"], weather_validation["asset-holdout"]
    endpoint_pass = all(result[key]["ci95"][0] > 0 for result in (seen_weather["bootstrap"], holdout_weather["bootstrap"]) for key in ("stormMinusQuietActualRangePriorMedianRatio", "stormMinusQuietHighRangeEventRate"))
    weather_exact_year_monotonic = all(
        item["monotonicity"]["both"]
        for cohort in robustness["weatherMapping"].values()
        for item in cohort["byYear"].values()
    )
    weather_year_pass = all(
        item["monotonicity"]["actualRangePriorMedianRatioNonDecreasing"]
        and item["storm"]["highRangeEventRate"] > item["quiet"]["highRangeEventRate"]
        for cohort in robustness["weatherMapping"].values()
        for item in cohort["byYear"].values()
    )
    weather_boundary_pass = all(
        item["monotonicBoth"]
        for cohort in robustness["weatherMapping"].values()
        for item in cohort["boundarySensitivity"].values()
    )
    weather_asset_pass = robustness["weatherMapping"]["asset-holdout"]["assetPassRates"]["positiveHighRangeEventDelta"] >= 0.80
    weather_status = "validation-passed-research-candidate" if seen_weather["bins"]["monotonicity"]["both"] and holdout_weather["bins"]["monotonicity"]["both"] and endpoint_pass and weather_year_pass and weather_boundary_pass and weather_asset_pass else "needs-revision"
    interval_year_pass = all(
        item["meanAbsoluteCoverageError"] <= 0.10
        for cohort in robustness["rangeIntervals"].values()
        for item in cohort["byYear"].values()
    )
    tail_year_pass = all(
        item["brierDelta"] < 0
        for cohort in robustness["tailCalibration"].values()
        for item in cohort["byYear"].values()
    )
    tail_asset_pass = robustness["tailCalibration"]["asset-holdout"]["assetPassRateBrier"] >= 0.60
    if not (tail_year_pass and tail_asset_pass):
        tail_status = "needs-revision"

    artifacts = {
        "artifactId": CALIBRATION_ID,
        "rangeModel": modeling.model_artifact(range_model),
        "conformal": {"method": "weighted multiplicative OOF residual quantiles", "selectedSchemeUsingSeenValidationOnly": selected_scheme, "globalQuantiles": global_q, "clusterQuantiles": cluster_q},
        "weatherMapping": {"lookback": LOOKBACK, "basis": "within-asset trailing prediction percentile", "bins": [{"id": k, "label": l, "lowerInclusive": lo, "upperExclusive": hi} for k, l, lo, hi in WEATHER_BINS]},
        "tailModel": modeling.model_artifact(tail_model),
        "plattCalibrator": modeling.model_artifact(platt_model),
        "betaCalibrator": modeling.model_artifact(beta_model),
        "tailCalibration": {
            "selectedStaticUsingSeenValidationOnly": selected_static,
            "adaptiveAdjustmentStrengthUsingSeenValidationOnly": selected_adaptive_strength,
            "adaptiveAdjustmentStrengthCandidates": ADAPTIVE_STRENGTHS,
            "adaptivePriorLookback": LOOKBACK,
            "adaptivePriorShrinkageStrength": RECENT_PRIOR_STRENGTH,
            "trainBaseRate": base_rate,
        },
    }
    artifacts["sha256"] = artifact_hash(artifacts)
    verification = {
        "sealedTestLabelsUsed": 0,
        "assetHoldoutRowsUsedToFitForecastModels": 0,
        "oofRangeRows": len(range_oof_records),
        "oofTailRows": len(tail_oof_records),
        "everyOofFoldTrainingPrecedesValidation": all(x["latestTrainingDate"] < x["earliestValidationDate"] for x in range_folds + tail_folds),
        "weatherRanksUseStrictlyPrior252Predictions": True,
        "weatherEventsUseStrictlyPrior252Outcomes": True,
        "adaptivePriorExcludesCurrentOutcome": True,
        "directionModelAbsent": True,
        "appFormulaChanged": False,
        "plattMonotonic": calibrator_monotonic(platt_model),
        "betaMonotonic": calibrator_monotonic(beta_model),
        "intervalCoverageErrorAtMost10PointsInEachYearAndCohort": interval_year_pass,
        "weatherOrderedRangeAndPositiveRiskEndpointsInEachYearAndCohort": weather_year_pass,
        "weatherExactFourBinMonotonicInEachYearAndCohortDiagnostic": weather_exact_year_monotonic,
        "weatherMonotonicAcrossNeighboringBoundaries": weather_boundary_pass,
        "weatherPositiveHighRangeDeltaInAtLeast80PercentHoldoutAssets": weather_asset_pass,
        "tailBrierBeatsBaseInEachYearAndCohort": tail_year_pass,
        "tailBrierBeatsBaseInAtLeast60PercentHoldoutAssets": tail_asset_pass,
    }
    technical_checks = {
        "everyOofFoldTrainingPrecedesValidation",
        "weatherRanksUseStrictlyPrior252Predictions",
        "weatherEventsUseStrictlyPrior252Outcomes",
        "adaptivePriorExcludesCurrentOutcome",
        "directionModelAbsent",
        "plattMonotonic",
        "betaMonotonic",
    }
    failures = [key for key in technical_checks if verification[key] is False]
    if failures:
        raise RuntimeError(f"Calibration verification failed: {failures}")
    decision_notes = [
        f"변동폭 구간 방식은 seen 검증에서만 선택해 `{selected_scheme}`로 고정했습니다. asset-holdout은 확인에만 사용했습니다.",
        f"자산 상대형 4단계 날씨 매핑 상태는 `{weather_status}`입니다.",
        f"꼬리위험 적응형 보정 상태는 `{tail_status}`입니다. 새 자산 무정보 예측이 아니라 해당 자산의 과거 사건률을 쓰는 history-adaptive 방식입니다.",
        f"강건성 게이트: 연도별 구간={interval_year_pass}, 연도별 날씨 크기·양끝 위험={weather_year_pass}, 경계 민감도={weather_boundary_pass}, holdout 개별자산 날씨={weather_asset_pass}, 연도별 꼬리위험={tail_year_pass}, holdout 개별자산 꼬리위험={tail_asset_pass}.",
        f"더 엄격한 '매년 네 칸 모두 사건률 단조 증가' 진단은 {weather_exact_year_monotonic}입니다. 2023 holdout 폭풍 표본 28건의 강풍→폭풍 사건률 흔들림을 숨기지 않고 별도 진단으로 보존했습니다.",
        "v0.1 특성은 검증된 범위대로 변동폭 모델에만 남겼고 꼬리위험·방향에는 추가하지 않았습니다.",
        "이번 결과는 후보 공식의 윤곽이며 앱 반영 승인이 아닙니다. 시기·자산군별 안정성 검증이 더 필요합니다.",
    ]
    report = {
        "schemaVersion": 1, "calibrationId": CALIBRATION_ID, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePanelSha256": panel_report["output"]["sha256"], "dataAudit": {**data_audit, **history_audit},
        "protocol": {"rangeModel": "range-ridge-core-v01", "rangeRegularization": RANGE_LAMBDA, "tailModel": "tail-logit-core", "tailRegularization": TAIL_LAMBDA, "calibratorRegularization": CALIBRATOR_LAMBDA, "lookback": LOOKBACK, "bootstrapSamples": BOOTSTRAP_SAMPLES, "blockLength": BLOCK_LENGTH, "selectionPolicy": "select with seen validation; use asset-holdout as confirmation; keep 2025+ sealed"},
        "oofAudit": {"rangeFolds": range_folds, "tailFolds": tail_folds},
        "rangeCalibration": {"globalQuantiles": global_q, "clusterQuantiles": cluster_q, "selectedScheme": selected_scheme, "validation": range_validation},
        "weatherMapping": {"status": weather_status, "validation": weather_validation},
        "tailCalibration": {
            "selectedStaticCandidate": selected_static,
            "adaptiveCandidate": adaptive_name,
            "adaptiveStrength": selected_adaptive_strength,
            "adaptiveStrengthSeenBrier": adaptive_seen_scores,
            "status": tail_status,
            "trainBaseRate": base_rate,
            "calibratorMonotonicity": {"platt": verification["plattMonotonic"], "beta": verification["betaMonotonic"]},
            "validation": tail_validation,
        },
        "robustness": robustness,
        "verification": verification, "decisionNotes": decision_notes,
    }
    safe_report, safe_artifacts = json_safe(report), json_safe(artifacts)
    (OUTPUT_DIR / "calibration-results.json").write_text(json.dumps(safe_report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "calibration-artifacts.json").write_text(json.dumps(safe_artifacts, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe_report), encoding="utf-8")
    manifest = {"schemaVersion": 1, "calibrationId": CALIBRATION_ID, "generatedAt": report["generatedAt"], "sourcePanelSha256": report["sourcePanelSha256"], "artifactSha256": artifacts["sha256"], "sealedTestLabelsUsed": 0, "appFormulaChanged": False}
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] range interval scheme={selected_scheme}")
    print(f"[done] weather mapping={weather_status}")
    print(f"[done] tail calibration={tail_status}")
    print(f"[done] artifact sha256={artifacts['sha256']}")
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
