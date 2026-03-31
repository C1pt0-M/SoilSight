from __future__ import annotations

from typing import Any, Dict, List, Tuple

import numpy as np

from ..models import PlanSession, SHIData
from .lit_params import (
    BASELINE_DRIFT_PARAMS,
    SCENARIO_PARAMS,
    collect_parameter_sources,
    get_drift_tier,
)
from .planning import OBJECTIVE_COMPONENT_BONUS, default_constraints, default_objective

N_MC_SAMPLES = 200
DRIFT_DAMPING_INTERVENTION = 0.45

IRRIGATION_FULL = "\u5145\u8db3"
IRRIGATION_LIMITED = "\u6709\u9650"
IRRIGATION_NONE = "\u65e0"

STAGE_LABELS = (
    "\u5f53\u524d",
    "\u7b2c\u4e00\u9636\u6bb5",
    "\u7b2c\u4e8c\u9636\u6bb5",
    "\u7b2c\u4e09\u9636\u6bb5",
)

IRRIGATION_SPEED_MULTIPLIER = {
    IRRIGATION_FULL: 1.08,
    IRRIGATION_LIMITED: 1.0,
    IRRIGATION_NONE: 0.72,
}
IRRIGATION_IMPACT_MULTIPLIER = {
    IRRIGATION_FULL: {"water": 1.15, "salinity": 1.08, "prod": 1.04},
    IRRIGATION_LIMITED: {},
    IRRIGATION_NONE: {"water": 0.30, "salinity": 0.70, "prod": 0.88},
}
PROGRESS_MODE_SPEED_MULTIPLIER = {
    "aggressive": 1.15,
    "stable": 1.0,
    "conservative": 0.88,
}
PROGRESS_MODE_IMPACT_MULTIPLIER = {
    "aggressive": 1.08,
    "stable": 1.0,
    "conservative": 0.90,
}
STAGE_UNITS = {
    "aggressive": np.array([2.5, 5.5, 8.5], dtype=np.float64),
    "stable": np.array([2.0, 5.0, 8.0], dtype=np.float64),
    "conservative": np.array([1.5, 4.0, 7.0], dtype=np.float64),
}
GENERIC_SCORE_WEIGHTS = {
    "prod": 0.25,
    "stab": 0.15,
    "soil": 0.35,
    "water": 0.25,
    "terrain": 0.10,
}
PROFILE_SCORE_WEIGHTS = {
    "cotton": {"soil": 0.25, "water": 0.30, "salinity": 0.30, "terrain": 0.15},
    "sugarbeet": {"soil": 0.35, "water": 0.30, "salinity": 0.20, "terrain": 0.15},
    "maize": {"soil": 0.30, "water": 0.35, "salinity": 0.20, "terrain": 0.15},
}


def resolve_progress_mode(raw: str | None = None) -> str:
    token = str(raw or "").strip().lower()
    if token in STAGE_UNITS:
        return token
    return "stable"


def _session_param_adjustments(session: PlanSession, comp_keys: list[str]) -> tuple[float, np.ndarray]:
    objective_bonus = OBJECTIVE_COMPONENT_BONUS.get(default_objective(session.objective), {})
    irrigation = default_constraints({"constraints": session.constraints}).get("irrigation", IRRIGATION_LIMITED)
    impact_scale = np.ones(len(comp_keys), dtype=np.float64)
    for ci, key in enumerate(comp_keys):
        impact_scale[ci] *= 1.0 + objective_bonus.get(f"{key}_norm", 0.0) * 3.0
        impact_scale[ci] *= IRRIGATION_IMPACT_MULTIPLIER.get(irrigation, {}).get(key, 1.0)
    return IRRIGATION_SPEED_MULTIPLIER.get(irrigation, 1.0), impact_scale


