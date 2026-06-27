from __future__ import annotations

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


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


calibration = load_module("market_weather_calibration_interval", ROOT / "scripts" / "calibration" / "run.py")
OUTPUT_DIR = ROOT / "research-results" / "market-weather-adaptive-interval-v1"
CALIBRATION_DIR = ROOT / "research-results" / "market-weather-calibration-v1"
INTERVAL_ID = "market-weather-adaptive-interval-v1"
LOOKBACK = 252
SHRINKAGE_STRENGTH = 100
QUANTILE_KEYS = ("q10", "q25", "q75", "q90")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def empirical_quantiles(values: np.ndarray) -> dict[str, float]:
    return {
        "q10": float(np.quantile(values, 0.10)),
        "q25": float(np.quantile(values, 0.25)),
        "q75": float(np.quantile(values, 0.75)),
        "q90": float(np.quantile(values, 0.90)),
    }


def blend_quantiles(global_q: dict, asset_q: dict, observations: int) -> dict[str, float]:
    weight = observations / (observations + SHRINKAGE_STRENGTH)
    return {key: weight * asset_q[key] + (1 - weight) * global_q[key] for key in QUANTILE_KEYS}


def empty_bounds(length: int):
    return {name: {50: [np.zeros(length), np.zeros(length)], 80: [np.zeros(length), np.zeros(length)]} for name in ("global", "cluster", "rolling252", "shrunk252")}


def fill_bounds(store: dict, scheme: str, index: int, prediction: float, q: dict):
    store[scheme][50][0][index], store[scheme][50][1][index] = prediction * q["q25"], prediction * q["q75"]
    store[scheme][80][0][index], store[scheme][80][1][index] = prediction * q["q10"], prediction * q["q90"]


def bounds_metrics(records: list[dict], bounds: dict) -> dict:
    truth = modeling.target(records, "range_y")
    per_asset = []
    for asset, indices in modeling.grouped_indices(records).items():
        item = {"asset": asset}
        for coverage in (50, 80):
            lower, upper = bounds[coverage]
            item[f"coverage{coverage}"] = float(np.mean((truth[indices] >= lower[indices]) & (truth[indices] <= upper[indices])))
            item[f"width{coverage}"] = float(np.mean(upper[indices] - lower[indices]))
        per_asset.append(item)
    result = {key: float(np.mean([item[key] for item in per_asset])) for key in ("coverage50", "width50", "coverage80", "width80")}
    result["meanAbsoluteCoverageError"] = (abs(result["coverage50"] - 0.50) + abs(result["coverage80"] - 0.80)) / 2
    result["rows"], result["assets"] = len(records), len(per_asset)
    return result


def adaptive_interval_candidates(history: list[dict], model, records: list[dict], global_q: dict, cluster_q: dict | None = None) -> dict:
    index_by_key = {(item["asset"], item["date"]): index for index, item in enumerate(records)}
    required_assets = {item["asset"] for item in records}
    by_asset = defaultdict(list)
    for item in history:
        if item["asset"] in required_assets:
            by_asset[item["asset"]].append(item)
    bounds = empty_bounds(len(records))
    filled = np.zeros(len(records), dtype=bool)
    for asset, asset_records in by_asset.items():
        ordered = sorted(asset_records, key=lambda item: item["date"])
        predictions = model.predict(ordered)
        truth = modeling.target(ordered, "range_y")
        ratios = truth / np.maximum(predictions, 0.01)
        for history_index, item in enumerate(ordered):
            output_index = index_by_key.get((asset, item["date"]))
            if output_index is None or history_index < LOOKBACK:
                continue
            rolling_q = empirical_quantiles(ratios[history_index - LOOKBACK:history_index])
            shrunk_q = blend_quantiles(global_q, rolling_q, LOOKBACK)
            selected_cluster_q = (cluster_q or {}).get(item["cluster"], global_q)
            prediction = float(predictions[history_index])
            fill_bounds(bounds, "global", output_index, prediction, global_q)
            fill_bounds(bounds, "cluster", output_index, prediction, selected_cluster_q)
            fill_bounds(bounds, "rolling252", output_index, prediction, rolling_q)
            fill_bounds(bounds, "shrunk252", output_index, prediction, shrunk_q)
            filled[output_index] = True
    if not np.all(filled):
        raise RuntimeError(f"Missing adaptive interval history for {int(np.sum(~filled))} rows")
    return {name: bounds_metrics(records, values) for name, values in bounds.items()}


