#!/usr/bin/env python3
"""
SoilSight backend API server (thin bootstrap).

Endpoints:
- GET /health
- GET /api/shi/click?lon=<float>&lat=<float>
- POST /api/ai/chat
- POST /api/plan/generate
- POST /api/plan/chat
- POST /api/plan/simulate
"""

from __future__ import annotations

import argparse
import logging
import os
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Iterable

from shi_server.domain.spatial_model import SpatialModel, train_spatial_model
from shi_server.geo_lookup import load_geo_lookup
from shi_server.http_handler import make_handler
from shi_server.knowledge_base import LocalKnowledgeBase
from shi_server.llm_client import build_embedding_client_from_env, build_llm_client_from_env
from shi_server.raster import load_shi_data
from shi_server.runtime_flags import competition_mode_enabled
from shi_server.session_store import FilePlanSessionStore


def first_existing(candidates: Iterable[Path], fallback: Path) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return fallback


def resolve_knowledge_base_categories(raw_value: str | None) -> tuple[str, ...]:
    values = tuple(part.strip() for part in (raw_value or 'core,reference').split(',') if part.strip())
    return values or ('core', 'reference')


PROFILE_FEATURE_PATTERNS = {
    "score": "shi_score_{year_tag}.tif",
    "class": "shi_class_{year_tag}.tif",
    "prod": "shi_prod_norm_{year_tag}.tif",
    "stab": "shi_stab_norm_{year_tag}.tif",
    "soil": "shi_soil_norm_{year_tag}.tif",
    "water": "shi_water_norm_{year_tag}.tif",
    "salinity": "shi_salinity_norm_{year_tag}.tif",
    "terrain": "shi_terrain_norm_{year_tag}.tif",
    "data_quality": "shi_data_quality_{year_tag}.tif",
}

SUPPORTED_SCORE_PROFILES = ("general", "cotton", "sugarbeet", "maize")
PROFILE_SMOKE_POINTS = {
    "general": (86.618760, 48.464583),
    "cotton": (83.407969, 46.531250),
    "sugarbeet": (83.120759, 46.872917),
    "maize": (80.700105, 42.800183),
}


def profile_feature_name(profile_id: str, feature_kind: str, year_tag: str) -> str:
    kind = str(feature_kind or "").strip().lower()
    if kind not in PROFILE_FEATURE_PATTERNS:
        raise ValueError(f"Unsupported profile feature kind: {feature_kind}")
    filename = PROFILE_FEATURE_PATTERNS[kind].format(year_tag=year_tag)
    profile = str(profile_id or "").strip().lower()
    if profile == "cotton":
        return filename.replace("shi_", "cotton_shi_", 1)
    if profile == "sugarbeet":
        return filename.replace("shi_", "sugarbeet_shi_", 1)
    if profile == "maize":
        return filename.replace("shi_", "maize_shi_", 1)
    return filename


def iter_requested_score_profiles(preferred_profile: str | None) -> tuple[str, ...]:
    preferred = str(preferred_profile or "").strip().lower()
    ordered: list[str] = []
    if preferred in SUPPORTED_SCORE_PROFILES:
        ordered.append(preferred)
    for profile_id in SUPPORTED_SCORE_PROFILES:
        if profile_id not in ordered:
            ordered.append(profile_id)
    return tuple(ordered)


def maybe_profile_override(raw_path: str | None, profile_id: str, preferred_profile: str) -> Path | None:
    if raw_path and profile_id == preferred_profile:
        return Path(raw_path)
    return None


def resolve_profile_feature_path(
    *,
    profile_id: str,
    feature_kind: str,
    args_value: str | None,
    preferred_profile: str,
    feature_dir: Path,
    legacy_feature_dir: Path,
    year_tag: str,
    legacy_name: str | None = None,
) -> Path:
    override = maybe_profile_override(args_value, profile_id, preferred_profile)
    if override is not None:
        return override
    default_path = feature_dir / profile_feature_name(profile_id, feature_kind, year_tag)
    candidates = [default_path]
    if legacy_name:
        candidates.append(legacy_feature_dir / legacy_name)
    return first_existing(candidates, default_path)