def clamp01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def compute_shi_from_components(components: Dict[str, float | None]) -> float:
    used: Dict[str, float] = {}
    for key, weight in GENERIC_SCORE_WEIGHTS.items():
        value = components.get(key)
        if value is not None and np.isfinite(value):
            used[key] = weight
    if not used:
        return 0.0
    total_w = sum(used.values())
    score = 0.0
    for key, weight in used.items():
        score += (weight / total_w) * float(components[key])
    return float(100.0 * score)


def compute_profile_score_from_components(components: Dict[str, float | None], score_profile_id: str) -> float:
    profile_id = str(score_profile_id or "general").strip().lower()
    weights = PROFILE_SCORE_WEIGHTS.get(profile_id, GENERIC_SCORE_WEIGHTS)
    used: Dict[str, float] = {}
    for key, weight in weights.items():
        value = components.get(key)
        if value is not None and np.isfinite(value):
            used[key] = weight
    if not used:
        return 0.0
    total_w = sum(used.values())
    score = 0.0
    for key, weight in used.items():
        score += (weight / total_w) * float(components[key])
    return float(100.0 * score)


def _compute_shi_array(comp_arr: np.ndarray, comp_keys: list[str]) -> np.ndarray:
    weights = np.array([GENERIC_SCORE_WEIGHTS.get(k, 0.0) for k in comp_keys], dtype=np.float64)
    total_w = weights.sum()
    if total_w == 0:
        return np.zeros(comp_arr.shape[:2], dtype=np.float64)
    w = weights / total_w
    return 100.0 * np.einsum("nmc,c->nm", comp_arr, w)


def _compute_profile_score_array(comp_arr: np.ndarray, comp_keys: list[str], score_profile_id: str) -> np.ndarray:
    profile_id = str(score_profile_id or "general").strip().lower()
    weights_map = PROFILE_SCORE_WEIGHTS.get(profile_id, GENERIC_SCORE_WEIGHTS)
    weights = np.array([weights_map.get(k, 0.0) for k in comp_keys], dtype=np.float64)
    total_w = weights.sum()
    if total_w == 0:
        return np.zeros(comp_arr.shape[:2], dtype=np.float64)
    w = weights / total_w
    return 100.0 * np.einsum("nmc,c->nm", comp_arr, w)


def baseline_drift(base_shi: float) -> Dict[str, float]:
    tier = get_drift_tier(base_shi)
    params = BASELINE_DRIFT_PARAMS[tier]
    return {k: v.mean for k, v in params.items()}


def finite_or_none(value: float | int | None) -> float | None:
    if value is None:
        return None
    try:
        val = float(value)
    except Exception:
        return None
    if not np.isfinite(val):
        return None
    if val <= -9000:
        return None
    return val