def sliced_metrics(history, model, records, global_q, cluster_q=None):
    overall = adaptive_interval_candidates(history, model, records, global_q, cluster_q)
    by_year = {}
    for year in ("2023", "2024"):
        subset = [item for item in records if item["date"].startswith(year)]
        by_year[year] = adaptive_interval_candidates(history, model, subset, global_q, cluster_q)
    by_asset = {}
    for asset in sorted({item["asset"] for item in records}):
        subset = [item for item in records if item["asset"] == asset]
        by_asset[asset] = adaptive_interval_candidates(history, model, subset, global_q, cluster_q)
    return {"overall": overall, "byYear": by_year, "byAsset": by_asset}


def select_scheme(seen_results: dict) -> str:
    candidates = seen_results["overall"]
    best_error = min(item["meanAbsoluteCoverageError"] for item in candidates.values())
    eligible = [name for name, item in candidates.items() if item["meanAbsoluteCoverageError"] <= best_error + 0.005]
    return min(eligible, key=lambda name: candidates[name]["width80"])


def cluster_transfer(train, validation, history, clusters, selected_scheme):
    output = []
    for cluster in clusters:
        reduced = [item for item in train if item["cluster"] != cluster]
        model = modeling.fit_ridge(reduced, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
        oof_records, oof_predictions, _ = calibration.make_oof_predictions(reduced, "range")
        global_q, _ = calibration.conformal_quantiles(oof_records, oof_predictions)
        records = [item for item in validation if item["cluster"] == cluster]
        metrics = adaptive_interval_candidates(history, model, records, global_q)
        transfer_scheme = "global" if selected_scheme == "cluster" else selected_scheme
        output.append({
            "cluster": cluster,
            "removedTrainingRows": len(train) - len(reduced),
            "evaluationAssets": sorted({item["asset"] for item in records}),
            "selectedTransferScheme": transfer_scheme,
            "metrics": metrics,
            "selectedMetrics": metrics[transfer_scheme],
        })
        print(f"[interval] {cluster}: {transfer_scheme} 80%={metrics[transfer_scheme]['coverage80']:.3f}", flush=True)
    return output


def markdown_report(report: dict) -> str:
    lines = [
        "# 자산 적응형 예측구간 연구 v1", "", "## 목적", "",
        "경제군 OOF 표본이 없는 코인에서 전체 시장 구간을 대신 사용했을 때 발생한 과소포착을 수정합니다.",
        f"seen 검증만으로 선택한 방식은 `{report['selectedScheme']}`입니다.", "",
        "## 2023~2024 검증", "", "|집단|방식|50% 포함률|80% 포함률|평균 오차|80% 폭|", "|---|---|---:|---:|---:|---:|",
    ]
    for cohort in ("seen-assets", "asset-holdout"):
        for name, item in report["validation"][cohort]["overall"].items():
            lines.append(f"|{cohort}|{name}|{item['coverage50'] * 100:.1f}%|{item['coverage80'] * 100:.1f}%|{item['meanAbsoluteCoverageError'] * 100:.1f}%p|{item['width80']:.3f}|")
    lines += ["", "## 경제군 완전 제외 전이", "", "|경제군|방식|평가 자산|50% 포함률|80% 포함률|평균 오차|", "|---|---|---|---:|---:|---:|"]
    for item in report["clusterTransfer"]:
        metrics = item["selectedMetrics"]
        lines.append(f"|{item['cluster']}|{item['selectedTransferScheme']}|{', '.join(item['evaluationAssets'])}|{metrics['coverage50'] * 100:.1f}%|{metrics['coverage80'] * 100:.1f}%|{metrics['meanAbsoluteCoverageError'] * 100:.1f}%p|")
    lines += ["", "## 결정", ""]
    lines.extend(f"- {note}" for note in report["decisionNotes"])
    lines += ["", "봉인 시험과 앱 공식은 변경하지 않았습니다.", ""]
    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    split_manifest = load_json(modeling.BASELINE_DIR / "split-manifest.json")
    calibration_results = load_json(CALIBRATION_DIR / "calibration-results.json")
    train, seen, holdout, data_audit = modeling.load_records()
    history, history_audit = calibration.load_history(split_manifest)
    model = modeling.fit_ridge(train, calibration.RANGE_FEATURES, calibration.RANGE_LAMBDA)
    global_q = calibration_results["rangeCalibration"]["globalQuantiles"]
    cluster_q = calibration_results["rangeCalibration"]["clusterQuantiles"]

    print("[interval] validation candidates", flush=True)
    validation = {
        "seen-assets": sliced_metrics(history, model, seen, global_q, cluster_q),
        "asset-holdout": sliced_metrics(history, model, holdout, global_q, cluster_q),
    }
    selected_scheme = select_scheme(validation["seen-assets"])
    print(f"[interval] selected from seen={selected_scheme}", flush=True)
    combined_validation = sorted(seen + holdout, key=lambda item: (item["asset"], item["date"]))
    transfer = cluster_transfer(train, combined_validation, history, split_manifest["policy"]["trainingClusters"], selected_scheme)

    holdout_selected = validation["asset-holdout"]["overall"][selected_scheme]
    yearly_pass = all(
        cohort["byYear"][year][selected_scheme]["meanAbsoluteCoverageError"] <= 0.075
        for cohort in validation.values() for year in ("2023", "2024")
    )
    holdout_asset_pass_rate = float(np.mean([
        metrics[selected_scheme]["meanAbsoluteCoverageError"] <= 0.10
        for metrics in validation["asset-holdout"]["byAsset"].values()
    ]))
    transfer_pass_rate = float(np.mean([item["selectedMetrics"]["meanAbsoluteCoverageError"] <= 0.10 for item in transfer]))
    crypto = next(item for item in transfer if item["cluster"] == "crypto")
    crypto_pass = crypto["selectedMetrics"]["meanAbsoluteCoverageError"] <= 0.10
    status = "interval-revision-passed" if holdout_selected["meanAbsoluteCoverageError"] <= 0.05 and yearly_pass and holdout_asset_pass_rate >= 0.80 and transfer_pass_rate == 1.0 and crypto_pass else "interval-revision-required"
    decision_notes = [
        f"선택 방식 `{selected_scheme}`의 holdout 평균 포함률 오차는 {holdout_selected['meanAbsoluteCoverageError'] * 100:.1f}%p입니다.",
        f"연도별 게이트={yearly_pass}, holdout 개별자산 통과율={holdout_asset_pass_rate * 100:.1f}%, 경제군 전이 통과율={transfer_pass_rate * 100:.1f}%, 코인 전이={crypto_pass}.",
        f"상태: `{status}`.",
        "rolling252는 해당 자산의 직전 252개 실제/예측 오차만 사용하며 현재 결과나 미래 오차는 사용하지 않습니다.",
        "이 연구가 통과하더라도 기존 후보 명세는 자동 변경하지 않고 별도 v2 명세로 동결해야 합니다.",
    ]
    report = {
        "schemaVersion": 1,
        "intervalResearchId": INTERVAL_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "candidateArtifactSha256": load_json(CALIBRATION_DIR / "manifest.json")["artifactSha256"],
        "dataAudit": {**data_audit, **history_audit},
        "protocol": {"lookback": LOOKBACK, "shrinkageStrength": SHRINKAGE_STRENGTH, "selection": "seen validation error, then narrowest interval within 0.5 percentage points"},
        "selectedScheme": selected_scheme,
        "validation": validation,
        "clusterTransfer": transfer,
        "gates": {"yearlyPass": yearly_pass, "holdoutAssetPassRate": holdout_asset_pass_rate, "transferPassRate": transfer_pass_rate, "cryptoPass": crypto_pass},
        "status": status,
        "verification": {"sealedTestLabelsUsed": 0, "adaptiveQuantilesUseStrictlyPrior252Outcomes": True, "appFormulaChanged": False},
        "decisionNotes": decision_notes,
    }
    safe = calibration.json_safe(report)
    (OUTPUT_DIR / "interval-results.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "report.md").write_text(markdown_report(safe), encoding="utf-8")
    manifest = {"schemaVersion": 1, "intervalResearchId": INTERVAL_ID, "generatedAt": report["generatedAt"], "candidateArtifactSha256": report["candidateArtifactSha256"], "selectedScheme": selected_scheme, "status": status, "sealedTestLabelsUsed": 0, "appFormulaChanged": False}
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] status={status}", flush=True)
    print(f"[done] {OUTPUT_DIR.relative_to(ROOT).as_posix()}", flush=True)


if __name__ == "__main__":
    main()
