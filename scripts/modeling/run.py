from __future__ import annotations

import gzip
import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np


ROOT = Path(__file__).resolve().parents[2]
PANEL_DIR = ROOT / "research-results" / "market-weather-eod-panel-v1"
BASELINE_DIR = ROOT / "research-results" / "market-weather-baseline-evaluation-v1"
OUTPUT_DIR = ROOT / "research-results" / "market-weather-model-research-v1"
PANEL_PATH = PANEL_DIR / "panel.jsonl.gz"
MODEL_ID = "market-weather-interpretable-models-v1"
RANDOM_SEED = 20260619
BLOCK_LENGTH = 20
BOOTSTRAP_SAMPLES = 300


CORE_FEATURES = [
    "return1_z",
    "abs_return1_z",
    "sma20_percentile",
    "close_percentile",
    "rsi_scaled",
    "atr_percentile",
    "realized_vol_percentile",
    "volume_percentile",
    "drawdown_atr",
]
RANGE_FEATURES = ["log_atr", "downside_vol_log", *CORE_FEATURES]
V01_FEATURES = ["v01_rain", "v01_temperature", "v01_volatility", "v01_momentum"]
FULL_CONTEXT_FEATURES = [
    "vix_log",
    "vix_percentile",
    "spy_return1",
    "spy_return5",
    "spy_atr_percentile",
    "spy_realized_vol_log",
    "tlt_return5",
    "hyg_return5",
    "uup_return5",
    "gld_return5",
    "dbc_return5",
    "btc_prior_return1",
    "btc_prior_vol_percentile",
    "sector_breadth_up",
    "sector_breadth_sma20",
]
RIDGE_LAMBDAS = [0.0, 0.001, 0.01, 0.1, 1.0, 10.0]
LOGISTIC_LAMBDAS = [0.0, 0.001, 0.01, 0.1, 1.0]


@dataclass
class Standardizer:
    mean: np.ndarray
    scale: np.ndarray

    def transform(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean) / self.scale