def build_ml_reference(
    *,
    data: SHIData,
    row: int,
    col: int,
    base_shi: float,
    rule_expected_end_shi: float | None,
    spatial_model: Any | None = None,
    scenario_pack_id: str | None = None,
) -> Dict[str, Any] | None:
    if spatial_model is not None and scenario_pack_id is not None:
        try:
            ref = spatial_model.predict_what_if(data, row, col, scenario_pack_id)
            if ref is not None:
                ref["base_shi_click"] = round(float(base_shi), 3)
                if rule_expected_end_shi is not None and ref.get("pred_end_shi") is not None:
                    ref["rule_expected_end_shi"] = round(float(rule_expected_end_shi), 3)
                    ref["difference_vs_rule_expected"] = round(float(ref["pred_end_shi"] - rule_expected_end_shi), 3)
                return ref
        except Exception:
            pass

    if data.ml_delta_pred is None and data.ml_shi_end_pred is None:
        return None
    if row < 0 or row >= data.grid.height or col < 0 or col >= data.grid.width:
        return None

    pred_delta = finite_or_none(data.ml_delta_pred[row, col] if data.ml_delta_pred is not None else None)
    pred_end = finite_or_none(data.ml_shi_end_pred[row, col] if data.ml_shi_end_pred is not None else None)

    if pred_end is None and pred_delta is None:
        return None
    if pred_end is None and pred_delta is not None:
        pred_end = float(np.clip(base_shi + pred_delta, 0.0, 100.0))
    if pred_delta is None and pred_end is not None:
        pred_delta = float(pred_end - base_shi)

    base_shi_feature_year = None
    if pred_end is not None and pred_delta is not None:
        base_shi_feature_year = float(pred_end - pred_delta)
    elif pred_end is not None:
        base_shi_feature_year = float(pred_end)
    elif pred_delta is not None:
        base_shi_feature_year = float(base_shi)

    out: Dict[str, Any] = {
        "model_type": data.ml_model_type,
        "feature_year": data.ml_feature_year,
        "target_year": data.ml_target_year,
        "base_shi_click": round(float(base_shi), 3),
        "base_shi_feature_year": round(float(base_shi_feature_year), 3) if base_shi_feature_year is not None else None,
        "pred_delta_shi": round(float(pred_delta), 3) if pred_delta is not None else None,
        "pred_end_shi": round(float(pred_end), 3) if pred_end is not None else None,
        "uncertainty_note": "\u004d\u004c \u9884\u6d4b\u53cd\u6620\u5386\u53f2\u7edf\u8ba1\u8d8b\u52bf\uff0c\u4e0d\u4ee3\u8868\u63aa\u65bd\u5b9e\u65bd\u7684\u56e0\u679c\u6548\u679c\u3002",
    }
    comparable = (
        rule_expected_end_shi is not None
        and pred_end is not None
        and base_shi_feature_year is not None
        and abs(float(base_shi_feature_year) - float(base_shi)) <= 2.0
    )
    if comparable:
        out["rule_expected_end_shi"] = round(float(rule_expected_end_shi), 3)
        out["difference_vs_rule_expected"] = round(float(pred_end - rule_expected_end_shi), 3)
    elif rule_expected_end_shi is not None and pred_end is not None:
        out["comparability_note"] = "\u004d\u004c \u57fa\u7ebf\u4e0e\u5f53\u524d\u70b9\u51fb\u53e3\u5f84\u4e0d\u4e00\u81f4\uff0c\u672a\u8ba1\u7b97\u4e0e\u89c4\u5219\u6a21\u62df\u7684\u76f4\u63a5\u5dee\u503c\u3002"
    return out


def _sample_params(pack_id: str, n: int, rng: np.random.Generator) -> Tuple[np.ndarray, np.ndarray, list[str]]:
    params = SCENARIO_PARAMS.get(pack_id)
    if params is None:
        params = SCENARIO_PARAMS["integrated_stable"]

    sp = params["speed"]
    speeds_raw = rng.normal(sp.mean, sp.std, size=n)
    speeds = np.clip(speeds_raw, 0.01, None)

    comp_keys = list(params["impacts"].keys())
    impacts = np.empty((n, len(comp_keys)), dtype=np.float64)
    for ci, key in enumerate(comp_keys):
        lp = params["impacts"][key]
        raw = rng.normal(lp.mean, lp.std, size=n)
        impacts[:, ci] = np.clip(raw, 0.0, None)

    return speeds, impacts, comp_keys


def _sample_drift(base_shi: float, n: int, comp_keys: list[str], rng: np.random.Generator) -> np.ndarray:
    tier = get_drift_tier(base_shi)
    params = BASELINE_DRIFT_PARAMS[tier]
    drift = np.empty((n, len(comp_keys)), dtype=np.float64)
    for ci, key in enumerate(comp_keys):
        lp = params.get(key)
        if lp is None:
            drift[:, ci] = 0.0
        else:
            raw = rng.normal(lp.mean, lp.std, size=n)
            drift[:, ci] = np.minimum(raw, 0.0) if lp.mean <= 0 else raw
    return drift