def load_available_profile_data(
    args: argparse.Namespace,
    *,
    feature_dir: Path,
    legacy_feature_dir: Path,
    year_tag: str,
    shared_paths: dict[str, Path],
):
    preferred_profile = str(args.score_profile or SUPPORTED_SCORE_PROFILES[0]).strip().lower() or SUPPORTED_SCORE_PROFILES[0]
    data_by_profile = {}
    for profile_id in iter_requested_score_profiles(preferred_profile):
        score_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="score",
            args_value=args.score_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_score_2015_2025.tif",
        )
        class_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="class",
            args_value=args.class_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_class_2015_2025.tif",
        )
        prod_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="prod",
            args_value=args.prod_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_prod_norm_2015_2025.tif",
        )
        stab_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="stab",
            args_value=args.stab_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_stab_norm_2015_2025.tif",
        )
        soil_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="soil",
            args_value=args.soil_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_soil_norm_2015_2025.tif",
        )
        water_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="water",
            args_value=args.water_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_water_norm_2015_2025.tif",
        )
        salinity_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="salinity",
            args_value=args.salinity_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_salinity_norm_2015_2025.tif",
        )
        terrain_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="terrain",
            args_value=args.terrain_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
            legacy_name="shi_terrain_norm_2015_2025.tif",
        )
        data_quality_tif = resolve_profile_feature_path(
            profile_id=profile_id,
            feature_kind="data_quality",
            args_value=args.data_quality_tif,
            preferred_profile=preferred_profile,
            feature_dir=feature_dir,
            legacy_feature_dir=legacy_feature_dir,
            year_tag=year_tag,
        )

        required_paths = {
            "score_tif": score_tif,
            "class_tif": class_tif,
            "prod_tif": prod_tif,
            "stab_tif": stab_tif,
        }
        missing = [name for name, candidate in required_paths.items() if not candidate.exists()]
        if missing:
            logging.warning("Skipping score profile %s: missing %s", profile_id, ", ".join(missing))
            continue

        data_by_profile[profile_id] = load_shi_data(
            score_tif=score_tif,
            class_tif=class_tif,
            prod_tif=prod_tif,
            stab_tif=stab_tif,
            crop_tif=shared_paths["crop_tif"],
            cotton_tif=shared_paths["cotton_tif"],
            sugarbeet_tif=shared_paths["sugarbeet_tif"],
            maize_tif=shared_paths["maize_tif"],
            soil_tif=soil_tif,
            water_tif=water_tif,
            salinity_tif=salinity_tif,
            terrain_tif=terrain_tif,
            drought_risk_tif=shared_paths["drought_risk_tif"],
            heat_risk_tif=shared_paths["heat_risk_tif"],
            ml_delta_pred_tif=shared_paths["ml_delta_pred_tif"],
            ml_shi_end_pred_tif=shared_paths["ml_shi_end_pred_tif"],
            ml_summary_json=shared_paths["ml_summary_json"],
            valid_years_tif=shared_paths["valid_years_tif"],
            data_quality_tif=data_quality_tif,
            region_id=args.region_id,
            baseline_start_year=int(args.baseline_start_year),
            baseline_end_year=int(args.baseline_end_year),
            time_window_months=parse_time_window(args.time_window),
            score_profile_id=profile_id,
        )

    return data_by_profile


def parse_time_window(raw: str) -> tuple[int, ...]:
    values = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        values.append(int(token))
    if not values:
        return (5, 6, 7, 8, 9)
    return tuple(values)


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value


def start_spatial_model_training(data, feature_dir: Path) -> SpatialModel:
    """Train the spatial model in a background thread so HTTP can start first."""
    model = SpatialModel()

    def _worker() -> None:
        try:
            model.train(data, feature_dir)
        except Exception:
            logging.exception("Spatial model training failed")

    thread = threading.Thread(target=_worker, name="spatial-model-train", daemon=True)
    thread.start()
    return model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run SoilSight backend API server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--region_id", default="xinjiang", help="Region id in path names, e.g. xinjiang/jiashi.")
    parser.add_argument("--baseline_start_year", type=int, default=2010)
    parser.add_argument("--baseline_end_year", type=int, default=2025)
    parser.add_argument("--time_window", default="5,6,7,8,9", help="Comma-separated months used in SHI baseline.")
    parser.add_argument("--score_tif", default=None)
    parser.add_argument("--class_tif", default=None)
    parser.add_argument("--prod_tif", default=None)
    parser.add_argument("--stab_tif", default=None)
    parser.add_argument("--soil_tif", default=None)
    parser.add_argument("--water_tif", default=None)
    parser.add_argument("--salinity_tif", default=None)
    parser.add_argument("--terrain_tif", default=None)
    parser.add_argument("--drought_risk_tif", default=None)
    parser.add_argument("--heat_risk_tif", default=None)
    parser.add_argument("--valid_years_tif", default=None)
    parser.add_argument("--data_quality_tif", default=None)
    parser.add_argument("--ml_delta_pred_tif", default=None)
    parser.add_argument("--ml_shi_end_pred_tif", default=None)
    parser.add_argument("--ml_summary_json", default=None)
    parser.add_argument("--crop_tif", default=None)
    parser.add_argument("--cotton_tif", default=None)
    parser.add_argument("--sugarbeet_tif", default=None)
    parser.add_argument("--maize_tif", default=None)
    parser.add_argument("--score_profile", default="cotton", choices=["cotton", "sugarbeet", "maize"], help="Default score profile when requests omit profile.")
    return parser.parse_args()


