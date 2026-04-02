"""County-level SHI statistics — aggregate raster pixels per admin boundary."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import List, Tuple

import numpy as np

from ..geo_lookup import AdminFeature, GeoLookup, _point_in_multipolygon
from ..models import SHIData

logger = logging.getLogger(__name__)

SAMPLE_STEP = 3  # sample every Nth pixel inside bbox for speed
COUNTY_STATS_CACHE_VERSION = 2

CONSTRAINT_LABELS = {
    "soil": "土壤本底",
    "water": "供水支撑",
    "salinity": "盐分安全",
    "terrain": "地形约束",
}


def _mean_or_none(values: list[float]) -> float | None:
    if not values:
        return None
    return round(float(np.mean(np.array(values, dtype=np.float32))), 2)


def _build_constraint_summary(
    *,
    soil_values: list[float],
    water_values: list[float],
    salinity_values: list[float],
    terrain_values: list[float],
) -> dict[str, float | str | None]:
    means = {
        "soil_mean": _mean_or_none(soil_values),
        "water_mean": _mean_or_none(water_values),
        "salinity_mean": _mean_or_none(salinity_values),
        "terrain_mean": _mean_or_none(terrain_values),
    }
    candidates = {
        "soil": means["soil_mean"],
        "water": means["water_mean"],
        "salinity": means["salinity_mean"],
        "terrain": means["terrain_mean"],
    }
    available = {key: value for key, value in candidates.items() if value is not None}
    dominant_key = min(available, key=available.get) if available else None
    means["dominant_constraint"] = CONSTRAINT_LABELS.get(dominant_key) if dominant_key else None
    return means


def _priority_level_for_stats(*, score_profile_id: str, shi_mean: float, unhealthy_pct: float) -> str:
    from .evaluation import get_grade_thresholds

    low, high = get_grade_thresholds(score_profile_id)
    if shi_mean < low or unhealthy_pct >= 20:
        return "?"
    if shi_mean < high or unhealthy_pct >= 8:
        return "?"
    return "?"


def _bbox_to_rowcol_range(
    feat: AdminFeature, data: SHIData
) -> Tuple[int, int, int, int]:
    """Convert an AdminFeature bbox (lon/lat) to raster row/col range."""
    from .evaluation import lonlat_to_rowcol

    min_lon, min_lat, max_lon, max_lat = feat.bbox
    r_top, c_left = lonlat_to_rowcol(min_lon, max_lat, data)
    r_bot, c_right = lonlat_to_rowcol(max_lon, min_lat, data)
    r_min = max(0, min(r_top, r_bot))
    r_max = min(data.grid.height - 1, max(r_top, r_bot))
    c_min = max(0, min(c_left, c_right))
    c_max = min(data.grid.width - 1, max(c_left, c_right))
    return r_min, r_max, c_min, c_max


def _sample_county(
    feat: AdminFeature,
    data: SHIData,
    valid_mask: np.ndarray,
    *,
    score_profile_id: str,
    coordinate_cache: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
) -> dict | None:
    """Sample SHI pixels inside a county and return statistics."""

    r_min, r_max, c_min, c_max = _bbox_to_rowcol_range(feat, data)
    if r_min > r_max or c_min > c_max:
        return None

    candidate_view = valid_mask[r_min : r_max + 1 : SAMPLE_STEP, c_min : c_max + 1 : SAMPLE_STEP]
    if not np.any(candidate_view):
        return None

    scores: list[float] = []
    classes: list[int] = []
    soil_values: list[float] = []
    water_values: list[float] = []
    salinity_values: list[float] = []
    terrain_values: list[float] = []
    point_in_poly = _point_in_multipolygon
    row_lats, row_lon_scales, col_xs = coordinate_cache or _get_coordinate_cache(data)
    for r in range(r_min, r_max + 1, SAMPLE_STEP):
        for c in range(c_min, c_max + 1, SAMPLE_STEP):
            if not valid_mask[r, c]:
                continue
            score_val = float(data.score[r, c])
            lat = float(row_lats[r])
            lon = float(col_xs[c] * row_lon_scales[r])
            if point_in_poly(lon, lat, feat):
                scores.append(score_val)
                classes.append(int(data.cls[r, c]))
                if data.soil is not None:
                    soil_val = float(data.soil[r, c])
                    if np.isfinite(soil_val):
                        soil_values.append(soil_val)
                if data.water is not None:
                    water_val = float(data.water[r, c])
                    if np.isfinite(water_val):
                        water_values.append(water_val)
                if data.salinity is not None:
                    salinity_val = float(data.salinity[r, c])
                    if np.isfinite(salinity_val):
                        salinity_values.append(salinity_val)
                if data.terrain is not None:
                    terrain_val = float(data.terrain[r, c])
                    if np.isfinite(terrain_val):
                        terrain_values.append(terrain_val)

    if not scores:
        return None

    arr = np.array(scores)
    cls_arr = np.array(classes, dtype=np.uint8)
    healthy = float(np.sum(cls_arr == 3) / len(cls_arr) * 100)
    sub_healthy = float(np.sum(cls_arr == 2) / len(cls_arr) * 100)
    unhealthy = float(np.sum(cls_arr == 1) / len(cls_arr) * 100)
    constraint_summary = _build_constraint_summary(
        soil_values=soil_values,
        water_values=water_values,
        salinity_values=salinity_values,
        terrain_values=terrain_values,
    )
    shi_mean = round(float(np.mean(arr)), 1)
    unhealthy_pct = round(unhealthy, 1)

    return {
        "name": feat.name,
        "centroid": list(feat.centroid),
        "bbox": list(feat.bbox),
        "pixel_count": len(scores),
        "shi_mean": shi_mean,
        "shi_median": round(float(np.median(arr)), 1),
        "healthy_pct": round(healthy, 1),
        "sub_healthy_pct": round(sub_healthy, 1),
        "unhealthy_pct": unhealthy_pct,
        **constraint_summary,
        "priority_level": _priority_level_for_stats(
            score_profile_id=score_profile_id,
            shi_mean=shi_mean,
            unhealthy_pct=unhealthy_pct,
        ),
    }


_cache_by_profile: dict[str, list[dict]] = {}
_coordinate_cache_by_grid: dict[
    tuple[float, float, float, float, int, int, float],
    tuple[np.ndarray, np.ndarray, np.ndarray],
] = {}


def _profile_cache_key(data: SHIData) -> str:
    return str(getattr(data, "score_profile_id", "cotton") or "cotton").strip().lower() or "cotton"


def _cache_path_for_data(data: SHIData) -> Path:
    profile_id = _profile_cache_key(data)
    return Path("data/staging") / f"shi_{data.region_id}_{profile_id}_county_stats_{data.baseline_start_year}_{data.baseline_end_year}.json"


def _get_coordinate_cache(data: SHIData) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    grid = data.grid
    cache_key = (
        float(grid.x0),
        float(grid.y0),
        float(grid.sx),
        float(grid.sy),
        int(grid.width),
        int(grid.height),
        float(grid.radius_m),
    )
    cached = _coordinate_cache_by_grid.get(cache_key)
    if cached is not None:
        return cached

    row_indices = np.arange(grid.height, dtype=np.float64)
    col_indices = np.arange(grid.width, dtype=np.float64)
    y_values = grid.y0 - (row_indices + 0.5) * grid.sy
    lat_radians = y_values / grid.radius_m
    row_lats = np.rad2deg(lat_radians)
    cos_lat = np.cos(lat_radians)
    row_lon_scales = np.zeros_like(cos_lat)
    valid_rows = np.abs(cos_lat) >= 1e-12
    row_lon_scales[valid_rows] = np.rad2deg(1.0 / (grid.radius_m * cos_lat[valid_rows]))
    col_xs = grid.x0 + (col_indices + 0.5) * grid.sx

    cached = (row_lats, row_lon_scales, col_xs)
    _coordinate_cache_by_grid[cache_key] = cached
    return cached


def compute_county_stats(data: SHIData, geo: GeoLookup) -> list[dict]:
    """Compute and cache county-level SHI statistics."""
    profile_key = _profile_cache_key(data)
    if profile_key in _cache_by_profile:
        return _cache_by_profile[profile_key]

    cache_path = _cache_path_for_data(data)
    if cache_path.exists():
        try:
            raw = json.loads(cache_path.read_text(encoding="utf-8"))
            meta = raw.get("meta", {}) if isinstance(raw, dict) else {}
            if (
                meta.get("region_id") == data.region_id
                and meta.get("score_profile_id") == profile_key
                and meta.get("baseline_years") == [data.baseline_start_year, data.baseline_end_year]
                and meta.get("time_window") == [int(m) for m in data.time_window_months]
                and meta.get("sample_step") == SAMPLE_STEP
                and meta.get("cache_version") == COUNTY_STATS_CACHE_VERSION
                and isinstance(raw.get("stats"), list)
            ):
                _cache_by_profile[profile_key] = raw["stats"]
                return _cache_by_profile[profile_key]
        except Exception:
            pass

    t0 = time.monotonic()
    valid_mask = (
        (data.crop >= 0.20)
        & np.isfinite(data.score)
        & (data.score != data.nodata)
    )
    coordinate_cache = _get_coordinate_cache(data)
    results: list[dict] = []
    all_features: List[Tuple[str, AdminFeature]] = []
    for feat in geo.prefectures:
        all_features.append(("prefecture", feat))
    for feat in geo.counties:
        all_features.append(("county", feat))

    for admin_type, feat in all_features:
        if not hasattr(feat, "bbox") or feat.bbox is None:
            continue
        stats = _sample_county(
            feat,
            data,
            valid_mask,
            score_profile_id=profile_key,
            coordinate_cache=coordinate_cache,
        )
        if stats is not None:
            stats["type"] = admin_type
            results.append(stats)

    results.sort(key=lambda x: x.get("shi_mean", 0), reverse=True)
    elapsed = time.monotonic() - t0
    logger.info("County stats computed for %d regions in %.1fs", len(results), elapsed)
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "meta": {
                "region_id": data.region_id,
                "score_profile_id": profile_key,
                "baseline_years": [data.baseline_start_year, data.baseline_end_year],
                "time_window": [int(m) for m in data.time_window_months],
                "sample_step": SAMPLE_STEP,
                "cache_version": COUNTY_STATS_CACHE_VERSION,
                "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
            "stats": results,
        }
        cache_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        logger.warning("County stats cache write failed: %s", exc)
    _cache_by_profile[profile_key] = results
    return results