def _run_mc_final_shi(
    base_arr: np.ndarray,
    speeds: np.ndarray,
    impacts: np.ndarray,
    drift_samples: np.ndarray,
    comp_keys: list[str],
    stage_units: np.ndarray,
    score_profile_id: str,
) -> np.ndarray:
    exp_term = np.exp(-speeds[:, None] * stage_units[None, :])
    growth = impacts[:, None, :] * (1.0 - exp_term[:, :, None])
    drift_trend = drift_samples[:, None, :] * stage_units[None, :, None] * DRIFT_DAMPING_INTERVENTION
    intervention = np.clip(base_arr[None, None, :] + growth + drift_trend, 0.0, 1.0)
    shi_all = _compute_profile_score_array(intervention, comp_keys, score_profile_id)
    return shi_all[:, -1]


def compute_sensitivity(
    pack_id: str,
    base: Dict[str, float],
    base_shi: float,
    stage_units: np.ndarray,
    session: PlanSession | None = None,
    score_profile_id: str = "general",
    progress_mode: str = "stable",
) -> List[Dict[str, Any]]:
    n_oat = 200
    rng = np.random.default_rng(123)

    speeds_full, impacts_full, comp_keys = _sample_params(pack_id, n_oat, rng)
    if session is not None:
        speed_scale, impact_scale = _session_param_adjustments(session, comp_keys)
        speeds_full = np.clip(speeds_full * speed_scale * PROGRESS_MODE_SPEED_MULTIPLIER[progress_mode], 0.01, None)
        impacts_full = impacts_full * impact_scale[None, :] * PROGRESS_MODE_IMPACT_MULTIPLIER[progress_mode]
    drift_full = _sample_drift(base_shi, n_oat, comp_keys, rng)
    base_arr = np.array([base.get(k, 0.5) for k in comp_keys], dtype=np.float64)

    shi_full = _run_mc_final_shi(base_arr, speeds_full, impacts_full, drift_full, comp_keys, stage_units, score_profile_id)
    var_total = float(np.var(shi_full))
    if var_total < 1e-12:
        params = SCENARIO_PARAMS.get(pack_id, SCENARIO_PARAMS["integrated_stable"])
        all_param_names = ["speed"] + [f"{k}_impact" for k in params["impacts"].keys()]
        return [{"parameter": p, "sensitivity": 0.0, "var_contribution": 0.0} for p in all_param_names]

    params = SCENARIO_PARAMS.get(pack_id, SCENARIO_PARAMS["integrated_stable"])
    sp = params["speed"]
    impact_keys = list(params["impacts"].keys())
    speed_mean = sp.mean
    impact_means = np.array([params["impacts"][k].mean for k in impact_keys], dtype=np.float64)
    drift_mean_arr = np.array([
        BASELINE_DRIFT_PARAMS[get_drift_tier(base_shi)].get(k, BASELINE_DRIFT_PARAMS[get_drift_tier(base_shi)]["terrain"]).mean
        for k in comp_keys
    ], dtype=np.float64)

    results: List[Dict[str, Any]] = []
    rng2 = np.random.default_rng(456)
    speed_varied = np.clip(rng2.normal(sp.mean, sp.std, size=n_oat), 0.01, None)
    fixed_impacts = np.tile(impact_means, (n_oat, 1))
    fixed_drift = np.tile(drift_mean_arr, (n_oat, 1))
    shi_speed = _run_mc_final_shi(base_arr, speed_varied, fixed_impacts, fixed_drift, comp_keys, stage_units, score_profile_id)
    var_speed = float(np.var(shi_speed))
    results.append({"parameter": "speed", "sensitivity": round(var_speed / var_total, 4), "var_contribution": round(var_speed, 6)})

    for ci, key in enumerate(impact_keys):
        rng3 = np.random.default_rng(789 + ci)
        lp = params["impacts"][key]
        fixed_speeds = np.full(n_oat, speed_mean)
        oat_impacts = np.tile(impact_means, (n_oat, 1))
        oat_impacts[:, ci] = np.clip(rng3.normal(lp.mean, lp.std, size=n_oat), 0.0, None)
        shi_oat = _run_mc_final_shi(base_arr, fixed_speeds, oat_impacts, fixed_drift, comp_keys, stage_units, score_profile_id)
        var_i = float(np.var(shi_oat))
        results.append({"parameter": f"{key}_impact", "sensitivity": round(var_i / var_total, 4), "var_contribution": round(var_i, 6)})

    results.sort(key=lambda x: x["sensitivity"], reverse=True)
    return results


