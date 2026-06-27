from __future__ import annotations

import gzip
import importlib.util
import json
import math
import sys
from collections import defaultdict
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


shadow = load_module("market_weather_v2_validation_shadow", ROOT / "scripts" / "shadow" / "run.py")

OUTPUT_DIR = ROOT / "research-results" / "market-weather-v2-validation-v1"
TRANSFER_PANEL = ROOT / "research-results" / "market-weather-transfer-panel-v1" / "panel.jsonl.gz"
MODEL_PATH = ROOT / "research-results" / "market-weather-shadow-v1" / "frozen-model.json"
SPLIT_PATH = ROOT / "research-results" / "market-weather-baseline-evaluation-v1" / "split-manifest.json"
BLOCK_LENGTH = 20
BOOTSTRAP_SAMPLES = 300
RANDOM_SEED = 20260621
GRADE_ORDER = ["quiet", "normal", "strong", "storm"]
GRADE_LABELS = {"quiet": "고요", "normal": "보통", "strong": "강풍", "storm": "폭풍"}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def finite(value):
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.ndarray):
        return [finite(item) for item in value.tolist()]
    if isinstance(value, dict):
        return {key: finite(item) for key, item in value.items()}
    if isinstance(value, list):
        return [finite(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def grade(percentile: float) -> str:
    if percentile < 25:
        return "quiet"
    if percentile < 75:
        return "normal"
    if percentile < 90:
        return "strong"
    return "storm"


def safe_div(numerator: float, denominator: float):
    return float(numerator / denominator) if denominator else None


def mean(values):
    clean = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return float(np.mean(clean)) if clean else None


def percentile_interval(values):
    clean = np.asarray([value for value in values if value is not None and math.isfinite(float(value))], dtype=np.float64)
    if len(clean) == 0:
        return [None, None]
    return [float(np.quantile(clean, 0.025)), float(np.quantile(clean, 0.975))]


def wilson(successes: int, total: int):
    if total == 0:
        return [None, None]
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    radius = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0.0, center - radius), min(1.0, center + radius)]


