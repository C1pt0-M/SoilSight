from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np

from ..geo_lookup import GeoLookup
from ..models import SHIData


PROFILE_THRESHOLDS = {
    "cotton": 0.5,
    "sugarbeet": 0.2,
    "maize": 0.2,
}

PROFILE_GRADE_THRESHOLDS = {
    "general": (35.0, 65.0),
    "cotton": (45.0, 60.0),
    "sugarbeet": (35.0, 65.0),
    "maize": (40.0, 60.0),
}

PROFILE_META = {
    "general": {
        "score_name": "耕地基础评分",
        "profile_id": "general_profile",
        "profile_name": "耕地基础 profile",
        "support_label": "耕地",
    },
    "cotton": {
        "score_name": "棉花 profile 评分",
        "profile_id": "cotton_profile",
        "profile_name": "棉花 profile",
        "support_label": "棉花",
    },
    "sugarbeet": {
        "score_name": "甜菜 profile 评分",
        "profile_id": "sugarbeet_profile",
        "profile_name": "甜菜 profile",
        "support_label": "甜菜",
    },
    "maize": {
        "score_name": "玉米 profile 评分",
        "profile_id": "maize_profile",
        "profile_name": "玉米 profile",
        "support_label": "玉米",
    },
}


def lonlat_to_rowcol(lon: float, lat: float, data: SHIData) -> Tuple[int, int]:
    lon_rad = np.deg2rad(lon)
    lat_rad = np.deg2rad(lat)
    x = data.grid.radius_m * lon_rad * np.cos(lat_rad)
    y = data.grid.radius_m * lat_rad
    col = int(np.floor((x - data.grid.x0) / data.grid.sx))
    row = int(np.floor((data.grid.y0 - y) / data.grid.sy))
    return row, col


def rowcol_to_lonlat(row: int, col: int, data: SHIData) -> Tuple[float, float]:
    x = data.grid.x0 + (float(col) + 0.5) * data.grid.sx
    y = data.grid.y0 - (float(row) + 0.5) * data.grid.sy
    lat_rad = y / data.grid.radius_m
    cos_lat = np.cos(lat_rad)
    if abs(float(cos_lat)) < 1e-12:
        lon_rad = 0.0
    else:
        lon_rad = x / (data.grid.radius_m * cos_lat)
    lon = float(np.rad2deg(lon_rad))
    lat = float(np.rad2deg(lat_rad))
    return lon, lat


def finite_or_none(value: float) -> float | None:
    return float(value) if np.isfinite(value) else None


def normalized_or_none(value: float, min_value: float = 0.0, max_value: float = 1.0) -> float | None:
    if not np.isfinite(value):
        return None
    val = float(value)
    if val < min_value or val > max_value:
        return None
    return val


def level_name(code: int) -> str:
    if code == 1:
        return "不健康"
    if code == 2:
        return "亚健康"
    if code == 3:
        return "健康"
    return "未评估"


def get_score_profile_id(data: SHIData) -> str:
    raw = str(getattr(data, "score_profile_id", "cotton") or "cotton").strip().lower()
    if raw in PROFILE_META:
        return raw
    return "cotton"


def get_score_profile_name(profile_id: str) -> str:
    if profile_id in PROFILE_META:
        return PROFILE_META[profile_id]["score_name"]
    return "当前作物 profile 评分"


def get_grade_thresholds(score_profile_id: str) -> tuple[float, float]:
    profile_id = str(score_profile_id or "").strip().lower()
    return PROFILE_GRADE_THRESHOLDS.get(profile_id, PROFILE_GRADE_THRESHOLDS["cotton"])


def not_evaluated_reason_for_profile(
    profile_id: str,
    crop_frac: float,
    cotton_frac: float | None,
    sugarbeet_frac: float | None,
    maize_frac: float | None,
) -> str:
    if profile_id == "cotton" and np.isfinite(crop_frac) and float(crop_frac) >= 0.2:
        if cotton_frac is None or not np.isfinite(cotton_frac) or float(cotton_frac) < PROFILE_THRESHOLDS["cotton"]:
            return "outside_cotton_profile_scope"
    if profile_id == "sugarbeet" and np.isfinite(crop_frac) and float(crop_frac) >= 0.2:
        if (
            sugarbeet_frac is None
            or not np.isfinite(sugarbeet_frac)
            or float(sugarbeet_frac) < PROFILE_THRESHOLDS["sugarbeet"]
        ):
            return "outside_sugarbeet_profile_scope"
    if profile_id == "maize" and np.isfinite(crop_frac) and float(crop_frac) >= 0.2:
        if maize_frac is None or not np.isfinite(maize_frac) or float(maize_frac) < PROFILE_THRESHOLDS["maize"]:
            return "outside_maize_profile_scope"
    return "non_cropland_or_missing"