def run_simulation(
    session: PlanSession,
    scenario_pack: Dict[str, Any],
    progress_mode: str | None = None,
    data: SHIData | None = None,
    spatial_model: Any | None = None,
) -> Dict[str, Any]:
    progress_mode = resolve_progress_mode(progress_mode or getattr(session, "progress_mode", None))
    stage_units = STAGE_UNITS[progress_mode]
    score_profile_id = str(getattr(session, "score_profile_id", "general") or "general").strip().lower()

    snap_comp = session.snapshot.get("components", {})
    base = {
        "prod": float(snap_comp.get("prod_norm", 0.5)),
        "stab": float(snap_comp.get("stab_norm", 0.5)),
        "soil": float(snap_comp.get("soil_norm", 0.5) if snap_comp.get("soil_norm") is not None else 0.5),
        "water": float(snap_comp.get("water_norm", 0.5) if snap_comp.get("water_norm") is not None else 0.5),
        "salinity": float(snap_comp.get("salinity_norm", 0.5) if snap_comp.get("salinity_norm") is not None else 0.5),
        "terrain": float(snap_comp.get("terrain_norm", 0.5) if snap_comp.get("terrain_norm") is not None else 0.5),
    }
    base_shi = float(session.snapshot.get("shi_score", compute_profile_score_from_components(base, score_profile_id)))

    pack_id = str(scenario_pack.get("id", "integrated_stable"))
    rng = np.random.default_rng(42)
    speeds, impacts, comp_keys = _sample_params(pack_id, N_MC_SAMPLES, rng)
    speed_scale, impact_scale = _session_param_adjustments(session, comp_keys)
    speeds = np.clip(speeds * speed_scale * PROGRESS_MODE_SPEED_MULTIPLIER[progress_mode], 0.01, None)
    impacts = impacts * impact_scale[None, :] * PROGRESS_MODE_IMPACT_MULTIPLIER[progress_mode]
    drift_samples = _sample_drift(base_shi, N_MC_SAMPLES, comp_keys, rng)

    base_arr = np.array([base.get(k, 0.5) for k in comp_keys], dtype=np.float64)
    exp_term = np.exp(-speeds[:, None] * stage_units[None, :])
    growth = impacts[:, None, :] * (1.0 - exp_term[:, :, None])
    drift_trend = drift_samples[:, None, :] * stage_units[None, :, None] * DRIFT_DAMPING_INTERVENTION
    intervention = np.clip(base_arr[None, None, :] + growth + drift_trend, 0.0, 1.0)
    shi_all = _compute_profile_score_array(intervention, comp_keys, score_profile_id)

    percentiles = np.percentile(shi_all, [10, 25, 50, 75, 90], axis=0)
    p10, p25, p50, p75, p90 = percentiles

    def build_stage_series_from_percentile(pct_arr: np.ndarray) -> list[Dict[str, float]]:
        current_entry: Dict[str, float] = {
            "stage_index": 0.0,
            "shi": round(float(base_shi), 3),
            **{key: round(float(base.get(key, 0.5)), 4) for key in comp_keys},
        }
        series: list[Dict[str, float]] = [current_entry]
        for si in range(len(stage_units)):
            stage_shi = shi_all[:, si]
            sample_idx = int(np.abs(stage_shi - pct_arr[si]).argmin())
            rounded_components = {key: round(float(intervention[sample_idx, si, ci]), 4) for ci, key in enumerate(comp_keys)}
            series.append({
                "stage_index": float(si + 1),
                "shi": round(compute_profile_score_from_components(rounded_components, score_profile_id), 3),
                **rounded_components,
            })
        return series

    drift_mean = baseline_drift(base_shi)
    baseline_series: list[Dict[str, float]] = [{
        "stage_index": 0.0,
        "shi": round(float(base_shi), 3),
        **{key: round(float(base.get(key, 0.5)), 4) for key in comp_keys},
    }]
    for si, unit in enumerate(stage_units, start=1):
        stage_components: Dict[str, float] = {}
        for ci, key in enumerate(comp_keys):
            trend = drift_mean.get(key, 0.0) * unit
            stage_components[key] = clamp01(base_arr[ci] + trend)
        baseline_series.append({
            "stage_index": float(si),
            "shi": round(compute_profile_score_from_components(stage_components, score_profile_id), 3),
            **{key: round(float(stage_components[key]), 4) for key in comp_keys},
        })

    expected_series = build_stage_series_from_percentile(p50)
    conservative_series = build_stage_series_from_percentile(p25)
    optimistic_series = build_stage_series_from_percentile(p75)
    outputs = {
        "baseline": baseline_series,
        "expected": expected_series,
        "conservative": conservative_series,
        "optimistic": optimistic_series,
    }

    percentile_bands: list[Dict[str, float]] = [{
        "stage_index": 0.0,
        "p10": round(float(base_shi), 3),
        "p25": round(float(base_shi), 3),
        "p50": round(float(base_shi), 3),
        "p75": round(float(base_shi), 3),
        "p90": round(float(base_shi), 3),
    }]
    for si in range(len(stage_units)):
        percentile_bands.append({
            "stage_index": float(si + 1),
            "p10": round(float(p10[si]), 3),
            "p25": round(float(p25[si]), 3),
            "p50": round(float(p50[si]), 3),
            "p75": round(float(p75[si]), 3),
            "p90": round(float(p90[si]), 3),
        })

    comparison = {
        "baseline_end_shi": outputs["baseline"][-1]["shi"],
        "expected_end_shi": outputs["expected"][-1]["shi"],
        "conservative_end_shi": outputs["conservative"][-1]["shi"],
        "optimistic_end_shi": outputs["optimistic"][-1]["shi"],
        "expected_delta_shi": round(outputs["expected"][-1]["shi"] - base_shi, 3),
    }

    result: Dict[str, Any] = {
        "progress_mode": progress_mode,
        "stage_count": len(STAGE_LABELS),
        "stage_labels": list(STAGE_LABELS),
        "series": outputs,
        "comparison": comparison,
        "percentile_bands": percentile_bands,
        "has_monte_carlo": True,
        "n_samples": N_MC_SAMPLES,
        "parameter_sources": collect_parameter_sources(pack_id),
        "sensitivity": compute_sensitivity(
            pack_id,
            base,
            base_shi,
            stage_units,
            session=session,
            score_profile_id=score_profile_id,
            progress_mode=progress_mode,
        ),
        "uncertainty_note": "\u5f53\u524d\u7ed3\u679c\u4e3a\u9636\u6bb5\u5f0f\u60c5\u666f\u63a8\u6f14\uff0c\u533a\u95f4\u5e26\u53cd\u6620\u6587\u732e\u53c2\u6570\u4e0d\u786e\u5b9a\u6027\uff0c\u4e0d\u4ee3\u8868\u9010\u6708\u771f\u5b9e\u9884\u6d4b\u3002",
    }

    if data is not None:
        ml_reference = build_ml_reference(
            data=data,
            row=int(session.row),
            col=int(session.col),
            base_shi=base_shi,
            rule_expected_end_shi=float(comparison["expected_end_shi"]),
            spatial_model=spatial_model,
            scenario_pack_id=pack_id,
        )
        if ml_reference is not None:
            result["ml_reference"] = ml_reference
    return result