def load_histories(split: dict):
    main_history, training = shadow.load_main_history(split)
    summaries = {item["assetId"]: item for item in split["assets"]}
    roles = {asset: ("seen-assets" if item["assetRole"] == "development" else "asset-holdout") for asset, item in summaries.items()}
    starts = {asset: item["firstSealedTestDate"] for asset, item in summaries.items()}
    transfer_history = []
    with gzip.open(TRANSFER_PANEL, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            record = modeling.extract_record(row, "v2-validation-transfer", shadow.TRANSFER_CLUSTERS[row["assetId"]])
            record["role"] = "locked-transfer-holdout"
            transfer_history.append(record)
    us_start = summaries["SPY"]["firstSealedTestDate"]
    crypto_start = summaries["BTCUSDT"]["firstSealedTestDate"]
    for asset in shadow.TRANSFER_CLUSTERS:
        roles[asset] = "transfer-holdout"
        starts[asset] = crypto_start if asset.endswith("USDT") else us_start
    return sorted([*main_history, *transfer_history], key=lambda row: (row["asset"], row["date"])), training, roles, starts


def build_evaluation_rows(history: list[dict], starts: dict, model, artifact: dict, atr_scale: float):
    by_asset = defaultdict(list)
    for item in history:
        by_asset[item["asset"]].append(item)
    output = []
    global_q = artifact["interval"]["globalCausalOofQuantiles"]
    for asset, records in sorted(by_asset.items()):
        records = sorted(records, key=lambda row: row["date"])
        predictions = model.predict(records)
        for index, (record, prediction) in enumerate(zip(records, predictions)):
            if record["date"] < starts[asset] or index < 252:
                continue
            prior_records = records[index - 252:index]
            prior_predictions = predictions[index - 252:index]
            prior_ranges = np.asarray([item["range_y"] for item in prior_records], dtype=np.float64)
            ratios = prior_ranges / np.maximum(prior_predictions, 0.01)
            local_q = shadow.quantiles(ratios.tolist())
            q = shadow.blend(global_q, local_q, len(ratios))
            predicted_percentile = 100 * float(np.mean(prior_predictions <= prediction))
            actual_percentile = 100 * float(np.mean(prior_ranges <= record["range_y"]))
            predicted_grade, actual_grade = grade(predicted_percentile), grade(actual_percentile)
            interval50 = [float(prediction * q["q25"]), float(prediction * q["q75"])]
            interval80 = [float(prediction * q["q10"]), float(prediction * q["q90"])]
            high_threshold = float(np.quantile(prior_ranges, 0.90))
            output.append({
                "asset": asset,
                "date": record["date"],
                "role": record.get("role"),
                "actual": float(record["range_y"]),
                "prediction": float(prediction),
                "atrBaseline": float(record["atr_direct"] * atr_scale),
                "interval50": interval50,
                "interval80": interval80,
                "covered50": interval50[0] <= record["range_y"] <= interval50[1],
                "covered80": interval80[0] <= record["range_y"] <= interval80[1],
                "predictedPercentile252": predicted_percentile,
                "actualPercentile252": actual_percentile,
                "predictedGrade": predicted_grade,
                "actualGrade": actual_grade,
                "actualPriorMedianRatio": float(record["range_y"] / max(float(np.median(prior_ranges)), 0.01)),
                "actualHighRangeEvent": bool(record["range_y"] > high_threshold),
                "actualHighRangeThreshold": high_threshold,
            })
    return output


def comparison_metrics(rows: list[dict]):
    actual = np.asarray([row["actual"] for row in rows], dtype=np.float64)
    candidate = np.asarray([row["prediction"] for row in rows], dtype=np.float64)
    baseline = np.asarray([row["atrBaseline"] for row in rows], dtype=np.float64)
    denominator = float(np.sum((actual - np.mean(actual)) ** 2))

    def metrics(prediction):
        errors = actual - prediction
        mae = float(np.mean(np.abs(errors)))
        rmse = float(np.sqrt(np.mean(errors ** 2)))
        r2 = 1 - float(np.sum(errors ** 2)) / denominator if denominator else None
        return {"mae": mae, "rmse": rmse, "r2": r2}

    candidate_metrics, baseline_metrics = metrics(candidate), metrics(baseline)
    return {
        "rows": len(rows),
        "candidate": candidate_metrics,
        "atrBaseline": baseline_metrics,
        "improvement": {
            "maePercent": 100 * (baseline_metrics["mae"] - candidate_metrics["mae"]) / baseline_metrics["mae"],
            "rmsePercent": 100 * (baseline_metrics["rmse"] - candidate_metrics["rmse"]) / baseline_metrics["rmse"],
            "r2Delta": candidate_metrics["r2"] - baseline_metrics["r2"] if candidate_metrics["r2"] is not None else None,
            "mseSkillVsAtr": 1 - candidate_metrics["rmse"] ** 2 / baseline_metrics["rmse"] ** 2,
        },
    }


def coverage_metrics(rows: list[dict]):
    covered50 = sum(row["covered50"] for row in rows)
    covered80 = sum(row["covered80"] for row in rows)
    return {
        "rows": len(rows),
        "coverage50": covered50 / len(rows),
        "coverage50Wilson95": wilson(covered50, len(rows)),
        "targetGap50PercentagePoints": 100 * (covered50 / len(rows) - 0.50),
        "coverage80": covered80 / len(rows),
        "coverage80Wilson95": wilson(covered80, len(rows)),
        "targetGap80PercentagePoints": 100 * (covered80 / len(rows) - 0.80),
    }


def weather_metrics(rows: list[dict]):
    output = {}
    for predicted_grade in GRADE_ORDER:
        selected = [row for row in rows if row["predictedGrade"] == predicted_grade]
        if not selected:
            output[predicted_grade] = {"label": GRADE_LABELS[predicted_grade], "rows": 0}
            continue
        exact = sum(row["actualGrade"] == predicted_grade for row in selected)
        within_one = sum(abs(GRADE_ORDER.index(row["actualGrade"]) - GRADE_ORDER.index(predicted_grade)) <= 1 for row in selected)
        output[predicted_grade] = {
            "label": GRADE_LABELS[predicted_grade],
            "rows": len(selected),
            "share": len(selected) / len(rows),
            "actualMeanTrueRangePercent": mean([row["actual"] for row in selected]),
            "actualMedianTrueRangePercent": float(np.median([row["actual"] for row in selected])),
            "actualMeanPriorMedianRatio": mean([row["actualPriorMedianRatio"] for row in selected]),
            "exactGradeHitRate": exact / len(selected),
            "withinOneGradeHitRate": within_one / len(selected),
            "actualHighRangeEventRate": mean([row["actualHighRangeEvent"] for row in selected]),
        }
    return output


def storm_metrics(rows: list[dict]):
    predicted = np.asarray([row["predictedGrade"] == "storm" for row in rows], dtype=bool)
    actual = np.asarray([row["actualHighRangeEvent"] for row in rows], dtype=bool)
    tp = int(np.sum(predicted & actual))
    fp = int(np.sum(predicted & ~actual))
    fn = int(np.sum(~predicted & actual))
    tn = int(np.sum(~predicted & ~actual))
    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    base_rate = float(np.mean(actual))
    return {
        "rows": len(rows),
        "definition": "forecast percentile >= 90; actual True Range above its strictly-prior 252-observation 90th percentile",
        "confusionMatrix": {"truePositive": tp, "falsePositive": fp, "falseNegative": fn, "trueNegative": tn},
        "alerts": tp + fp,
        "actualEvents": tp + fn,
        "precision": precision,
        "precisionWilson95": wilson(tp, tp + fp),
        "recall": recall,
        "recallWilson95": wilson(tp, tp + fn),
        "f1": safe_div(2 * precision * recall, precision + recall) if precision is not None and recall is not None else None,
        "specificity": safe_div(tn, tn + fp),
        "baseRate": base_rate,
        "lift": safe_div(precision, base_rate) if precision is not None else None,
    }


def circular_sample_indices(length: int, rng):
    block = min(BLOCK_LENGTH, length)
    output = []
    while len(output) < length:
        start = int(rng.integers(0, length))
        output.extend((start + offset) % length for offset in range(block))
    return output[:length]


def bootstrap(rows: list[dict], seed: int):
    groups = defaultdict(list)
    for row in rows:
        groups[row["asset"]].append(row)
    rng = np.random.default_rng(seed)
    values = defaultdict(list)
    for _ in range(BOOTSTRAP_SAMPLES):
        sampled = []
        for asset_rows in groups.values():
            sampled.extend(asset_rows[index] for index in circular_sample_indices(len(asset_rows), rng))
        comparison = comparison_metrics(sampled)
        coverage = coverage_metrics(sampled)
        values["maeImprovementPercent"].append(comparison["improvement"]["maePercent"])
        values["rmseImprovementPercent"].append(comparison["improvement"]["rmsePercent"])
        values["mseSkillVsAtr"].append(comparison["improvement"]["mseSkillVsAtr"])
        values["coverage50"].append(coverage["coverage50"])
        values["coverage80"].append(coverage["coverage80"])
    return {
        "samples": BOOTSTRAP_SAMPLES,
        "blockLength": BLOCK_LENGTH,
        **{key: {"mean": mean(item), "ci95": percentile_interval(item)} for key, item in values.items()},
    }


def aggregate(rows: list[dict], seed: int):
    return {
        "comparison": comparison_metrics(rows),
        "coverage": coverage_metrics(rows),
        "weather": weather_metrics(rows),
        "storm": storm_metrics(rows),
        "blockBootstrap": bootstrap(rows, seed),
    }


def macro_asset_equal(by_asset: dict):
    return {
        "assets": len(by_asset),
        "maeImprovementPercent": mean([item["comparison"]["improvement"]["maePercent"] for item in by_asset.values()]),
        "rmseImprovementPercent": mean([item["comparison"]["improvement"]["rmsePercent"] for item in by_asset.values()]),
        "mseSkillVsAtr": mean([item["comparison"]["improvement"]["mseSkillVsAtr"] for item in by_asset.values()]),
        "coverage50": mean([item["coverage"]["coverage50"] for item in by_asset.values()]),
        "coverage80": mean([item["coverage"]["coverage80"] for item in by_asset.values()]),
        "stormPrecision": mean([item["storm"]["precision"] for item in by_asset.values()]),
        "stormRecall": mean([item["storm"]["recall"] for item in by_asset.values()]),
    }


def target_and_standardization_audit(artifact: dict, training: list[dict], evaluation_rows: list[dict]):
    body = {key: value for key, value in artifact.items() if key != "artifactSha256"}
    hash_matches = shadow.hash_value(body) == artifact["artifactSha256"]
    features = artifact["rangeModel"]["features"]
    x = modeling.matrix(training, features)
    expected = modeling.weighted_standardizer(x, modeling.cluster_asset_weights(training))
    stored_mean = np.asarray(artifact["rangeModel"]["mean"])
    stored_scale = np.asarray(artifact["rangeModel"]["scale"])
    fold_audit = []
    for train_end, validation_start, validation_end in modeling.INNER_CORE_FOLDS:
        fold_train, fold_validation = modeling.inner_fold(training, train_end, validation_start, validation_end)
        fold_model = modeling.fit_ridge(fold_train, features, artifact["rangeModel"]["regularization"])
        fold_expected = modeling.weighted_standardizer(
            modeling.matrix(fold_train, features), modeling.cluster_asset_weights(fold_train)
        )
        fold_audit.append({
            "trainEnd": train_end,
            "validationStart": validation_start,
            "validationEnd": validation_end,
            "trainingRows": len(fold_train),
            "validationRows": len(fold_validation),
            "latestTrainingDate": max(row["date"] for row in fold_train),
            "earliestValidationDate": min(row["date"] for row in fold_validation),
            "strictlyOrdered": max(row["date"] for row in fold_train) < min(row["date"] for row in fold_validation),
            "meanMatchesFoldTrainOnly": bool(np.allclose(fold_model.standardizer.mean, fold_expected.mean, rtol=1e-10, atol=1e-10)),
            "scaleMatchesFoldTrainOnly": bool(np.allclose(fold_model.standardizer.scale, fold_expected.scale, rtol=1e-10, atol=1e-10)),
        })
    return {
        "target": {
            "rawLabelFormula": "max(H[t+1]-L[t+1], abs(H[t+1]-C[t]), abs(L[t+1]-C[t])) / C[t] * 100",
            "modelTargetFormula": "log(max(nextDayTrueRangePercent, 0.01))",
            "conclusion": "log(True Range / prior close * 100); multiplying by 100 only shifts the intercept",
            "absolutePriceLevelNormalized": True,
        },
        "standardization": {
            "policy": "weighted mean and scale are fitted only on the records passed to fit_ridge; validation/test rows are transformed with stored training statistics",
            "trainingRows": len(training),
            "trainingLastDate": max(row["date"] for row in training),
            "evaluationFirstDate": min(row["date"] for row in evaluation_rows),
            "storedMeanMatchesApprovedTraining": bool(np.allclose(stored_mean, expected.mean, rtol=1e-10, atol=1e-10)),
            "storedScaleMatchesApprovedTraining": bool(np.allclose(stored_scale, expected.scale, rtol=1e-10, atol=1e-10)),
            "evaluationRowsUsedToFitStandardizer": 0,
            "expandingFoldAudit": fold_audit,
            "allExpandingFoldsTrainOnly": all(
                item["strictlyOrdered"] and item["meanMatchesFoldTrainOnly"] and item["scaleMatchesFoldTrainOnly"]
                for item in fold_audit
            ),
        },
        "freezeIntegrity": {
            "modelId": artifact["modelId"],
            "artifactSha256": artifact["artifactSha256"],
            "artifactHashMatches": hash_matches,
            "trainingPolicy": artifact["trainingPolicy"],
            "directionForecast": artifact["directionForecast"],
        },
    }


def historical_report():
    split, artifact = load_json(SPLIT_PATH), load_json(MODEL_PATH)
    history, training, roles, starts = load_histories(split)
    model = shadow.deserialize_model(artifact["rangeModel"])
    policy = shadow.ensure_evaluation_policy()
    rows = build_evaluation_rows(history, starts, model, artifact, policy["atrScale"])
    for row in rows:
        row["role"] = roles[row["asset"]]
    by_asset_rows = defaultdict(list)
    for row in rows:
        by_asset_rows[row["asset"]].append(row)
    by_asset = {asset: aggregate(asset_rows, RANDOM_SEED + index + 1) for index, (asset, asset_rows) in enumerate(sorted(by_asset_rows.items()))}
    by_cohort = {
        role: aggregate([row for row in rows if row["role"] == role], RANDOM_SEED + 100 + index)
        for index, role in enumerate(("seen-assets", "asset-holdout", "transfer-holdout"))
    }
    report = {
        "schemaVersion": 1,
        "reportId": "market-weather-v2-validation-v1",
        "reportAsOf": artifact["frozenAt"],
        "evaluationWindow": {"firstDate": min(row["date"] for row in rows), "lastDate": max(row["date"] for row in rows)},
        "audit": target_and_standardization_audit(artifact, training, rows),
        "data": {"rows": len(rows), "assets": len(by_asset), "assetIds": sorted(by_asset), "cohorts": {key: sum(row["role"] == key for row in rows) for key in by_cohort}},
        "overallPooled": aggregate(rows, RANDOM_SEED),
        "overallAssetEqual": macro_asset_equal(by_asset),
        "byCohort": by_cohort,
        "byAsset": by_asset,
        "protocol": {
            "evaluationOnlyAfterFrozen2025Start": True,
            "sameRowsForCandidateAndAtrBaseline": True,
            "atrScaleFittedOnTrainingOnly": True,
            "intervalResidualsStrictlyPrior": True,
            "weatherRanksStrictlyPrior252": True,
            "actualStormDefinitionStrictlyPrior252": True,
            "bootstrap": {"method": "within-asset circular moving block", "samples": BOOTSTRAP_SAMPLES, "blockLength": BLOCK_LENGTH},
        },
    }
    return finite(report)


def prospective_rows():
    forecasts, _ = shadow.verify_ledger(shadow.FORECAST_LEDGER)
    benchmarks, _ = shadow.verify_ledger(shadow.BENCHMARK_LEDGER)
    settlements, _ = shadow.verify_ledger(shadow.SETTLEMENT_LEDGER)
    by_forecast = {item["forecastId"]: item for item in forecasts}
    by_benchmark = {item["forecastId"]: item for item in benchmarks}
    rows = []
    for settlement in settlements:
        forecast = by_forecast.get(settlement["forecastId"])
        benchmark = by_benchmark.get(settlement["forecastId"])
        if not forecast or not benchmark:
            continue
        actual = float(settlement["actual"]["nextDayTrueRangePercent"])
        predicted = float(forecast["forecast"]["nextDayTrueRangePercent"])
        threshold = float(benchmark["weatherReference"]["highRangeThresholdPercent"])
        quantiles = benchmark["weatherReference"].get("trueRangeQuantilesPercent")
        actual_grade = None
        if quantiles:
            if actual < quantiles["q25"]:
                actual_grade = "quiet"
            elif actual < quantiles["q75"]:
                actual_grade = "normal"
            elif actual < quantiles["q90"]:
                actual_grade = "strong"
            else:
                actual_grade = "storm"
        rows.append({
            "asset": settlement["assetId"],
            "date": settlement["asOfDate"],
            "actual": actual,
            "prediction": predicted,
            "atrBaseline": float(benchmark["baselines"]["atrScaledTrueRangePercent"]),
            "lastRangeBaseline": float(benchmark["baselines"]["lastObservedTrueRangePercent"]),
            "covered50": bool(settlement["errors"]["covered50"]),
            "covered80": bool(settlement["errors"]["covered80"]),
            "predictedGrade": forecast["forecast"]["weatherGrade"],
            "actualGrade": actual_grade,
            "actualHighRangeEvent": actual > threshold,
            "absoluteError": abs(actual - predicted),
            "atrAbsoluteError": abs(actual - float(benchmark["baselines"]["atrScaledTrueRangePercent"])),
            "settledAt": settlement["settledAt"],
        })
    return sorted(rows, key=lambda row: (row["date"], row["asset"]))


def prospective_report():
    rows = prospective_rows()
    forecasts, forecast_head = shadow.verify_ledger(shadow.FORECAST_LEDGER)
    benchmarks, benchmark_head = shadow.verify_ledger(shadow.BENCHMARK_LEDGER)
    settlements, settlement_head = shadow.verify_ledger(shadow.SETTLEMENT_LEDGER)
    by_asset_rows = defaultdict(list)
    for row in rows:
        by_asset_rows[row["asset"]].append(row)

    def summarize(selected):
        if not selected:
            return None
        comparison = comparison_metrics(selected)
        coverage = coverage_metrics(selected)
        storm = storm_metrics(selected)
        grades = {}
        for grade_id in GRADE_ORDER:
            grade_rows = [row for row in selected if row["predictedGrade"] == grade_id]
            grades[grade_id] = {
                "label": GRADE_LABELS[grade_id],
                "rows": len(grade_rows),
                "actualMeanTrueRangePercent": mean([row["actual"] for row in grade_rows]),
                "actualHighRangeEventRate": mean([row["actualHighRangeEvent"] for row in grade_rows]),
                "exactGradeHitRate": mean([row["actualGrade"] == grade_id for row in grade_rows if row["actualGrade"] is not None]),
            }
        return {"comparison": comparison, "coverage": coverage, "weather": grades, "storm": storm}

    return finite({
        "schemaVersion": 1,
        "reportId": "market-weather-v2-prospective-settlement-v1",
        "reportAsOf": max([item["settledAt"] for item in settlements], default=load_json(MODEL_PATH)["frozenAt"]),
        "status": "preliminary" if len(rows) < 60 else "checkpoint-eligible",
        "minimumCheckpointSettlements": 60,
        "recommendedCheckpointSettlements": 120,
        "counts": {"forecasts": len(forecasts), "benchmarks": len(benchmarks), "settlements": len(settlements), "pairedSettlements": len(rows)},
        "chainHeads": {"forecast": forecast_head, "benchmark": benchmark_head, "settlement": settlement_head},
        "overall": summarize(rows),
        "byAsset": {asset: summarize(asset_rows) for asset, asset_rows in sorted(by_asset_rows.items())},
        "dailySettlements": rows,
        "warning": "No promotion, tuning, or performance claim before the registered 60/120-settlement checkpoints.",
    })


def pct(value, digits=1):
    return "—" if value is None else f"{value * 100:.{digits}f}%"


def number(value, digits=3):
    return "—" if value is None else f"{value:.{digits}f}"


def historical_markdown(report: dict):
    audit, overall = report["audit"], report["overallPooled"]
    lines = [
        "# Market Weather v2 공식 검증 감사", "",
        "## 1–2. 타겟과 데이터 누출 감사", "",
        f"- 타겟: `{audit['target']['modelTargetFormula']}`",
        f"- 해석: {audit['target']['conclusion']}",
        f"- 표준화 평균 일치: {audit['standardization']['storedMeanMatchesApprovedTraining']}",
        f"- 표준화 스케일 일치: {audit['standardization']['storedScaleMatchesApprovedTraining']}",
        f"- Expanding fold별 train-only 표준화: {audit['standardization']['allExpandingFoldsTrainOnly']}",
        f"- 학습 마지막 날짜: {audit['standardization']['trainingLastDate']} · 평가 첫 날짜: {audit['standardization']['evaluationFirstDate']}",
        f"- 모델 해시 일치: {audit['freezeIntegrity']['artifactHashMatches']}", "",
        "## 3–4. ATR 기준선과 예측구간", "",
        "|범위|행|MAE 모델|MAE ATR|MAE 개선|RMSE 모델|RMSE ATR|RMSE 개선|R² 모델|R² ATR|50% 포함|80% 포함|", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]

    def comparison_row(label, item):
        comparison, coverage = item["comparison"], item["coverage"]
        return (
            f"|{label}|{comparison['rows']:,}|{number(comparison['candidate']['mae'])}|{number(comparison['atrBaseline']['mae'])}|{number(comparison['improvement']['maePercent'], 1)}%|"
            f"{number(comparison['candidate']['rmse'])}|{number(comparison['atrBaseline']['rmse'])}|{number(comparison['improvement']['rmsePercent'], 1)}%|"
            f"{number(comparison['candidate']['r2'])}|{number(comparison['atrBaseline']['r2'])}|{pct(coverage['coverage50'])}|{pct(coverage['coverage80'])}|"
        )

    lines.append(comparison_row("전체 pooled", overall))
    for cohort, item in report["byCohort"].items():
        lines.append(comparison_row(cohort, item))
    macro = report["overallAssetEqual"]
    lines += [
        "",
        f"자산 동일가중 평균: MAE 개선 {macro['maeImprovementPercent']:.1f}% · RMSE 개선 {macro['rmseImprovementPercent']:.1f}% · 50% 포함률 {macro['coverage50'] * 100:.1f}% · 80% 포함률 {macro['coverage80'] * 100:.1f}%.",
        "", "### 자산별 오차", "",
        "|자산|행|MAE 모델|MAE ATR|개선|RMSE 모델|RMSE ATR|개선|R² 모델|R² ATR|", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for asset, item in report["byAsset"].items():
        comparison = item["comparison"]
        lines.append(
            f"|{asset}|{comparison['rows']:,}|{number(comparison['candidate']['mae'])}|{number(comparison['atrBaseline']['mae'])}|{number(comparison['improvement']['maePercent'], 1)}%|"
            f"{number(comparison['candidate']['rmse'])}|{number(comparison['atrBaseline']['rmse'])}|{number(comparison['improvement']['rmsePercent'], 1)}%|"
            f"{number(comparison['candidate']['r2'])}|{number(comparison['atrBaseline']['r2'])}|"
        )
    lines += ["", "### 자산별 예측구간", "", "|자산|행|50% 포함|50% 목표 오차|80% 포함|80% 목표 오차|MSE skill|", "|---|---:|---:|---:|---:|---:|---:|"]
    for asset, item in report["byAsset"].items():
        comparison, coverage = item["comparison"], item["coverage"]
        lines.append(
            f"|{asset}|{coverage['rows']:,}|{pct(coverage['coverage50'])}|{number(coverage['targetGap50PercentagePoints'], 1)}%p|"
            f"{pct(coverage['coverage80'])}|{number(coverage['targetGap80PercentagePoints'], 1)}%p|{number(comparison['improvement']['mseSkillVsAtr'])}|"
        )
    lines += ["", "## 5. 날씨 등급별 실제 결과", "", "|등급|행|실제 평균 TR|실제 중앙 TR|정확 등급 적중|±1등급 적중|상위 변동일률|", "|---|---:|---:|---:|---:|---:|---:|"]
    for grade_id in GRADE_ORDER:
        item = overall["weather"][grade_id]
        lines.append(f"|{item['label']}|{item['rows']:,}|{number(item.get('actualMeanTrueRangePercent'))}%|{number(item.get('actualMedianTrueRangePercent'))}%|{pct(item.get('exactGradeHitRate'))}|{pct(item.get('withinOneGradeHitRate'))}|{pct(item.get('actualHighRangeEventRate'))}|")
    storm = overall["storm"]
    lines += [
        "", "## 6. 폭풍 탐지", "",
        "실제 폭풍은 각 날짜 이전 252개 True Range의 90백분위 초과로 정의합니다.", "",
        f"- Precision: {pct(storm['precision'])} · Recall: {pct(storm['recall'])} · F1: {number(storm['f1'])} · Lift: {number(storm['lift'], 2)}x",
        f"- TP {storm['confusionMatrix']['truePositive']} · FP {storm['confusionMatrix']['falsePositive']} · FN {storm['confusionMatrix']['falseNegative']} · TN {storm['confusionMatrix']['trueNegative']}", "",
        "|자산|폭풍 알림|실제 사건|Precision|Recall|F1|Lift|", "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for asset, item in report["byAsset"].items():
        storm = item["storm"]
        lines.append(f"|{asset}|{storm['alerts']}|{storm['actualEvents']}|{pct(storm['precision'])}|{pct(storm['recall'])}|{number(storm['f1'])}|{number(storm['lift'], 2)}x|")
    boot = overall["blockBootstrap"]
    lines += [
        "", "## 통계적 불확실성", "",
        f"- MAE 개선율 95% 블록 부트스트랩: {number(boot['maeImprovementPercent']['ci95'][0], 1)}% ~ {number(boot['maeImprovementPercent']['ci95'][1], 1)}%",
        f"- RMSE 개선율 95% 블록 부트스트랩: {number(boot['rmseImprovementPercent']['ci95'][0], 1)}% ~ {number(boot['rmseImprovementPercent']['ci95'][1], 1)}%",
        f"- 50% 포함률 95% 블록 부트스트랩: {pct(boot['coverage50']['ci95'][0])} ~ {pct(boot['coverage50']['ci95'][1])}",
        f"- 80% 포함률 95% 블록 부트스트랩: {pct(boot['coverage80']['ci95'][0])} ~ {pct(boot['coverage80']['ci95'][1])}", "",
        "동일 평가행에서 동결 v2와 학습구간 전용 ATR 기준선을 비교했습니다.", "",
    ]
    return "\n".join(lines)


def prospective_markdown(report: dict):
    lines = [
        "# Market Weather v2 전향 정산", "",
        f"- 상태: `{report['status']}`",
        f"- 공식 예보 {report['counts']['forecasts']}건 · 정산 {report['counts']['settlements']}건 · 완전 매칭 {report['counts']['pairedSettlements']}건",
        "- 60건 전에는 성능 판정·재튜닝·승격을 하지 않습니다.", "",
    ]
    overall = report.get("overall")
    if overall:
        comparison, coverage, storm = overall["comparison"], overall["coverage"], overall["storm"]
        lines += [
            "## 누적 성과", "",
            f"- Range MAE: {number(comparison['candidate']['mae'], 4)} · ATR MAE: {number(comparison['atrBaseline']['mae'], 4)}",
            f"- 50% 포함률: {pct(coverage['coverage50'])} · 80% 포함률: {pct(coverage['coverage80'])}",
            f"- 폭풍 Precision: {pct(storm['precision'])} · Recall: {pct(storm['recall'])}", "",
            "## 일별 예보–실제", "",
            "|기준일|자산|예보 TR|실제 TR|모델 오차|ATR 오차|50%|80%|날씨|", "|---|---|---:|---:|---:|---:|---|---|---|",
        ]
        for row in report["dailySettlements"]:
            lines.append(f"|{row['date']}|{row['asset']}|{row['prediction']:.3f}%|{row['actual']:.3f}%|{row['absoluteError']:.3f}%p|{row['atrAbsoluteError']:.3f}%p|{'✓' if row['covered50'] else '—'}|{'✓' if row['covered80'] else '—'}|{GRADE_LABELS[row['predictedGrade']]}|")
    else:
        lines += ["아직 정산 가능한 예보가 없습니다.", ""]
    return "\n".join(lines)


def main():
    historical = historical_report()
    prospective = prospective_report()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "validation-results.json").write_text(json.dumps(historical, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(historical_markdown(historical), encoding="utf-8")
    (OUTPUT_DIR / "prospective-results.json").write_text(json.dumps(prospective, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "PROSPECTIVE_REPORT.md").write_text(prospective_markdown(prospective), encoding="utf-8")
    print(f"[v2-validation] historical rows={historical['data']['rows']:,} assets={historical['data']['assets']}")
    print(f"[v2-validation] prospective settlements={prospective['counts']['pairedSettlements']}")
    print(f"[v2-validation] output={OUTPUT_DIR.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