def main() -> int:
    logging.getLogger("tifffile").setLevel(logging.ERROR)
    load_env_file(Path(__file__).resolve().parent / ".env")
    args = parse_args()
    project_root = Path(__file__).resolve().parent.parent
    year_tag = f"{args.baseline_start_year}_{args.baseline_end_year}"
    feature_dir = Path(f"data/features/shi_{args.region_id}")
    legacy_feature_dir = Path("data/features/shi_jiashi")
    preferred_profile_id = str(args.score_profile or SUPPORTED_SCORE_PROFILES[0]).strip().lower() or SUPPORTED_SCORE_PROFILES[0]

    drought_risk_tif = Path(args.drought_risk_tif) if args.drought_risk_tif else first_existing(
        [feature_dir / f"era5_drought_risk_gs_{year_tag}_on_modis.tif", legacy_feature_dir / "era5_drought_risk_gs_2015_2025_on_modis.tif"],
        feature_dir / f"era5_drought_risk_gs_{year_tag}_on_modis.tif",
    )
    heat_risk_tif = Path(args.heat_risk_tif) if args.heat_risk_tif else first_existing(
        [feature_dir / f"era5_heat_risk_gs_{year_tag}_on_modis.tif", legacy_feature_dir / "era5_heat_risk_gs_2015_2025_on_modis.tif"],
        feature_dir / f"era5_heat_risk_gs_{year_tag}_on_modis.tif",
    )
    valid_years_tif = Path(args.valid_years_tif) if args.valid_years_tif else first_existing(
        [feature_dir / f"mod13a1_061_ndvi_gs_valid_years_{year_tag}.tif", legacy_feature_dir / "mod13a1_061_ndvi_gs_valid_years_2015_2025.tif"],
        feature_dir / f"mod13a1_061_ndvi_gs_valid_years_{year_tag}.tif",
    )
    crop_tif = Path(args.crop_tif) if args.crop_tif else first_existing(
        [feature_dir / "cropland_fraction_on_modis_500m_2023.tif", legacy_feature_dir / "cropland_fraction_on_modis_500m_2023.tif"],
        feature_dir / "cropland_fraction_on_modis_500m_2023.tif",
    )
    cotton_tif = Path(args.cotton_tif) if args.cotton_tif else first_existing(
        [feature_dir / "cotton_fraction_on_modis_500m_2021_boa.tif"],
        feature_dir / "cotton_fraction_on_modis_500m_2021_boa.tif",
    )
    sugarbeet_tif = Path(args.sugarbeet_tif) if args.sugarbeet_tif else first_existing(
        [feature_dir / "sugarbeet_fraction_on_modis_500m_2010_2020_scidb_a_mean.tif"],
        feature_dir / "sugarbeet_fraction_on_modis_500m_2010_2020_scidb_a_mean.tif",
    )
    maize_tif = Path(args.maize_tif) if args.maize_tif else first_existing(
        [feature_dir / "maize_fraction_on_modis_500m_2010_2020_scidb_a_mean.tif"],
        feature_dir / "maize_fraction_on_modis_500m_2010_2020_scidb_a_mean.tif",
    )
    default_target_year = int(args.baseline_end_year) + 1
    ml_dir = feature_dir / "ml"
    legacy_ml_dir = legacy_feature_dir / "ml"
    ml_delta_pred_tif = Path(args.ml_delta_pred_tif) if args.ml_delta_pred_tif else first_existing(
        [ml_dir / f"shi_delta12_pred_{args.baseline_end_year}_{default_target_year}.tif", legacy_ml_dir / "shi_delta12_pred_2025_2026.tif"],
        ml_dir / f"shi_delta12_pred_{args.baseline_end_year}_{default_target_year}.tif",
    )
    ml_shi_end_pred_tif = Path(args.ml_shi_end_pred_tif) if args.ml_shi_end_pred_tif else first_existing(
        [ml_dir / f"shi_pred_end_{default_target_year}.tif", legacy_ml_dir / "shi_pred_end_2026.tif"],
        ml_dir / f"shi_pred_end_{default_target_year}.tif",
    )
    ml_summary_json = Path(args.ml_summary_json) if args.ml_summary_json else first_existing(
        [ml_dir / f"shi_delta12_pred_{args.baseline_end_year}_{default_target_year}.summary.json", legacy_ml_dir / "shi_delta12_pred_2025_2026.summary.json"],
        ml_dir / f"shi_delta12_pred_{args.baseline_end_year}_{default_target_year}.summary.json",
    )

    shared_paths = {
        "crop_tif": crop_tif,
        "cotton_tif": cotton_tif,
        "sugarbeet_tif": sugarbeet_tif,
        "maize_tif": maize_tif,
        "drought_risk_tif": drought_risk_tif,
        "heat_risk_tif": heat_risk_tif,
        "valid_years_tif": valid_years_tif,
        "ml_delta_pred_tif": ml_delta_pred_tif,
        "ml_shi_end_pred_tif": ml_shi_end_pred_tif,
        "ml_summary_json": ml_summary_json,
    }
    data_by_profile = load_available_profile_data(
        args,
        feature_dir=feature_dir,
        legacy_feature_dir=legacy_feature_dir,
        year_tag=year_tag,
        shared_paths=shared_paths,
    )
    if not data_by_profile:
        raise SystemExit("No score profile datasets could be loaded.")

    default_profile_id = preferred_profile_id if preferred_profile_id in data_by_profile else next(iter(data_by_profile))
    data = data_by_profile[default_profile_id]

    admin_dir = Path("data/行政区划")
    geo = load_geo_lookup(admin_dir)

    spatial_models = {
        profile_id: start_spatial_model_training(profile_data, feature_dir)
        for profile_id, profile_data in data_by_profile.items()
    }
    competition_mode = competition_mode_enabled()
    llm_client = None if competition_mode else build_llm_client_from_env()
    embedding_client = None if competition_mode else build_embedding_client_from_env()
    knowledge_base = None
    kb_root_raw = (os.getenv("KNOWLEDGE_BASE_ROOT") or "").strip()
    kb_root = Path(kb_root_raw) if kb_root_raw else project_root / "knowledge_base"
    kb_categories = resolve_knowledge_base_categories(os.getenv("KNOWLEDGE_BASE_CATEGORIES"))
    try:
        if kb_root.exists():
            candidate_kb = LocalKnowledgeBase.from_root(
                kb_root,
                include_categories=kb_categories,
                embedder=embedding_client,
            )
            if candidate_kb.documents:
                knowledge_base = candidate_kb
    except Exception:
        logging.exception("Knowledge base loading failed")

    session_store_path = Path(
        (os.getenv('PLAN_SESSION_STORE_PATH') or '').strip()
        or f'data/staging/ai_plan_sessions_{args.region_id}.json'
    )
    session_store = FilePlanSessionStore(session_store_path)

    server = ThreadingHTTPServer(
        (args.host, args.port),
        make_handler(
            data_by_profile,
            geo=geo,
            spatial_model=spatial_models,
            llm_client=llm_client,
            session_store=session_store,
            knowledge_base=knowledge_base,
            default_profile_id=default_profile_id,
        ),
    )
    print(f"SoilSight server running at http://{args.host}:{args.port}")
    print("Spatial model training started in background; simulation reference will appear after training completes")
    print(f"Available score profiles: {', ' .join(data_by_profile.keys())}; default={default_profile_id}")
    if competition_mode:
        print("Competition mode enabled: external LLM and embedding calls are disabled by default. Set SOILSIGHT_COMPETITION_MODE=0 to enable them.")
    elif llm_client is not None:
        print(f"LLM enabled: {llm_client.model}")
    else:
        print("LLM disabled: set SOILSIGHT_COMPETITION_MODE=0 and LLM_API_KEY / OPENAI_API_KEY to enable real model responses")
    if knowledge_base is not None:
        print(f"Knowledge base enabled: {len(knowledge_base.documents)} docs ({', '.join(kb_categories)})")
        if knowledge_base.embedding_enabled:
            print("Knowledge retrieval mode: hybrid keyword + embedding")
        else:
            print("Knowledge retrieval mode: keyword only (set SOILSIGHT_COMPETITION_MODE=0 and EMBEDDING_MODEL to enable embeddings)")
    else:
        print("Knowledge base disabled: place docs under knowledge_base/core or set KNOWLEDGE_BASE_ROOT")
    print("Try:")
    print(f"  curl 'http://{args.host}:{args.port}/health'")
    for profile_id in data_by_profile:
        lon, lat = PROFILE_SMOKE_POINTS.get(profile_id, PROFILE_SMOKE_POINTS[SUPPORTED_SCORE_PROFILES[0]])
        print(
            f"  curl 'http://{args.host}:{args.port}/api/shi/click?lon={lon:.6f}&lat={lat:.6f}&profile={profile_id}'"
        )
    print(f"  python scripts/check_plan_api_contract.py --base-url http://{args.host}:{args.port} --profile {default_profile_id}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