def build_advice(
    score: float,
    prod: float | None,
    stab: float | None,
    crop_frac: float,
    soil: float | None = None,
    water: float | None = None,
    salinity: float | None = None,
    terrain: float | None = None,
    drought_risk: float | None = None,
    heat_risk: float | None = None,
    data_quality: int | None = None,
    score_profile_id: str = "cotton",
) -> list[str]:
    advice: list[str] = []
    if crop_frac < 0.2:
        return ["该像元耕地占比较低，当前口径不予评估。"]

    profile_id = str(score_profile_id or "").strip().lower()
    is_sugarbeet = profile_id == "sugarbeet"
    is_maize = profile_id == "maize"
    low_threshold, high_threshold = get_grade_thresholds(profile_id)

    if data_quality is not None and data_quality < 4:
        missing = []
        if soil is None:
            missing.append("土壤本底")
        if water is None:
            missing.append("供水支撑")
        if salinity is None:
            missing.append("盐分安全")
        if terrain is None:
            missing.append("地形约束")
        hint = f"（缺少{'、'.join(missing)}层）" if missing else ""
        advice.append(f"该像元仅有{data_quality}/4项主分量数据{hint}，评分基于可用主分量加权计算。")

    if score < low_threshold:
        if is_sugarbeet:
            advice.append("优先稳住甜菜地块的供水与控盐，再逐步补强土壤本底。")
            advice.append("建议维持灌排连续性，避免盐分回升与根区持续失水。")
        elif is_maize:
            advice.append("优先稳住玉米地块的供水连续性，再同步排查盐分与地力短板。")
            advice.append("建议围绕灌溉窗口、保墒覆盖和根区稳水组织管理。")
        else:
            advice.append("优先稳住供水与控盐，再叠加有机质回补和覆盖管理。")
            advice.append("建议小水勤灌，避免一次性大水漫灌与次生盐渍化。")
    elif score < high_threshold:
        if is_sugarbeet:
            advice.append("优先保持甜菜地块稳水、控盐和地力投入的连续性，避免短板反复回落。")
            advice.append("管理上先稳主分量，再追求额外产量提升。")
        elif is_maize:
            advice.append("优先保持玉米地块供水连续性和根区稳水，再逐步补强土壤本底与控盐。")
            advice.append("管理上先稳主分量，再追求额外增产。")
        else:
            advice.append("优先保持稳水、控盐和覆盖管理连续性，避免短板反复回落。")
            advice.append("水肥管理采用稳健策略，先稳主分量，再追求额外增产。")
    else:
        if is_sugarbeet:
            advice.append("当前甜菜主分状态较好，保持稳水、控盐和地力平衡管理并持续监测。")
        elif is_maize:
            advice.append("当前玉米主分状态较好，继续保持稳水、控盐和地力平衡管理。")
        else:
            advice.append("当前主分状态较好，保持现有稳水、控盐和改土策略并持续监测。")

    if prod is not None and prod < 0.35:
        if is_sugarbeet:
            advice.append("作物表现代理偏低：建议结合甜菜地块的供水、盐分和地力短板一起排查。")
        elif is_maize:
            advice.append("作物表现代理偏低：建议结合玉米地块供水、盐分和土壤本底短板一起排查。")
        else:
            advice.append("作物表现代理偏低：建议结合供水、盐分和地力短板一起排查。")
    if stab is not None and stab < 0.35:
        if is_sugarbeet:
            advice.append("作物表现波动偏大：建议复核灌排节奏、地表覆盖和极端天气应对。")
        elif is_maize:
            advice.append("作物表现波动偏大：玉米对水分波动敏感，建议复核灌溉节奏与保墒覆盖。")
        else:
            advice.append("作物表现波动偏大：建议复核灌溉节奏、覆盖管理和高温/干旱应对。")
    if soil is not None and soil < 0.35:
        if is_sugarbeet:
            advice.append("土壤本底偏弱：甜菜更依赖稳定地力，建议优先补充有机质并保持 pH 适宜。")
        elif is_maize:
            advice.append("土壤本底偏弱：建议优先补强有机质、缓冲能力和适宜 pH。")
        else:
            advice.append("土壤本底偏弱：优先提升有机质，关注 pH 和团聚结构改良。")
    if water is not None and water < 0.35:
        if is_sugarbeet:
            advice.append("供水支撑偏弱：建议保持根区水分稳定，避免长时间失水。")
        elif is_maize:
            advice.append("供水支撑偏弱：玉米对根区失水敏感，建议优化灌溉频次并加强保墒。")
        else:
            advice.append("供水支撑偏弱：建议优化灌溉频次，避免土壤长期失水。")
    if salinity is not None and salinity < 0.35:
        if is_sugarbeet:
            advice.append("盐分安全偏弱：甜菜虽有一定耐盐性，但高盐仍会抑制根系生长，建议加强控盐/淋洗。")
        elif is_maize:
            advice.append("盐分安全偏弱：建议同步控制灌溉盐分输入与次生盐渍化风险。")
        else:
            advice.append("盐分安全偏弱：建议加强排盐、淋洗与有机改良，控制次生盐渍化。")
    if terrain is not None and terrain < 0.35:
        advice.append("地形约束偏强：建议重点防治坡面径流与土壤流失。")
    if drought_risk is not None and drought_risk >= 0.5:
        advice.append("干旱风险较高：建议高风险月份提前保墒与分次灌溉，避免土壤失水过快。")
    if heat_risk is not None and heat_risk >= 0.5:
        advice.append("热胁迫风险较高：建议优化高温期灌溉窗口并加强地表覆盖降温保墒。")
    return advice