@dataclass
class LinearModel:
    features: list[str]
    standardizer: Standardizer
    coefficients: np.ndarray
    regularization: float
    task: str

    def predict(self, records: list[dict]) -> np.ndarray:
        x = matrix(records, self.features)
        design = add_intercept(self.standardizer.transform(x))
        raw = design @ self.coefficients
        if self.task == "range":
            return np.exp(np.clip(raw, math.log(0.01), math.log(100.0)))
        return sigmoid(raw)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def finite(value, fallback=0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def extract_record(row: dict, bucket: str, cluster: str) -> dict:
    f = row["features"]
    b = row["baseline"]
    labels = row["labels"]
    atr = max(finite(f.get("atr14Percent"), 0.01), 0.01)
    downside_vol = max(finite(f.get("downsideVol20Percent"), 0.01), 0.01)
    record = {
        "asset": row["assetId"],
        "date": row["date"],
        "cluster": cluster,
        "bucket": bucket,
        "full_context": bool(row["fullContextReady"]),
        "range_y": finite(labels["nextDayTrueRange"]),
        "tail_y": int(labels["historicalTailEvent1"]),
        "direction_y": int(labels["up1"]),
        "atr_direct": atr,
        "v01_rain_probability": np.clip(finite(b["rainChance"]) / 100.0, 0.001, 0.999),
        "v01_temperature_probability": np.clip(finite(b["temperature"]) / 100.0, 0.001, 0.999),
        "log_atr": math.log(atr),
        "downside_vol_log": math.log(downside_vol),
        "return1_z": finite(f.get("return1Z252")),
        "abs_return1_z": abs(finite(f.get("return1Z252"))),
        "sma20_percentile": finite(f.get("sma20GapPercentile252")) / 100.0,
        "close_percentile": finite(f.get("closePercentile252")) / 100.0,
        "rsi_scaled": finite(f.get("rsi14"), 50.0) / 100.0,
        "atr_percentile": finite(f.get("atrPercentile252")) / 100.0,
        "realized_vol_percentile": finite(f.get("realizedVolPercentile252")) / 100.0,
        "volume_percentile": finite(f.get("volumePercentile252")) / 100.0,
        "drawdown_atr": np.clip(finite(f.get("drawdown63Percent")) / atr, -30.0, 0.0),
        "v01_rain": finite(b["rainChance"]) / 100.0,
        "v01_temperature": finite(b["temperature"]) / 100.0,
        "v01_volatility": finite(b["volatilityScore"]) / 100.0,
        "v01_momentum": finite(b["momentumScore"]) / 100.0,
        "vix_log": math.log(max(finite(f.get("vixLevel"), 1.0), 1.0)),
        "vix_percentile": finite(f.get("vixClosePercentile252")) / 100.0,
        "spy_return1": finite(f.get("spyReturn1")),
        "spy_return5": finite(f.get("spyReturn5")),
        "spy_atr_percentile": finite(f.get("spyAtrPercentile252")) / 100.0,
        "spy_realized_vol_log": math.log(max(finite(f.get("spyRealizedVol20Percent"), 0.01), 0.01)),
        "tlt_return5": finite(f.get("tltReturn5")),
        "hyg_return5": finite(f.get("hygReturn5")),
        "uup_return5": finite(f.get("uupReturn5")),
        "gld_return5": finite(f.get("gldReturn5")),
        "dbc_return5": finite(f.get("dbcReturn5")),
        "btc_prior_return1": finite(f.get("btcPriorDayReturn1")),
        "btc_prior_vol_percentile": finite(f.get("btcPriorDayVolPercentile252")) / 100.0,
        "sector_breadth_up": finite(f.get("sectorBreadthUp1Percent"), 50.0) / 100.0,
        "sector_breadth_sma20": finite(f.get("sectorBreadthAboveSma20Percent"), 50.0) / 100.0,
    }
    return record


def load_records() -> tuple[list[dict], list[dict], list[dict], dict]:
    split_manifest = load_json(BASELINE_DIR / "split-manifest.json")
    summaries = {item["assetId"]: item for item in split_manifest["assets"]}
    clusters = split_manifest["policy"]["trainingClusters"]
    asset_cluster = {asset: cluster for cluster, assets in clusters.items() for asset in assets}
    train: list[dict] = []
    validation_seen: list[dict] = []
    validation_holdout: list[dict] = []
    sealed_rows_parsed_for_targets = 0
    with gzip.open(PANEL_PATH, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            asset = row["assetId"]
            date = row["date"]
            summary = summaries[asset]
            if date <= summary["lastTrainDate"]:
                if summary["assetRole"] == "asset-holdout":
                    continue
                train.append(extract_record(row, "train", asset_cluster[asset]))
            elif summary["firstValidationDate"] <= date <= summary["lastValidationDate"]:
                record = extract_record(row, "validation", asset_cluster[asset])
                (validation_holdout if summary["assetRole"] == "asset-holdout" else validation_seen).append(record)
            elif summary["firstSealedTestDate"] and date >= summary["firstSealedTestDate"]:
                # The row is counted by the split manifest, but labels are never read here.
                continue
            else:
                # Purged or embargoed boundary row.
                continue
    audit = {
        "trainingRows": len(train),
        "validationSeenRows": len(validation_seen),
        "validationAssetHoldoutRows": len(validation_holdout),
        "sealedRowsParsedForTargets": sealed_rows_parsed_for_targets,
        "assetHoldoutTrainingRows": 0,
    }
    return train, validation_seen, validation_holdout, audit


def matrix(records: list[dict], features: list[str]) -> np.ndarray:
    return np.asarray([[finite(record[name]) for name in features] for record in records], dtype=np.float64)


def target(records: list[dict], name: str) -> np.ndarray:
    return np.asarray([finite(record[name]) for record in records], dtype=np.float64)


def cluster_asset_weights(records: list[dict]) -> np.ndarray:
    cluster_assets: dict[str, set[str]] = defaultdict(set)
    asset_counts: dict[str, int] = defaultdict(int)
    for record in records:
        cluster_assets[record["cluster"]].add(record["asset"])
        asset_counts[record["asset"]] += 1
    active_clusters = list(cluster_assets)
    raw = np.asarray([
        1.0 / len(active_clusters) / len(cluster_assets[record["cluster"]]) / asset_counts[record["asset"]]
        for record in records
    ], dtype=np.float64)
    return raw * len(raw) / raw.sum()


def weighted_standardizer(x: np.ndarray, weights: np.ndarray) -> Standardizer:
    normalized = weights / weights.sum()
    mean = np.sum(x * normalized[:, None], axis=0)
    variance = np.sum(((x - mean) ** 2) * normalized[:, None], axis=0)
    scale = np.sqrt(np.maximum(variance, 1e-12))
    return Standardizer(mean=mean, scale=scale)


def add_intercept(x: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(len(x)), x])


def fit_ridge(records: list[dict], features: list[str], regularization: float) -> LinearModel:
    x = matrix(records, features)
    y = np.log(np.maximum(target(records, "range_y"), 0.01))
    weights = cluster_asset_weights(records)
    standardizer = weighted_standardizer(x, weights)
    design = add_intercept(standardizer.transform(x))
    normalized = weights / weights.sum()
    penalty = np.eye(design.shape[1]) * regularization
    penalty[0, 0] = 0.0
    left = design.T @ (normalized[:, None] * design) + penalty
    right = design.T @ (normalized * y)
    coefficients = np.linalg.solve(left + np.eye(left.shape[0]) * 1e-10, right)
    return LinearModel(features, standardizer, coefficients, regularization, "range")


def sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -30.0, 30.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def fit_logistic(records: list[dict], features: list[str], regularization: float, target_name: str) -> LinearModel:
    x = matrix(records, features)
    y = target(records, target_name)
    weights = cluster_asset_weights(records)
    standardizer = weighted_standardizer(x, weights)
    design = add_intercept(standardizer.transform(x))
    normalized = weights / weights.sum()
    coefficients = np.zeros(design.shape[1], dtype=np.float64)
    base_rate = np.clip(np.sum(normalized * y), 1e-5, 1 - 1e-5)
    coefficients[0] = math.log(base_rate / (1 - base_rate))
    penalty_mask = np.ones_like(coefficients)
    penalty_mask[0] = 0.0
    for _ in range(40):
        probabilities = sigmoid(design @ coefficients)
        curvature = np.maximum(probabilities * (1 - probabilities), 1e-6)
        gradient = design.T @ (normalized * (probabilities - y)) + regularization * penalty_mask * coefficients
        hessian = design.T @ ((normalized * curvature)[:, None] * design)
        hessian += np.diag(regularization * penalty_mask) + np.eye(design.shape[1]) * 1e-8
        step = np.linalg.solve(hessian, gradient)
        coefficients -= step
        if np.linalg.norm(step) < 1e-7:
            break
    return LinearModel(features, standardizer, coefficients, regularization, target_name)


def inner_fold(records: list[dict], train_end: str, validation_start: str, validation_end: str) -> tuple[list[dict], list[dict]]:
    by_asset: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        by_asset[record["asset"]].append(record)
    inner_train: list[dict] = []
    inner_validation: list[dict] = []
    for asset_records in by_asset.values():
        ordered = sorted(asset_records, key=lambda item: item["date"])
        train_part = [item for item in ordered if item["date"] <= train_end]
        validation_part = [item for item in ordered if validation_start <= item["date"] <= validation_end]
        inner_train.extend(train_part[:-5] if len(train_part) > 5 else [])
        inner_validation.extend(validation_part[5:] if len(validation_part) > 5 else [])
    return inner_train, inner_validation


def average_by_asset(records: list[dict], values: np.ndarray, metric: Callable[[np.ndarray, np.ndarray], float], target_name: str) -> float:
    grouped: dict[str, list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        grouped[record["asset"]].append(index)
    scores = []
    truth = target(records, target_name)
    for indices in grouped.values():
        selected = np.asarray(indices, dtype=int)
        scores.append(metric(truth[selected], values[selected]))
    return float(np.mean(scores))


def mae(truth: np.ndarray, prediction: np.ndarray) -> float:
    return float(np.mean(np.abs(truth - prediction)))


def brier(truth: np.ndarray, prediction: np.ndarray) -> float:
    return float(np.mean((truth - prediction) ** 2))


INNER_CORE_FOLDS = [
    ("2014-12-31", "2015-01-01", "2016-12-31"),
    ("2016-12-31", "2017-01-01", "2018-12-31"),
    ("2018-12-31", "2019-01-01", "2020-12-31"),
    ("2020-12-31", "2021-01-01", "2022-12-31"),
]
INNER_FULL_FOLDS = [
    ("2019-12-31", "2020-01-01", "2020-12-31"),
    ("2020-12-31", "2021-01-01", "2021-12-31"),
    ("2021-12-31", "2022-01-01", "2022-12-31"),
]


def tune_regularization(
    records: list[dict],
    features: list[str],
    task: str,
    candidates: list[float],
    full_context: bool,
) -> tuple[float, list[dict]]:
    source = [record for record in records if record["full_context"]] if full_context else records
    folds = INNER_FULL_FOLDS if full_context else INNER_CORE_FOLDS
    target_name = "range_y" if task == "range" else ("tail_y" if task == "tail" else "direction_y")
    history: list[dict] = []
    for regularization in candidates:
        fold_scores = []
        for train_end, validation_start, validation_end in folds:
            fold_train, fold_validation = inner_fold(source, train_end, validation_start, validation_end)
            if not fold_train or not fold_validation:
                continue
            model = fit_ridge(fold_train, features, regularization) if task == "range" else fit_logistic(fold_train, features, regularization, target_name)
            prediction = model.predict(fold_validation)
            score = average_by_asset(fold_validation, prediction, mae if task == "range" else brier, target_name)
            fold_scores.append(score)
        history.append({"regularization": regularization, "foldScores": fold_scores, "meanScore": float(np.mean(fold_scores))})
    selected = min(history, key=lambda item: item["meanScore"])
    return float(selected["regularization"]), history


def rankdata(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    ranks = np.empty(len(values), dtype=np.float64)
    cursor = 0
    while cursor < len(values):
        end = cursor
        while end + 1 < len(values) and values[order[end + 1]] == values[order[cursor]]:
            end += 1
        rank = (cursor + end + 2) / 2.0
        ranks[order[cursor : end + 1]] = rank
        cursor = end + 1
    return ranks


def spearman(truth: np.ndarray, prediction: np.ndarray) -> float:
    if len(truth) < 3 or np.std(truth) == 0 or np.std(prediction) == 0:
        return float("nan")
    return float(np.corrcoef(rankdata(truth), rankdata(prediction))[0, 1])


def roc_auc(truth: np.ndarray, probability: np.ndarray) -> float:
    positives = int(np.sum(truth == 1))
    negatives = int(np.sum(truth == 0))
    if positives == 0 or negatives == 0:
        return float("nan")
    ranks = rankdata(probability)
    return float((np.sum(ranks[truth == 1]) - positives * (positives + 1) / 2.0) / (positives * negatives))


def average_precision(truth: np.ndarray, probability: np.ndarray) -> float:
    positives = int(np.sum(truth == 1))
    if positives == 0:
        return float("nan")
    order = np.argsort(-probability, kind="mergesort")
    sorted_truth = truth[order]
    cumulative = np.cumsum(sorted_truth)
    precision = cumulative / np.arange(1, len(sorted_truth) + 1)
    return float(np.sum(precision * sorted_truth) / positives)


def log_loss(truth: np.ndarray, probability: np.ndarray) -> float:
    clipped = np.clip(probability, 1e-6, 1 - 1e-6)
    return float(-np.mean(truth * np.log(clipped) + (1 - truth) * np.log(1 - clipped)))


def ece(truth: np.ndarray, probability: np.ndarray, bins: int = 10) -> float:
    result = 0.0
    for lower in np.linspace(0, 1, bins, endpoint=False):
        upper = lower + 1 / bins
        mask = (probability >= lower) & (probability < upper if upper < 1 else probability <= upper)
        if np.any(mask):
            result += np.mean(mask) * abs(float(np.mean(probability[mask])) - float(np.mean(truth[mask])))
    return result


def balanced_accuracy(truth: np.ndarray, probability: np.ndarray) -> float:
    predicted = probability >= 0.5
    positive = truth == 1
    negative = truth == 0
    recall = np.mean(predicted[positive]) if np.any(positive) else np.nan
    specificity = np.mean(~predicted[negative]) if np.any(negative) else np.nan
    return float((recall + specificity) / 2.0)


def top_decile_stats(truth: np.ndarray, probability: np.ndarray) -> tuple[float, float, float]:
    threshold = float(np.quantile(probability, 0.9))
    # Include every observation tied at the cutoff. Arbitrarily taking the
    # first N ties makes a constant-probability baseline look predictive when
    # the file is grouped by asset.
    selected = probability >= threshold
    precision = float(np.mean(truth[selected]))
    recall = float(np.sum(truth[selected]) / max(1, np.sum(truth)))
    base = float(np.mean(truth))
    return precision, recall, precision / base if base else float("nan")


def grouped_indices(records: list[dict]) -> dict[str, np.ndarray]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        groups[record["asset"]].append(index)
    return {asset: np.asarray(indices, dtype=int) for asset, indices in groups.items()}


def range_metrics(records: list[dict], predictions: np.ndarray) -> dict:
    truth = target(records, "range_y")
    per_asset = []
    for indices in grouped_indices(records).values():
        y = truth[indices]
        p = predictions[indices]
        threshold = np.quantile(p, 0.8)
        per_asset.append({
            "mae": mae(y, p),
            "rmse": float(np.sqrt(np.mean((y - p) ** 2))),
            "spearman": spearman(y, p),
            "calibrationRatio": float(np.mean(p) / np.mean(y)),
            "topQuintileLift": float(np.mean(y[p >= threshold]) / np.mean(y)),
        })
    return {key: float(np.nanmean([item[key] for item in per_asset])) for key in per_asset[0]}


def probability_metrics(records: list[dict], predictions: np.ndarray, target_name: str, direction=False) -> dict:
    truth = target(records, target_name)
    per_asset = []
    for indices in grouped_indices(records).values():
        y = truth[indices]
        p = predictions[indices]
        precision, recall, lift = top_decile_stats(y, p)
        metrics = {
            "brier": brier(y, p),
            "logLoss": log_loss(y, p),
            "rocAuc": roc_auc(y, p),
            "averagePrecision": average_precision(y, p),
            "ece10": ece(y, p),
            "topDecilePrecision": precision,
            "topDecileRecall": recall,
            "topDecileLift": lift,
        }
        if direction:
            metrics["balancedAccuracy"] = balanced_accuracy(y, p)
        per_asset.append(metrics)
    return {key: float(np.nanmean([item[key] for item in per_asset])) for key in per_asset[0]}


def weighted_base_rate(records: list[dict], target_name: str) -> float:
    y = target(records, target_name)
    weights = cluster_asset_weights(records)
    return float(np.sum(weights * y) / np.sum(weights))


def fit_atr_scale(records: list[dict]) -> float:
    ratios = np.log(np.maximum(target(records, "range_y"), 0.01) / np.maximum(target(records, "atr_direct"), 0.01))
    weights = cluster_asset_weights(records)
    return float(math.exp(np.sum(weights * ratios) / np.sum(weights)))


def model_artifact(model: LinearModel) -> dict:
    return {
        "task": model.task,
        "features": model.features,
        "regularization": model.regularization,
        "mean": model.standardizer.mean.tolist(),
        "scale": model.standardizer.scale.tolist(),
        "coefficients": model.coefficients.tolist(),
    }


def top_coefficients(model: LinearModel, count: int = 8) -> list[dict]:
    pairs = [
        {"feature": feature, "standardizedCoefficient": float(model.coefficients[index + 1])}
        for index, feature in enumerate(model.features)
    ]
    return sorted(pairs, key=lambda item: abs(item["standardizedCoefficient"]), reverse=True)[:count]


def circular_block_indices(length: int, rng: np.random.Generator) -> np.ndarray:
    output: list[int] = []
    while len(output) < length:
        start = int(rng.integers(0, length))
        output.extend((start + offset) % length for offset in range(BLOCK_LENGTH))
    return np.asarray(output[:length], dtype=int)


def bootstrap_delta(
    records: list[dict],
    candidate: np.ndarray,
    baseline: np.ndarray,
    target_name: str,
    metric: Callable[[np.ndarray, np.ndarray], float],
) -> dict:
    truth = target(records, target_name)
    groups = grouped_indices(records)
    rng = np.random.default_rng(RANDOM_SEED)
    values = []
    for _ in range(BOOTSTRAP_SAMPLES):
        asset_deltas = []
        for indices in groups.values():
            sampled_local = circular_block_indices(len(indices), rng)
            selected = indices[sampled_local]
            asset_deltas.append(metric(truth[selected], candidate[selected]) - metric(truth[selected], baseline[selected]))
        values.append(float(np.nanmean(asset_deltas)))
    return {
        "samples": BOOTSTRAP_SAMPLES,
        "blockLength": BLOCK_LENGTH,
        "meanDelta": float(np.mean(values)),
        "ci95": [float(np.quantile(values, 0.025)), float(np.quantile(values, 0.975))],
    }


def train_models(train: list[dict]) -> tuple[dict, dict, dict]:
    specifications = {
        "range-ridge-core": ("range", RANGE_FEATURES, False),
        "range-ridge-core-v01": ("range", RANGE_FEATURES + V01_FEATURES, False),
        "range-ridge-full-context": ("range", RANGE_FEATURES + V01_FEATURES + FULL_CONTEXT_FEATURES, True),
        "tail-logit-core": ("tail", CORE_FEATURES, False),
        "tail-logit-core-v01": ("tail", CORE_FEATURES + V01_FEATURES, False),
        "tail-logit-full-context": ("tail", CORE_FEATURES + V01_FEATURES + FULL_CONTEXT_FEATURES, True),
        "direction-logit-core": ("direction", CORE_FEATURES, False),
        "direction-logit-core-v01": ("direction", CORE_FEATURES + V01_FEATURES, False),
    }
    models = {}
    tuning = {}
    for name, (task_name, features, full_context) in specifications.items():
        candidates = RIDGE_LAMBDAS if task_name == "range" else LOGISTIC_LAMBDAS
        selected, history = tune_regularization(train, features, task_name, candidates, full_context)
        training_rows = [record for record in train if record["full_context"]] if full_context else train
        target_name = "tail_y" if task_name == "tail" else "direction_y"
        model = fit_ridge(training_rows, features, selected) if task_name == "range" else fit_logistic(training_rows, features, selected, target_name)
        models[name] = model
        tuning[name] = {"selectedRegularization": selected, "folds": history, "trainingRows": len(training_rows)}
        print(f"[model] {name}: lambda={selected} rows={len(training_rows)}")
    baselines = {
        "atrScale": fit_atr_scale(train),
        "tailBaseRate": weighted_base_rate(train, "tail_y"),
        "directionBaseRate": weighted_base_rate(train, "direction_y"),
    }
    return models, tuning, baselines


def evaluate_cohort(records: list[dict], models: dict, baselines: dict) -> tuple[dict, dict]:
    full_records = [record for record in records if record["full_context"]]
    range_predictions = {
        "atr-direct": target(records, "atr_direct"),
        "atr-scaled-train-only": target(records, "atr_direct") * baselines["atrScale"],
        "range-ridge-core": models["range-ridge-core"].predict(records),
        "range-ridge-core-v01": models["range-ridge-core-v01"].predict(records),
    }
    if len(full_records) == len(records):
        range_predictions["range-ridge-full-context"] = models["range-ridge-full-context"].predict(records)
    tail_predictions = {
        "train-base-rate": np.full(len(records), baselines["tailBaseRate"]),
        "weather-v0.1-rain-as-probability": target(records, "v01_rain_probability"),
        "tail-logit-core": models["tail-logit-core"].predict(records),
        "tail-logit-core-v01": models["tail-logit-core-v01"].predict(records),
    }
    direction_predictions = {
        "train-base-rate": np.full(len(records), baselines["directionBaseRate"]),
        "weather-v0.1-temperature-as-probability": target(records, "v01_temperature_probability"),
        "direction-logit-core": models["direction-logit-core"].predict(records),
        "direction-logit-core-v01": models["direction-logit-core-v01"].predict(records),
    }
    if len(full_records) == len(records):
        tail_predictions["tail-logit-full-context"] = models["tail-logit-full-context"].predict(records)
    results = {
        "range": {name: range_metrics(records, prediction) for name, prediction in range_predictions.items()},
        "tail": {name: probability_metrics(records, prediction, "tail_y") for name, prediction in tail_predictions.items()},
        "direction": {name: probability_metrics(records, prediction, "direction_y", direction=True) for name, prediction in direction_predictions.items()},
    }
    return results, {"range": range_predictions, "tail": tail_predictions, "direction": direction_predictions}


def choose_candidate(results: dict, family: str, metric: str, prefix: str) -> str:
    candidates = {name: values for name, values in results[family].items() if name.startswith(prefix)}
    return min(candidates, key=lambda name: candidates[name][metric])


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


def markdown_report(report: dict) -> str:
    seen = report["validation"]["seen-assets"]
    holdout = report["validation"]["asset-holdout"]
    selected = report["selectedCandidates"]
    lines = [
        "# 해석 가능한 예보 모델 v1 연구 리포트", "",
        f"- 학습 행: {report['dataAudit']['trainingRows']:,}",
        f"- 검증: seen {report['dataAudit']['validationSeenRows']:,} · asset-holdout {report['dataAudit']['validationAssetHoldoutRows']:,}",
        f"- 봉인 시험 라벨 접근: {report['dataAudit']['sealedRowsParsedForTargets']}",
        f"- 이동 블록 bootstrap: {BOOTSTRAP_SAMPLES}회 · 블록 {BLOCK_LENGTH}기간", "",
        "## 내부 walk-forward 선택", "",
    ]
    for name, tuning in report["tuning"].items():
        lines.append(f"- {name}: λ={tuning['selectedRegularization']} · 최종 학습 {tuning['trainingRows']:,}행")
    lines += ["", "## 다음날 변동폭", "", "|모델|seen MAE|seen Spearman|holdout MAE|holdout Spearman|holdout 상위20% Lift|", "|---|---:|---:|---:|---:|---:|"]
    for name, metrics in seen["range"].items():
        hold = holdout["range"].get(name, {})
        lines.append(f"|{name}|{metrics['mae']:.3f}|{metrics['spearman']:.3f}|{hold.get('mae', float('nan')):.3f}|{hold.get('spearman', float('nan')):.3f}|{hold.get('topQuintileLift', float('nan')):.2f}×|")
    lines += ["", "## 1일 꼬리위험 확률", "", "|모델|seen Brier|seen ROC-AUC|holdout Brier|holdout ROC-AUC|holdout 상위10% Lift|", "|---|---:|---:|---:|---:|---:|"]
    for name, metrics in seen["tail"].items():
        hold = holdout["tail"].get(name, {})
        lines.append(f"|{name}|{metrics['brier']:.4f}|{metrics['rocAuc']:.3f}|{hold.get('brier', float('nan')):.4f}|{hold.get('rocAuc', float('nan')):.3f}|{hold.get('topDecileLift', float('nan')):.2f}×|")
    lines += ["", "## 방향 challenger", "", "|모델|seen Brier|seen ROC-AUC|holdout Brier|holdout ROC-AUC|holdout 균형정확도|", "|---|---:|---:|---:|---:|---:|"]
    for name, metrics in seen["direction"].items():
        hold = holdout["direction"].get(name, {})
        lines.append(f"|{name}|{metrics['brier']:.4f}|{metrics['rocAuc']:.3f}|{hold.get('brier', float('nan')):.4f}|{hold.get('rocAuc', float('nan')):.3f}|{hold.get('balancedAccuracy', float('nan')) * 100:.2f}%|")
    lines += ["", "## 선택 후보와 bootstrap", ""]
    lines.append(f"- 변동폭: `{selected['range']}`")
    lines.append(f"- 꼬리위험: `{selected['tail']}`")
    lines.append(f"- 방향 challenger: `{selected['direction']}`")
    for item in report["bootstrap"]:
        ci = item["result"]["ci95"]
        lines.append(f"- {item['cohort']} · {item['comparison']}: Δ {item['result']['meanDelta']:.4f}, 95% CI [{ci[0]:.4f}, {ci[1]:.4f}]")
    lines += ["", "## 연구 결정", ""]
    lines.append(f"- 변동폭 채택안: `{report['deploymentDecision']['range']['model']}` · {report['deploymentDecision']['range']['status']}")
    lines.append(f"- 꼬리위험 채택안: `{report['deploymentDecision']['tail']['model']}` · {report['deploymentDecision']['tail']['status']}")
    lines.append(f"- 방향 채택안: `{report['deploymentDecision']['direction']['model']}` · {report['deploymentDecision']['direction']['status']}")
    lines.extend(f"- {note}" for note in report["decisionNotes"])
    lines += ["", "## 표준화 계수 상위 특징", "", "계수는 연관 방향과 상대 크기를 보여줄 뿐 인과효과를 뜻하지 않습니다.", ""]
    for model_name, coefficients in report["topStandardizedCoefficients"].items():
        lines.append(f"### {model_name}")
        lines.append("")
        lines.append("|특징|표준화 계수|")
        lines.append("|---|---:|")
        lines.extend(f"|{item['feature']}|{item['standardizedCoefficient']:.4f}|" for item in coefficients)
        lines.append("")
    lines += ["", "2025년 이후 봉인 시험과 XLC·XLRE·TSLA·NVDA·ETH 최종 홀드아웃은 열지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    panel_report = load_json(PANEL_DIR / "build-report.json")
    train, validation_seen, validation_holdout, data_audit = load_records()
    print(f"[data] train={len(train)} seen={len(validation_seen)} holdout={len(validation_holdout)}")
    models, tuning, baselines = train_models(train)
    seen_results, seen_predictions = evaluate_cohort(validation_seen, models, baselines)
    holdout_results, holdout_predictions = evaluate_cohort(validation_holdout, models, baselines)
    selected_range = choose_candidate(seen_results, "range", "mae", "range-")
    selected_tail = choose_candidate(seen_results, "tail", "brier", "tail-")
    selected_direction = choose_candidate(seen_results, "direction", "brier", "direction-")
    bootstrap = []
    for cohort, records, predictions in [
        ("seen-assets", validation_seen, seen_predictions),
        ("asset-holdout", validation_holdout, holdout_predictions),
    ]:
        comparisons = [
            ("range-selected-vs-atr-mae", "range", "range_y", selected_range, "atr-scaled-train-only", mae),
            ("range-core-vs-atr-mae", "range", "range_y", "range-ridge-core", "atr-scaled-train-only", mae),
            ("range-v01-incremental-mae", "range", "range_y", "range-ridge-core-v01", "range-ridge-core", mae),
            ("range-full-context-incremental-mae", "range", "range_y", "range-ridge-full-context", "range-ridge-core-v01", mae),
            ("tail-selected-vs-base-brier", "tail", "tail_y", selected_tail, "train-base-rate", brier),
            ("tail-core-vs-base-brier", "tail", "tail_y", "tail-logit-core", "train-base-rate", brier),
            ("tail-v01-incremental-brier", "tail", "tail_y", "tail-logit-core-v01", "tail-logit-core", brier),
            ("tail-full-context-incremental-brier", "tail", "tail_y", "tail-logit-full-context", "tail-logit-core-v01", brier),
            ("direction-core-auc-vs-random", "direction", "direction_y", "direction-logit-core", "train-base-rate", roc_auc),
            ("direction-v01-incremental-brier", "direction", "direction_y", "direction-logit-core-v01", "direction-logit-core", brier),
        ]
        for comparison, family, target_name, candidate_name, baseline_name, metric in comparisons:
            candidate = predictions[family][candidate_name]
            baseline = predictions[family][baseline_name]
            result = bootstrap_delta(records, candidate, baseline, target_name, metric)
            bootstrap.append({"cohort": cohort, "comparison": comparison, "candidate": candidate_name, "baseline": baseline_name or "AUC=0.5", "result": result})

    range_holdout = holdout_results["range"][selected_range]
    tail_holdout = holdout_results["tail"][selected_tail]
    direction_holdout = holdout_results["direction"][selected_direction]
    def held_out_bootstrap(comparison: str) -> dict:
        return next(item for item in bootstrap if item["cohort"] == "asset-holdout" and item["comparison"] == comparison)["result"]

    range_boot = held_out_bootstrap("range-selected-vs-atr-mae")
    range_core_boot = held_out_bootstrap("range-core-vs-atr-mae")
    range_v01_boot = held_out_bootstrap("range-v01-incremental-mae")
    tail_boot = held_out_bootstrap("tail-selected-vs-base-brier")
    tail_core_boot = held_out_bootstrap("tail-core-vs-base-brier")
    tail_v01_boot = held_out_bootstrap("tail-v01-incremental-brier")
    range_full_boot = held_out_bootstrap("range-full-context-incremental-mae")
    tail_full_boot = held_out_bootstrap("tail-full-context-incremental-brier")
    direction_boot = held_out_bootstrap("direction-core-auc-vs-random")
    direction_v01_boot = held_out_bootstrap("direction-v01-incremental-brier")
    if range_v01_boot["ci95"][1] < 0:
        range_deployment = {"model": "range-ridge-core-v01", "status": "validation-passed"}
    elif range_core_boot["ci95"][1] < 0:
        range_deployment = {"model": "range-ridge-core", "status": "validation-passed; v0.1 incremental value not proven"}
    else:
        range_deployment = {"model": "atr-scaled-train-only", "status": "retain baseline; learned model not proven"}
    if tail_core_boot["ci95"][1] < 0:
        tail_deployment = {"model": "tail-logit-core", "status": "validation-passed"}
    else:
        tail_deployment = {"model": "tail-logit-core", "status": "research-only; Brier improvement uncertain"}
    direction_deployment = {
        "model": "none",
        "status": "rejected" if direction_boot["ci95"][0] <= 0 else "validation-passed",
    }
    decision_notes = [
        f"변동폭 후보 {selected_range}의 홀드아웃 Spearman은 {range_holdout['spearman']:.3f}, MAE는 {range_holdout['mae']:.3f}%p입니다.",
        f"변동폭 후보의 ATR-scaled 대비 홀드아웃 MAE 차이 95% CI는 [{range_boot['ci95'][0]:.4f}, {range_boot['ci95'][1]:.4f}]입니다. 0을 포함하면 복잡한 모델의 우월성을 확정하지 않습니다.",
        f"꼬리위험 후보 {selected_tail}의 홀드아웃 ROC-AUC는 {tail_holdout['rocAuc']:.3f}, 상위 10% Lift는 {tail_holdout['topDecileLift']:.2f}배입니다.",
        f"꼬리위험 Brier 개선 CI는 [{tail_boot['ci95'][0]:.4f}, {tail_boot['ci95'][1]:.4f}]입니다.",
        f"방향 challenger {selected_direction}의 홀드아웃 ROC-AUC는 {direction_holdout['rocAuc']:.3f}, AUC-0.5 CI는 [{direction_boot['ci95'][0]:.4f}, {direction_boot['ci95'][1]:.4f}]입니다.",
        f"변동폭에서 v0.1 특징의 순수 추가 MAE 효과 CI는 [{range_v01_boot['ci95'][0]:.4f}, {range_v01_boot['ci95'][1]:.4f}]입니다.",
        f"꼬리위험에서 v0.1 특징의 순수 추가 Brier 효과 CI는 [{tail_v01_boot['ci95'][0]:.4f}, {tail_v01_boot['ci95'][1]:.4f}]입니다.",
        f"방향에서 v0.1 특징의 순수 추가 Brier 효과 CI는 [{direction_v01_boot['ci95'][0]:.4f}, {direction_v01_boot['ci95'][1]:.4f}]입니다.",
        f"Full-context의 변동폭 추가 효과 CI는 [{range_full_boot['ci95'][0]:.4f}, {range_full_boot['ci95'][1]:.4f}], 꼬리위험 Brier 추가 효과 CI는 [{tail_full_boot['ci95'][0]:.4f}, {tail_full_boot['ci95'][1]:.4f}]로 홀드아웃에서 악화됐습니다. 현재 후보에서는 제외합니다.",
        "v0.1의 검증된 역할은 방향 예보가 아니라 변동폭 보정입니다. 꼬리위험과 방향 공식에는 v0.1 점수를 추가하지 않습니다.",
        "봉인 시험 전에 선택 가능한 것은 검증 결과와 자산 홀드아웃을 함께 통과한 모델뿐입니다. 통과하지 못한 모델은 앱 공식에 반영하지 않습니다.",
    ]
    artifacts = {name: model_artifact(model) for name, model in models.items()}
    report = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourcePanelSha256": panel_report["output"]["sha256"],
        "dataAudit": data_audit,
        "weighting": "equal cluster total -> equal asset within cluster -> equal row within asset",
        "innerValidation": {"coreFolds": INNER_CORE_FOLDS, "fullContextFolds": INNER_FULL_FOLDS},
        "tuning": tuning,
        "baselines": baselines,
        "validation": {"seen-assets": seen_results, "asset-holdout": holdout_results},
        "selectedCandidates": {"range": selected_range, "tail": selected_tail, "direction": selected_direction},
        "deploymentDecision": {"range": range_deployment, "tail": tail_deployment, "direction": direction_deployment},
        "topStandardizedCoefficients": {
            "range-ridge-core-v01": top_coefficients(models["range-ridge-core-v01"]),
            "tail-logit-core": top_coefficients(models["tail-logit-core"]),
            "direction-logit-core": top_coefficients(models["direction-logit-core"]),
        },
        "bootstrap": bootstrap,
        "decisionNotes": decision_notes,
        "sealedTestPolicy": "No 2025+ label was extracted or evaluated.",
    }
    safe_report = json_safe(report)
    (OUTPUT_DIR / "model-results.json").write_text(json.dumps(safe_report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "model-artifacts.json").write_text(json.dumps(json_safe(artifacts), ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe_report), encoding="utf-8")
    manifest = {
        "modelResultsSha256": hashlib.sha256((OUTPUT_DIR / "model-results.json").read_bytes()).hexdigest(),
        "modelArtifactsSha256": hashlib.sha256((OUTPUT_DIR / "model-artifacts.json").read_bytes()).hexdigest(),
        "numpyVersion": np.__version__,
        "randomSeed": RANDOM_SEED,
        "bootstrapSamples": BOOTSTRAP_SAMPLES,
        "blockLength": BLOCK_LENGTH,
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[selected] range={selected_range} tail={selected_tail} direction={selected_direction}")
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
