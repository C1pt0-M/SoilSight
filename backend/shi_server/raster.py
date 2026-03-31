from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Sequence, Tuple

import numpy as np
import tifffile as tiff

from .config import DEFAULT_MODIS_RADIUS_M, DEFAULT_NODATA
from .models import GridInfo, SHIData


def read_array_and_tags(path: Path) -> Tuple[np.ndarray, Dict[int, object]]:
    with tiff.TiffFile(path) as tif:
        page = tif.pages[0]
        arr = page.asarray()
        tags: Dict[int, object] = {}
        for tid in (33550, 33922, 34736, 42113):
            tag = page.tags.get(tid)
            if tag is not None:
                tags[tid] = tag.value
    return arr, tags


def parse_grid(tags: Dict[int, object], shape: Tuple[int, int]) -> GridInfo:
    scale = tags.get(33550)
    tie = tags.get(33922)
    if not (isinstance(scale, tuple) and len(scale) >= 2 and isinstance(tie, tuple) and len(tie) >= 6):
        raise SystemExit("Missing/invalid GeoTIFF tags 33550/33922.")

    sx = float(scale[0])
    sy = float(scale[1])
    x0 = float(tie[3])
    y0 = float(tie[4])

    gd = tags.get(34736)
    radius = DEFAULT_MODIS_RADIUS_M
    if isinstance(gd, tuple) and len(gd) >= 5:
        try:
            r1 = float(gd[3])
            r2 = float(gd[4])
            if r1 > 1e6 and r2 > 1e6:
                radius = max(r1, r2)
        except Exception:
            pass

    h, w = shape
    return GridInfo(x0=x0, y0=y0, sx=sx, sy=sy, width=w, height=h, radius_m=radius)


def _read_optional(path: Path | None) -> np.ndarray | None:
    if path is None:
        return None
    if not path.exists():
        return None
    arr, _ = read_array_and_tags(path)
    return arr


def _read_ml_summary(path: Path | None) -> Tuple[int | None, int | None, str | None]:
    if path is None or not path.exists():
        return None, None, None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None, None, None
    try:
        feature_year = int(raw.get("predict_year")) if raw.get("predict_year") is not None else None
    except Exception:
        feature_year = None
    try:
        target_year = int(raw.get("target_year")) if raw.get("target_year") is not None else None
    except Exception:
        target_year = None
    model_type = str(raw.get("model_type")).strip() if raw.get("model_type") is not None else None
    if model_type == "":
        model_type = None
    return feature_year, target_year, model_type


