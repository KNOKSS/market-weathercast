from __future__ import annotations

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


calibration = load_module("market_weather_calibration_causal", ROOT / "scripts" / "calibration" / "run.py")
OUTPUT_DIR = ROOT / "research-results" / "market-weather-causal-interval-v2"
CALIBRATION_DIR = ROOT / "research-results" / "market-weather-calibration-v1"
INTERVAL_ID = "market-weather-causal-interval-v2"
LOOKBACK = 252
MINIMUM_ADAPTIVE_HISTORY = 60
SHRINKAGE_STRENGTH = 100
SEED_FOLDS = [
    ("2006-12-31", "2007-01-01", "2008-12-31"),
    ("2008-12-31", "2009-01-01", "2010-12-31"),
    ("2010-12-31", "2011-01-01", "2012-12-31"),
    ("2012-12-31", "2013-01-01", "2014-12-31"),
]
ALL_FOLDS = SEED_FOLDS + modeling.INNER_CORE_FOLDS


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def window_records(history: list[dict], start: str, end: str, assets: set[str] | None = None) -> list[dict]:
    return sorted(
        [item for item in history if start <= item["date"] <= end and (assets is None or item["asset"] in assets)],
        key=lambda item: (item["asset"], item["date"]),
    )


def purged_window_records(history: list[dict], start: str, end: str, role: str) -> list[dict]:
    by_asset = defaultdict(list)
    for item in history:
        if start <= item["date"] <= end and item["role"] == role:
            by_asset[item["asset"]].append(item)
    output = []
    for records in by_asset.values():
        output.extend(sorted(records, key=lambda item: item["date"])[5:])
    return sorted(output, key=lambda item: (item["asset"], item["date"]))