def _normalized_support_value(value: float | None) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return float(np.clip(value, 0.0, 1.0))


def _compose_specific_profile_payload(profile_key: str, support_fraction: float) -> Dict[str, Any]:
    meta = PROFILE_META[profile_key]
    payload = {
        "profile_id": meta["profile_id"],
        "profile_name": meta["profile_name"],
        "support_fraction": round(support_fraction, 4),
        "support_label": meta["support_label"],
        "profile_reason": (
            f"近年{meta['support_label']}图层显示该 500m 像元{meta['support_label']}占比约"
            f"{support_fraction * 100:.0f}%，按{meta['support_label']}口径解释。"
        ),
    }
    if profile_key == "cotton":
        payload["cotton_fraction"] = round(support_fraction, 4)
    if profile_key == "sugarbeet":
        payload["sugarbeet_fraction"] = round(support_fraction, 4)
    if profile_key == "maize":
        payload["maize_fraction"] = round(support_fraction, 4)
    return payload


def compose_profile_payload(
    crop_frac: float,
    cotton_frac: float | None,
    sugarbeet_frac: float | None,
    maize_frac: float | None,
) -> Dict[str, Any] | None:
    if not np.isfinite(crop_frac) or float(crop_frac) < 0.2:
        return None

    cotton_value = _normalized_support_value(cotton_frac)
    sugarbeet_value = _normalized_support_value(sugarbeet_frac)
    maize_value = _normalized_support_value(maize_frac)

    candidates: list[tuple[str, float]] = []
    if cotton_value is not None and cotton_value >= PROFILE_THRESHOLDS["cotton"]:
        candidates.append(("cotton", cotton_value))
    if sugarbeet_value is not None and sugarbeet_value >= PROFILE_THRESHOLDS["sugarbeet"]:
        candidates.append(("sugarbeet", sugarbeet_value))
    if maize_value is not None and maize_value >= PROFILE_THRESHOLDS["maize"]:
        candidates.append(("maize", maize_value))
    if candidates:
        profile_key, support_fraction = max(candidates, key=lambda item: item[1])
        payload = _compose_specific_profile_payload(profile_key, support_fraction)
        if cotton_value is not None and "cotton_fraction" not in payload:
            payload["cotton_fraction"] = round(cotton_value, 4)
        if sugarbeet_value is not None and "sugarbeet_fraction" not in payload:
            payload["sugarbeet_fraction"] = round(sugarbeet_value, 4)
        if maize_value is not None and "maize_fraction" not in payload:
            payload["maize_fraction"] = round(maize_value, 4)
        return payload

    return None