def load_shi_data(
    *,
    score_tif: Path,
    class_tif: Path,
    prod_tif: Path,
    stab_tif: Path,
    crop_tif: Path,
    cotton_tif: Path | None = None,
    sugarbeet_tif: Path | None = None,
    maize_tif: Path | None = None,
    soil_tif: Path | None = None,
    water_tif: Path | None = None,
    salinity_tif: Path | None = None,
    terrain_tif: Path | None = None,
    drought_risk_tif: Path | None = None,
    heat_risk_tif: Path | None = None,
    ml_delta_pred_tif: Path | None = None,
    ml_shi_end_pred_tif: Path | None = None,
    ml_summary_json: Path | None = None,
    valid_years_tif: Path | None = None,
    data_quality_tif: Path | None = None,
    region_id: str = "unknown",
    baseline_start_year: int = 2010,
    baseline_end_year: int = 2025,
    time_window_months: Sequence[int] = (5, 6, 7, 8, 9),
    score_profile_id: str = "general",
) -> SHIData:
    score, score_tags = read_array_and_tags(score_tif)
    cls, _ = read_array_and_tags(class_tif)
    prod, _ = read_array_and_tags(prod_tif)
    stab, _ = read_array_and_tags(stab_tif)
    crop, _ = read_array_and_tags(crop_tif)
    cotton = _read_optional(cotton_tif)
    sugarbeet = _read_optional(sugarbeet_tif)
    maize = _read_optional(maize_tif)

    soil = _read_optional(soil_tif)
    water = _read_optional(water_tif)
    salinity = _read_optional(salinity_tif)
    terrain = _read_optional(terrain_tif)
    drought_risk = _read_optional(drought_risk_tif)
    heat_risk = _read_optional(heat_risk_tif)
    ml_delta_pred = _read_optional(ml_delta_pred_tif)
    ml_shi_end_pred = _read_optional(ml_shi_end_pred_tif)
    ml_feature_year, ml_target_year, ml_model_type = _read_ml_summary(ml_summary_json)
    valid_years = _read_optional(valid_years_tif)
    data_quality = _read_optional(data_quality_tif)

    shape = score.shape
    check_items = [("class", cls), ("prod", prod), ("stab", stab), ("crop", crop)]
    if cotton is not None:
        check_items.append(("cotton", cotton))
    if sugarbeet is not None:
        check_items.append(("sugarbeet", sugarbeet))
    if maize is not None:
        check_items.append(("maize", maize))
    if soil is not None:
        check_items.append(("soil", soil))
    if water is not None:
        check_items.append(("water", water))
    if salinity is not None:
        check_items.append(("salinity", salinity))
    if terrain is not None:
        check_items.append(("terrain", terrain))
    if drought_risk is not None:
        check_items.append(("drought_risk", drought_risk))
    if heat_risk is not None:
        check_items.append(("heat_risk", heat_risk))
    if ml_delta_pred is not None:
        check_items.append(("ml_delta_pred", ml_delta_pred))
    if ml_shi_end_pred is not None:
        check_items.append(("ml_shi_end_pred", ml_shi_end_pred))
    if valid_years is not None:
        check_items.append(("valid_years", valid_years))
    if data_quality is not None:
        check_items.append(("data_quality", data_quality))
    for name, arr in check_items:
        if arr.shape != shape:
            raise SystemExit(f"Shape mismatch: {name} {arr.shape} != score {shape}")

    nodata = score_tags.get(42113, DEFAULT_NODATA)
    try:
        nodata_f = float(nodata)
    except Exception:
        nodata_f = DEFAULT_NODATA

    grid = parse_grid(score_tags, shape)
    return SHIData(
        score=score.astype(np.float32),
        cls=cls.astype(np.uint8),
        prod=prod.astype(np.float32),
        stab=stab.astype(np.float32),
        soil=soil.astype(np.float32) if soil is not None else None,
        water=water.astype(np.float32) if water is not None else None,
        salinity=salinity.astype(np.float32) if salinity is not None else None,
        terrain=terrain.astype(np.float32) if terrain is not None else None,
        drought_risk=drought_risk.astype(np.float32) if drought_risk is not None else None,
        heat_risk=heat_risk.astype(np.float32) if heat_risk is not None else None,
        ml_delta_pred=ml_delta_pred.astype(np.float32) if ml_delta_pred is not None else None,
        ml_shi_end_pred=ml_shi_end_pred.astype(np.float32) if ml_shi_end_pred is not None else None,
        ml_feature_year=ml_feature_year,
        ml_target_year=ml_target_year,
        ml_model_type=ml_model_type,
        valid_years=valid_years.astype(np.float32) if valid_years is not None else None,
        data_quality=data_quality.astype(np.uint8) if data_quality is not None else None,
        region_id=str(region_id).strip() or "unknown",
        baseline_start_year=int(baseline_start_year),
        baseline_end_year=int(baseline_end_year),
        time_window_months=tuple(int(month) for month in time_window_months),
        crop=crop.astype(np.float32),
        cotton=cotton.astype(np.float32) if cotton is not None else None,
        nodata=nodata_f,
        grid=grid,
        score_profile_id=str(score_profile_id).strip() or "general",
        sugarbeet=sugarbeet.astype(np.float32) if sugarbeet is not None else None,
        maize=maize.astype(np.float32) if maize is not None else None,
    )