def build_causal_prediction_tape(train: list[dict], history: list[dict]) -> tuple[dict[tuple[str, str], float], list[dict]]:
    tape: dict[tuple[str, str], float] = {}
    audit = []
    for fold_index, (train_end, start, end) in enumerate(ALL_FOLDS, start=1):
        fold_train, _ = modeling.inner_fold(train, train_end, start, end)
        model = modeling.fit_ridge(fold_train, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
        records = window_records(history, start, end)
        predictions = model.predict(records)
        for item, prediction in zip(records, predictions):
            key = (item["asset"], item["date"])
            if key in tape:
                raise RuntimeError(f"Duplicate causal prediction {key}")
            tape[key] = float(prediction)
        audit.append({
            "fold": fold_index,
            "trainEnd": train_end,
            "predictionStart": start,
            "predictionEnd": end,
            "trainingRows": len(fold_train),
            "predictionRows": len(records),
            "causal": train_end < start,
        })
    final_model = modeling.fit_ridge(train, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
    final_records = window_records(history, "2023-01-01", "2024-12-31")
    final_predictions = final_model.predict(final_records)
    for item, prediction in zip(final_records, final_predictions):
        tape[(item["asset"], item["date"])] = float(prediction)
    audit.append({
        "fold": "outer-validation",
        "trainEnd": "2022-12-31",
        "predictionStart": "2023-01-01",
        "predictionEnd": "2024-12-31",
        "trainingRows": len(train),
        "predictionRows": len(final_records),
        "causal": True,
    })
    return tape, audit


def calibration_quantiles(history: list[dict], tape: dict, cutoff: str, excluded_cluster: str | None = None) -> tuple[dict, dict, int]:
    records, predictions = [], []
    for item in history:
        key = (item["asset"], item["date"])
        if item["role"] != "development" or item["date"] >= cutoff or key not in tape:
            continue
        if excluded_cluster is not None and item["cluster"] == excluded_cluster:
            continue
        records.append(item)
        predictions.append(tape[key])
    global_q, cluster_q = calibration.conformal_quantiles(records, np.asarray(predictions))
    return global_q, cluster_q, len(records)


def empirical_quantiles(values: np.ndarray) -> dict[str, float]:
    return {f"q{int(level * 100):02d}": float(np.quantile(values, level)) for level in (0.10, 0.25, 0.75, 0.90)}


def blend_quantiles(global_q: dict, asset_q: dict, observations: int) -> dict[str, float]:
    weight = observations / (observations + SHRINKAGE_STRENGTH)
    return {key: weight * asset_q[key] + (1 - weight) * global_q[key] for key in ("q10", "q25", "q75", "q90")}


def empty_bounds(length: int):
    return {
        scheme: {50: [np.zeros(length), np.zeros(length)], 80: [np.zeros(length), np.zeros(length)]}
        for scheme in ("global", "cluster", "rolling252", "shrunk252")
    }


def fill_bounds(bounds, scheme, index, prediction, q):
    bounds[scheme][50][0][index], bounds[scheme][50][1][index] = prediction * q["q25"], prediction * q["q75"]
    bounds[scheme][80][0][index], bounds[scheme][80][1][index] = prediction * q["q10"], prediction * q["q90"]


def causal_bounds(history: list[dict], records: list[dict], tape: dict, global_q: dict, cluster_q: dict) -> dict:
    output_index = {(item["asset"], item["date"]): index for index, item in enumerate(records)}
    required_assets = {item["asset"] for item in records}
    by_asset = defaultdict(list)
    for item in history:
        if item["asset"] in required_assets:
            by_asset[item["asset"]].append(item)
    bounds, filled = empty_bounds(len(records)), np.zeros(len(records), dtype=bool)
    for asset, asset_records in by_asset.items():
        prior_ratios = deque(maxlen=LOOKBACK)
        for item in sorted(asset_records, key=lambda row: row["date"]):
            key = (asset, item["date"])
            prediction = tape.get(key)
            index = output_index.get(key)
            if prediction is not None and index is not None:
                if len(prior_ratios) >= MINIMUM_ADAPTIVE_HISTORY:
                    rolling_q = empirical_quantiles(np.asarray(prior_ratios))
                    shrunk_q = blend_quantiles(global_q, rolling_q, len(prior_ratios))
                else:
                    rolling_q = global_q
                    shrunk_q = global_q
                fill_bounds(bounds, "global", index, prediction, global_q)
                fill_bounds(bounds, "cluster", index, prediction, cluster_q.get(item["cluster"], global_q))
                fill_bounds(bounds, "rolling252", index, prediction, rolling_q)
                fill_bounds(bounds, "shrunk252", index, prediction, shrunk_q)
                filled[index] = True
            # The current realized range is appended only after its forecast interval was formed.
            if prediction is not None:
                prior_ratios.append(item["range_y"] / max(prediction, 0.01))
    if not np.all(filled):
        raise RuntimeError(f"Missing causal interval for {int(np.sum(~filled))} rows")
    return bounds


def metrics(records: list[dict], bounds: dict, selected_indices: np.ndarray | None = None) -> dict:
    indices = np.arange(len(records)) if selected_indices is None else selected_indices
    subset_records = [records[index] for index in indices]
    truth = modeling.target(records, "range_y")
    output = {}
    for scheme, scheme_bounds in bounds.items():
        per_asset = []
        grouped = defaultdict(list)
        for index in indices:
            grouped[records[index]["asset"]].append(index)
        for asset_indices in grouped.values():
            selected = np.asarray(asset_indices, dtype=int)
            item = {}
            for coverage in (50, 80):
                lower, upper = scheme_bounds[coverage]
                item[f"coverage{coverage}"] = float(np.mean((truth[selected] >= lower[selected]) & (truth[selected] <= upper[selected])))
                item[f"width{coverage}"] = float(np.mean(upper[selected] - lower[selected]))
            per_asset.append(item)
        result = {key: float(np.mean([item[key] for item in per_asset])) for key in ("coverage50", "width50", "coverage80", "width80")}
        result["meanAbsoluteCoverageError"] = (abs(result["coverage50"] - 0.50) + abs(result["coverage80"] - 0.80)) / 2
        result["rows"], result["assets"] = len(subset_records), len(per_asset)
        output[scheme] = result
    return output


def bundle(history, records, tape, global_q, cluster_q):
    bounds = causal_bounds(history, records, tape, global_q, cluster_q)
    overall = metrics(records, bounds)
    by_year = {
        year: metrics(records, bounds, np.asarray([i for i, item in enumerate(records) if item["date"].startswith(year)], dtype=int))
        for year in sorted({item["date"][:4] for item in records})
    }
    by_asset = {
        asset: metrics(records, bounds, np.asarray([i for i, item in enumerate(records) if item["asset"] == asset], dtype=int))
        for asset in sorted({item["asset"] for item in records})
    }
    return {"overall": overall, "byYear": by_year, "byAsset": by_asset}


def select_scheme(seen_bundle: dict) -> str:
    candidates = seen_bundle["overall"]
    best_error = min(item["meanAbsoluteCoverageError"] for item in candidates.values())
    eligible = [name for name, item in candidates.items() if item["meanAbsoluteCoverageError"] <= best_error + 0.005]
    return min(eligible, key=lambda name: candidates[name]["width80"])


def historical_stability(history, tape, selected_scheme):
    output = []
    for fold_index, (_, start, end) in enumerate(modeling.INNER_CORE_FOLDS, start=1):
        global_q, cluster_q, calibration_rows = calibration_quantiles(history, tape, start)
        cohorts = {}
        for cohort, role in (("seen-assets", "development"), ("asset-holdout", "asset-holdout")):
            records = purged_window_records(history, start, end, role)
            result = bundle(history, records, tape, global_q, cluster_q)["overall"][selected_scheme]
            cohorts[cohort] = result
        output.append({"fold": fold_index, "start": start, "end": end, "calibrationRows": calibration_rows, "cohorts": cohorts})
    return output


def cluster_transfer(train, history, validation, clusters, selected_scheme):
    output = []
    for cluster in clusters:
        reduced = [item for item in train if item["cluster"] != cluster]
        tape, tape_audit = build_causal_prediction_tape(reduced, history)
        global_q, cluster_q, calibration_rows = calibration_quantiles(history, tape, "2023-01-01", cluster)
        records = [item for item in validation if item["cluster"] == cluster]
        selected = bundle(history, records, tape, global_q, cluster_q)["overall"][selected_scheme]
        output.append({
            "cluster": cluster,
            "removedTrainingRows": len(train) - len(reduced),
            "evaluationAssets": sorted({item["asset"] for item in records}),
            "calibrationRows": calibration_rows,
            "selectedMetrics": selected,
            "causalTapeAudit": tape_audit,
        })
        print(f"[causal-interval] {cluster}: 80%={selected['coverage80']:.3f}", flush=True)
    return output


def markdown_report(report):
    lines = [
        "# 완전 인과형 자산 적응 예측구간 v2", "", "## 누수 수정", "",
        "과거 252일 오차는 각 날짜보다 앞선 데이터로 학습된 모델의 OOF 예측에서만 계산했습니다. 최종 모델로 과거를 재예측한 오차는 사용하지 않습니다.",
        f"seen 구간에서 선택된 방식: `{report['selectedScheme']}`", "",
        "## 2023~2024 검증", "", "|집단|50% 포함률|80% 포함률|평균 오차|80% 폭|", "|---|---:|---:|---:|---:|",
    ]
    for cohort in ("seen-assets", "asset-holdout"):
        item = report["validation"][cohort]["overall"][report["selectedScheme"]]
        lines.append(f"|{cohort}|{item['coverage50'] * 100:.1f}%|{item['coverage80'] * 100:.1f}%|{item['meanAbsoluteCoverageError'] * 100:.1f}%p|{item['width80']:.3f}|")
    lines += ["", "## 2015~2022 시기 안정성", "", "|구간|집단|50% 포함률|80% 포함률|평균 오차|", "|---|---|---:|---:|---:|"]
    for fold in report["historicalStability"]:
        for cohort, item in fold["cohorts"].items():
            lines.append(f"|{fold['start'][:4]}–{fold['end'][:4]}|{cohort}|{item['coverage50'] * 100:.1f}%|{item['coverage80'] * 100:.1f}%|{item['meanAbsoluteCoverageError'] * 100:.1f}%p|")
    lines += ["", "## 경제군 완전 제외 전이", "", "|경제군|평가 자산|50% 포함률|80% 포함률|평균 오차|", "|---|---|---:|---:|---:|"]
    for result in report["clusterTransfer"]:
        item = result["selectedMetrics"]
        lines.append(f"|{result['cluster']}|{', '.join(result['evaluationAssets'])}|{item['coverage50'] * 100:.1f}%|{item['coverage80'] * 100:.1f}%|{item['meanAbsoluteCoverageError'] * 100:.1f}%p|")
    lines += ["", "## 결정", ""] + [f"- {note}" for note in report["decisionNotes"]]
    lines += ["", "봉인 시험과 앱 공식은 변경하지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    split_manifest = load_json(modeling.BASELINE_DIR / "split-manifest.json")
    train, seen, holdout, data_audit = modeling.load_records()
    history, history_audit = calibration.load_history(split_manifest)
    validation = sorted(seen + holdout, key=lambda item: (item["asset"], item["date"]))

    print("[causal-interval] building base causal prediction tape", flush=True)
    tape, tape_audit = build_causal_prediction_tape(train, history)
    global_q, cluster_q, calibration_rows = calibration_quantiles(history, tape, "2023-01-01")
    validation_bundles = {
        "seen-assets": bundle(history, seen, tape, global_q, cluster_q),
        "asset-holdout": bundle(history, holdout, tape, global_q, cluster_q),
    }
    selected_scheme = select_scheme(validation_bundles["seen-assets"])
    print(f"[causal-interval] selected={selected_scheme}", flush=True)
    historical = historical_stability(history, tape, selected_scheme)
    transfer = cluster_transfer(train, history, validation, split_manifest["policy"]["trainingClusters"], selected_scheme)

    validation_year_pass = all(
        item[selected_scheme]["meanAbsoluteCoverageError"] <= 0.075
        for cohort in validation_bundles.values() for item in cohort["byYear"].values()
    )
    holdout_asset_pass_rate = float(np.mean([
        item[selected_scheme]["meanAbsoluteCoverageError"] <= 0.10
        for item in validation_bundles["asset-holdout"]["byAsset"].values()
    ]))
    historical_pass_rate = float(np.mean([
        item["meanAbsoluteCoverageError"] <= 0.10
        for fold in historical for item in fold["cohorts"].values()
    ]))
    transfer_pass_rate = float(np.mean([item["selectedMetrics"]["meanAbsoluteCoverageError"] <= 0.10 for item in transfer]))
    crypto = next(item for item in transfer if item["cluster"] == "crypto")
    crypto_pass = crypto["selectedMetrics"]["meanAbsoluteCoverageError"] <= 0.10
    technical_causality = all(item["causal"] for item in tape_audit) and all(
        audit["causal"] for result in transfer for audit in result["causalTapeAudit"]
    )
    status = "causal-interval-v2-passed" if validation_year_pass and holdout_asset_pass_rate == 1.0 and historical_pass_rate >= 0.875 and transfer_pass_rate == 1.0 and crypto_pass and technical_causality else "causal-interval-revision-required"
    decision_notes = [
        f"연도별 검증={validation_year_pass}, holdout 개별자산 통과율={holdout_asset_pass_rate * 100:.1f}%, 과거 8개 시기·집단 통과율={historical_pass_rate * 100:.1f}%.",
        f"경제군 전이 통과율={transfer_pass_rate * 100:.1f}%, 코인 전이={crypto_pass}, 전체 예측 테이프 인과성={technical_causality}.",
        f"상태: `{status}`.",
        "탐색 v1의 회고적 과거 예측 문제를 수정했으며 v1 결과는 승격 근거에서 제외합니다.",
        "통과 시에도 기존 후보를 자동 변경하지 않고 결합 후보 v2 명세를 별도로 생성합니다.",
    ]
    report = {
        "schemaVersion": 2,
        "intervalResearchId": INTERVAL_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCandidateArtifactSha256": load_json(CALIBRATION_DIR / "manifest.json")["artifactSha256"],
        "dataAudit": {**data_audit, **history_audit},
        "protocol": {"seedFolds": SEED_FOLDS, "mainFolds": modeling.INNER_CORE_FOLDS, "lookback": LOOKBACK, "minimumAdaptiveHistory": MINIMUM_ADAPTIVE_HISTORY, "shrinkageStrength": SHRINKAGE_STRENGTH, "selection": "seen validation only"},
        "causalTapeAudit": tape_audit,
        "calibrationRows": calibration_rows,
        "selectedScheme": selected_scheme,
        "validation": validation_bundles,
        "historicalStability": historical,
        "clusterTransfer": transfer,
        "gates": {"validationYearPass": validation_year_pass, "holdoutAssetPassRate": holdout_asset_pass_rate, "historicalPassRate": historical_pass_rate, "transferPassRate": transfer_pass_rate, "cryptoPass": crypto_pass},
        "status": status,
        "verification": {"sealedTestLabelsUsed": 0, "allPredictionTapesCausal": technical_causality, "currentOutcomeExcludedFromRollingResiduals": True, "appFormulaChanged": False},
        "decisionNotes": decision_notes,
    }
    safe = calibration.json_safe(report)
    (OUTPUT_DIR / "causal-interval-results.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe), encoding="utf-8")
    manifest = {"schemaVersion": 2, "intervalResearchId": INTERVAL_ID, "generatedAt": report["generatedAt"], "sourceCandidateArtifactSha256": report["sourceCandidateArtifactSha256"], "selectedScheme": selected_scheme, "status": status, "sealedTestLabelsUsed": 0, "appFormulaChanged": False}
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] status={status}", flush=True)
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT).as_posix()}", flush=True)


if __name__ == "__main__":
    main()