def compose_crop_support_payload(prod: float | None, stab: float | None) -> Dict[str, Any] | None:
    if prod is None and stab is None:
        return None
    return {
        "ndvi_mean_norm": round(prod, 4) if prod is not None else None,
        "ndvi_stability_norm": round(stab, 4) if stab is not None else None,
        "note": "NDVI 均值/稳定性仅作作物表现旁路解释，不参与主分。",
    }


def compose_risk_payload(drought_risk: float | None, heat_risk: float | None) -> Dict[str, Any] | None:
    if drought_risk is None and heat_risk is None:
        return None
    values = [v for v in (drought_risk, heat_risk) if v is not None]
    if not values:
        return None
    combined = float(max(values))
    if combined >= 0.67:
        level = "高"
    elif combined >= 0.4:
        level = "中"
    else:
        level = "低"
    return {
        "drought_risk": round(drought_risk, 4) if drought_risk is not None else None,
        "heat_risk": round(heat_risk, 4) if heat_risk is not None else None,
        "combined_risk": round(combined, 4),
        "risk_level": level,
    }


def compose_temporal_meta(data: SHIData, row: int | None = None, col: int | None = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    if data.time_window_months:
        payload["time_window"] = [int(month) for month in data.time_window_months]
    if data.baseline_start_year <= data.baseline_end_year:
        payload["baseline_years"] = [int(data.baseline_start_year), int(data.baseline_end_year)]
    if (
        row is not None
        and col is not None
        and data.valid_years is not None
        and 0 <= row < data.grid.height
        and 0 <= col < data.grid.width
    ):
        coverage = float(data.valid_years[row, col])
        if np.isfinite(coverage) and coverage > 0:
            payload["data_coverage_years"] = int(round(coverage))
    return payload


def compose_ml_payload(data: SHIData, row: int, col: int) -> Dict[str, Any] | None:
    if data.ml_delta_pred is None and data.ml_shi_end_pred is None:
        return None
    pred_delta = None
    pred_end = None
    if data.ml_delta_pred is not None:
        pred_delta = finite_or_none(float(data.ml_delta_pred[row, col]))
    if data.ml_shi_end_pred is not None:
        pred_end = finite_or_none(float(data.ml_shi_end_pred[row, col]))
    if pred_delta is None and pred_end is None:
        return None
    payload: Dict[str, Any] = {}
    if pred_end is not None:
        payload["ml_pred_end_shi"] = round(pred_end, 2)
    if pred_delta is not None:
        payload["ml_pred_delta_shi"] = round(pred_delta, 2)
    if data.ml_feature_year is not None:
        payload["ml_feature_year"] = int(data.ml_feature_year)
    if data.ml_target_year is not None:
        payload["ml_target_year"] = int(data.ml_target_year)
    if data.ml_model_type is not None:
        payload["ml_model_type"] = data.ml_model_type
    return payload


def _build_location(geo: GeoLookup | None, lon: float, lat: float) -> Dict[str, Any] | None:
    if geo is None:
        return None
    result = geo.lookup(lon, lat)
    if result["prefecture"] is None and result["county"] is None:
        return None
    return result


def evaluate_click(data: SHIData, lon: float, lat: float, geo: GeoLookup | None = None) -> Dict[str, Any]:
    row, col = lonlat_to_rowcol(lon, lat, data)
    location = _build_location(geo, lon, lat)

    if row < 0 or row >= data.grid.height or col < 0 or col >= data.grid.width:
        outside_result: Dict[str, Any] = {
            "ok": True,
            "region_id": data.region_id,
            "lon": lon,
            "lat": lat,
            "in_grid": False,
            "status": "outside_aoi",
            "row": row,
            "col": col,
        }
        if location:
            outside_result["location"] = location
        outside_result.update(compose_temporal_meta(data))
        return outside_result

    sample_lon, sample_lat = rowcol_to_lonlat(row, col, data)

    score = float(data.score[row, col])
    cls = int(data.cls[row, col])
    prod = float(data.prod[row, col])
    stab = float(data.stab[row, col])
    soil = float(data.soil[row, col]) if data.soil is not None else float("nan")
    water = float(data.water[row, col]) if data.water is not None else float("nan")
    salinity = float(data.salinity[row, col]) if data.salinity is not None else float("nan")
    terrain = float(data.terrain[row, col]) if data.terrain is not None else float("nan")
    drought_risk = float(data.drought_risk[row, col]) if data.drought_risk is not None else float("nan")
    heat_risk = float(data.heat_risk[row, col]) if data.heat_risk is not None else float("nan")
    crop = float(data.crop[row, col])
    cotton = float(data.cotton[row, col]) if data.cotton is not None else float("nan")
    sugarbeet = float(data.sugarbeet[row, col]) if getattr(data, "sugarbeet", None) is not None else float("nan")
    maize = float(data.maize[row, col]) if getattr(data, "maize", None) is not None else float("nan")
    drought_risk_v = normalized_or_none(drought_risk)
    heat_risk_v = normalized_or_none(heat_risk)
    score_profile_id = get_score_profile_id(data)
    score_profile_name = get_score_profile_name(score_profile_id)
    risk = compose_risk_payload(drought_risk_v, heat_risk_v)
    profile_payload = compose_profile_payload(
        crop,
        normalized_or_none(cotton),
        normalized_or_none(sugarbeet),
        normalized_or_none(maize),
    )
    crop_support = compose_crop_support_payload(prod_v := normalized_or_none(prod), stab_v := normalized_or_none(stab))
    ml_payload = compose_ml_payload(data, row, col)

    if (not np.isfinite(score)) or score == data.nodata or cls == 0:
        not_eval_result: Dict[str, Any] = {
            "ok": True,
            "region_id": data.region_id,
            "lon": lon,
            "lat": lat,
            "in_grid": True,
            "status": "not_evaluated",
            "cropland_fraction": crop,
            "reason": not_evaluated_reason_for_profile(
                score_profile_id,
                crop,
                normalized_or_none(cotton),
                normalized_or_none(sugarbeet),
                normalized_or_none(maize),
            ),
            "score_profile_id": score_profile_id,
            "score_profile_name": score_profile_name,
            "row": row,
            "col": col,
            "sample_lon": sample_lon,
            "sample_lat": sample_lat,
        }
        if risk is not None:
            not_eval_result["risk"] = risk
        if profile_payload is not None:
            not_eval_result["profile"] = profile_payload
        if ml_payload is not None:
            not_eval_result.update(ml_payload)
        if location:
            not_eval_result["location"] = location
        not_eval_result.update(compose_temporal_meta(data, row, col))
        return not_eval_result

    soil_v = normalized_or_none(soil)
    water_v = normalized_or_none(water)
    salinity_v = normalized_or_none(salinity)
    terrain_v = normalized_or_none(terrain)
    dq_raw = int(data.data_quality[row, col]) if data.data_quality is not None else None

    result = {
        "ok": True,
        "region_id": data.region_id,
        "lon": lon,
        "lat": lat,
        "in_grid": True,
        "status": "evaluated",
        "score_profile_id": score_profile_id,
        "score_profile_name": score_profile_name,
        "shi_score": round(score, 2),
        "shi_level_code": cls,
        "shi_level": level_name(cls),
        "components": {
            "prod_norm": round(prod_v, 4) if prod_v is not None else None,
            "stab_norm": round(stab_v, 4) if stab_v is not None else None,
            "soil_base_norm": round(soil_v, 4) if soil_v is not None else None,
            "water_supply_norm": round(water_v, 4) if water_v is not None else None,
            "salt_safety_norm": round(salinity_v, 4) if salinity_v is not None else None,
            "soil_norm": round(soil_v, 4) if soil_v is not None else None,
            "water_norm": round(water_v, 4) if water_v is not None else None,
            "salinity_norm": round(salinity_v, 4) if salinity_v is not None else None,
            "terrain_norm": round(terrain_v, 4) if terrain_v is not None else None,
            "cropland_fraction": round(crop, 4),
            "data_quality": dq_raw,
        },
        "advice": build_advice(
            score,
            prod_v,
            stab_v,
            crop,
            soil_v,
            water_v,
            salinity_v,
            terrain_v,
            drought_risk_v,
            heat_risk_v,
            dq_raw,
            score_profile_id=score_profile_id,
        ),
        "row": row,
        "col": col,
        "sample_lon": sample_lon,
        "sample_lat": sample_lat,
    }
    if crop_support is not None:
        result["crop_support"] = crop_support
    if risk is not None:
        result["risk"] = risk
    if profile_payload is not None:
        result["profile"] = profile_payload
    if ml_payload is not None:
        result.update(ml_payload)
    if location:
        result["location"] = location
    result.update(compose_temporal_meta(data, row, col))
    return result
