from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from collections.abc import Iterable, Mapping
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

from .domain.evaluation import evaluate_click, get_score_profile_id, get_score_profile_name
from .domain.county_stats import compute_county_stats
from .domain.planning import (
    build_llm_messages_for_general_chat,
    build_llm_messages_for_chat,
    build_llm_messages_for_plan,
    build_plan_chat_history,
    sanitize_llm_reply,
    build_plan_payload,
    default_constraints,
    default_objective,
    default_plan_task,
    fallback_general_chat_reply,
    fallback_chat_reply,
    fallback_plan_text,
    get_scenario_pack,
    parse_progress_mode,
)
from .domain.simulation import run_simulation
from .geo_lookup import GeoLookup
from .knowledge_base import build_knowledge_context, decide_knowledge_usage
from .models import PlanSession, SHIData, now_iso

DEFAULT_ALLOWED_CORS_ORIGINS = frozenset({
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
})
MAX_JSON_BODY_BYTES = 1_000_000


def resolve_allowed_cors_origin(origin: str | None) -> str | None:
    normalized_origin = str(origin or "").strip().rstrip("/")
    if not normalized_origin:
        return None

    raw_allowed = str(os.getenv("SOILSIGHT_ALLOWED_ORIGINS") or "").strip()
    if raw_allowed:
        allowed_origins = {
            token.strip().rstrip("/")
            for token in raw_allowed.split(",")
            if token.strip()
        }
    else:
        allowed_origins = set(DEFAULT_ALLOWED_CORS_ORIGINS)

    return normalized_origin if normalized_origin in allowed_origins else None


def parse_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    try:
        content_length = int(handler.headers.get("Content-Length", "0"))
    except Exception:
        content_length = 0
    if content_length <= 0:
        return {}
    if content_length > MAX_JSON_BODY_BYTES:
        raise ValueError("request body too large")
    raw = handler.rfile.read(content_length)
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"invalid json body: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("json body must be an object")
    return payload


def normalize_chat_history(raw_history: Any) -> list[Dict[str, str]]:
    if not isinstance(raw_history, list):
        return []
    normalized: list[Dict[str, str]] = []
    for item in raw_history[-20:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        normalized.append({"role": role, "content": content})
    return normalized


def build_available_score_profiles(profile_ids: Iterable[str]) -> list[Dict[str, str]]:
    available: list[Dict[str, str]] = []
    seen: set[str] = set()
    for raw_profile_id in profile_ids:
        profile_id = str(raw_profile_id or "").strip().lower()
        if not profile_id or profile_id in seen:
            continue
        seen.add(profile_id)
        available.append({"id": profile_id, "name": get_score_profile_name(profile_id)})
    return available


def normalize_requested_score_profile(
    raw_profile_id: Any,
    available_profile_ids: Iterable[str],
    default_profile_id: str,
) -> str:
    allowed = [
        str(profile_id or "").strip().lower()
        for profile_id in available_profile_ids
        if str(profile_id or "").strip()
    ]
    requested = str(raw_profile_id or "").strip().lower()
    fallback = str(default_profile_id or "").strip().lower()
    if requested and requested in allowed:
        return requested
    if fallback in allowed:
        return fallback
    return allowed[0] if allowed else (fallback or "cotton")


def build_health_payload(
    data: SHIData,
    available_profile_ids: Iterable[str] | None = None,
    default_profile_id: str | None = None,
) -> Dict[str, Any]:
    profile_ids = list(available_profile_ids or [get_score_profile_id(data)])
    score_profile_id = normalize_requested_score_profile(
        default_profile_id or get_score_profile_id(data),
        profile_ids,
        get_score_profile_id(data),
    )
    return {
        "ok": True,
        "service": "soilsight_server",
        "region_id": data.region_id,
        "time_window": [int(month) for month in data.time_window_months],
        "baseline_years": [int(data.baseline_start_year), int(data.baseline_end_year)],
        "score_profile_id": score_profile_id,
        "score_profile_name": get_score_profile_name(score_profile_id),
        "available_score_profiles": build_available_score_profiles(profile_ids),
    }


def build_plan_snapshot_payload(snapshot: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "region_id": snapshot.get("region_id"),
        "score_profile_id": snapshot.get("score_profile_id"),
        "score_profile_name": snapshot.get("score_profile_name"),
        "lon": snapshot["lon"],
        "lat": snapshot["lat"],
        "shi_score": snapshot["shi_score"],
        "shi_level": snapshot["shi_level"],
        "components": snapshot["components"],
        "profile": snapshot.get("profile"),
        "crop_support": snapshot.get("crop_support"),
        "risk": snapshot.get("risk"),
        "time_window": snapshot.get("time_window"),
        "baseline_years": snapshot.get("baseline_years"),
        "data_coverage_years": snapshot.get("data_coverage_years"),
    }


def make_handler(
    data: SHIData | Mapping[str, SHIData],
    geo: GeoLookup | None = None,
    spatial_model=None,
    llm_client=None,
    session_store=None,
    knowledge_base=None,
    default_profile_id: str | None = None,
):
    if isinstance(data, Mapping):
        data_by_profile = {
            str(profile_id or "").strip().lower(): profile_data
            for profile_id, profile_data in data.items()
            if str(profile_id or "").strip() and profile_data is not None
        }
    else:
        single_profile_id = get_score_profile_id(data)
        data_by_profile = {single_profile_id: data}

    if not data_by_profile:
        raise ValueError("at least one score profile dataset is required")

    available_profile_ids = list(data_by_profile.keys())
    default_profile_id = normalize_requested_score_profile(
        default_profile_id,
        available_profile_ids,
        available_profile_ids[0],
    )
    default_data = data_by_profile[default_profile_id]

    if isinstance(spatial_model, Mapping):
        spatial_models_by_profile = {
            str(profile_id or "").strip().lower(): model
            for profile_id, model in spatial_model.items()
            if str(profile_id or "").strip()
        }
    else:
        spatial_models_by_profile = {default_profile_id: spatial_model} if spatial_model is not None else {}

    def get_data_for_profile(raw_profile_id: Any) -> tuple[str, SHIData]:
        profile_id = normalize_requested_score_profile(raw_profile_id, available_profile_ids, default_profile_id)
        return profile_id, data_by_profile[profile_id]

    def get_spatial_model_for_profile(profile_id: str):
        return spatial_models_by_profile.get(profile_id) or spatial_models_by_profile.get(default_profile_id)

    sessions: Dict[str, PlanSession] = session_store.load_sessions() if session_store is not None else {}
    sessions_lock = threading.Lock()
    province_geojson = None
    province_path = Path("data/行政区划/xj_province.geojson")
    if province_path.exists():
        try:
            province_geojson = json.loads(province_path.read_text(encoding="utf-8"))
        except Exception:
            province_geojson = None

    def persist_sessions_locked(session: PlanSession | None = None) -> None:
        if session_store is None:
            return
        try:
            if session is not None and hasattr(session_store, "save_session"):
                session_store.save_session(session)
            else:
                session_store.save_sessions(sessions)
        except Exception as exc:
            print(f"[WARN] session persistence failed: {exc}")

    class Handler(BaseHTTPRequestHandler):
        def _send_cors_headers(self) -> None:
            allowed_origin = resolve_allowed_cors_origin(self.headers.get("Origin"))
            if allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _send_json(self, code: int, payload: dict) -> None:
            try:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
          try:
            parsed_url = urlparse(self.path)
            if parsed_url.path == "/health":
                self._send_json(200, build_health_payload(default_data, available_profile_ids=available_profile_ids, default_profile_id=default_profile_id))
                return

            if parsed_url.path == "/api/shi/click":
                query = parse_qs(parsed_url.query)
                requested_profile_id = query.get("profile", [None])[0]
                try:
                    lon = float(query.get("lon", [None])[0])
                    lat = float(query.get("lat", [None])[0])
                except Exception:
                    self._send_json(400, {"ok": False, "error": "invalid lon/lat"})
                    return

                _, selected_data = get_data_for_profile(requested_profile_id)
                result = evaluate_click(selected_data, lon, lat, geo=geo)
                result.pop("row", None)
                result.pop("col", None)
                self._send_json(200, result)
                return

            if parsed_url.path == "/api/geo/search":
                query = parse_qs(parsed_url.query)
                q = query.get("q", [""])[0].strip()
                if not q:
                    self._send_json(400, {"ok": False, "error": "missing q parameter"})
                    return
                if geo is not None:
                    results = geo.search(q)
                else:
                    results = []
                self._send_json(200, {"ok": True, "results": results})
                return

            if parsed_url.path == "/api/geo/xinjiang_boundary":
                if province_geojson is None:
                    self._send_json(404, {"ok": False, "error": "boundary not available"})
                else:
                    self._send_json(200, {"ok": True, "geojson": province_geojson})
                return

            if parsed_url.path == "/api/geo/county_stats":
                if geo is not None:
                    query = parse_qs(parsed_url.query)
                    _, selected_data = get_data_for_profile(query.get("profile", [None])[0])
                    stats = compute_county_stats(selected_data, geo)
                else:
                    stats = []
                self._send_json(200, {"ok": True, "stats": stats})
                return

            if parsed_url.path == "/api/model/info":
                try:
                    query = parse_qs(parsed_url.query)
                    selected_profile_id, _ = get_data_for_profile(query.get("profile", [None])[0])
                    selected_spatial_model = get_spatial_model_for_profile(selected_profile_id)
                    if selected_spatial_model is not None and getattr(selected_spatial_model, "is_trained", False):
                        self._send_json(200, {
                            "ok": True,
                            "trained": True,
                            "score_profile_id": selected_profile_id,
                            "r2": selected_spatial_model.train_r2,
                            "rmse": selected_spatial_model.train_rmse,
                            "n_samples": selected_spatial_model.n_samples,
                            "feature_importance": selected_spatial_model.get_feature_importance(),
                        })
                    else:
                        self._send_json(200, {
                            "ok": True,
                            "trained": False,
                            "score_profile_id": selected_profile_id,
                            "r2": None,
                            "rmse": None,
                            "n_samples": 0,
                            "feature_importance": [],
                        })
                except Exception as model_exc:
                    print(f"[ERROR] /api/model/info: {model_exc}")
                    self._send_json(500, {"ok": False, "error": f"model info error: {model_exc}"})
                return

            self._send_json(404, {"ok": False, "error": "not found"})
          except Exception as e:
            print(f"[ERROR] do_GET {self.path}: {e}")
            try:
                self._send_json(500, {"ok": False, "error": str(e)})
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_POST(self) -> None:  # noqa: N802
          try:
            parsed_url = urlparse(self.path)
            try:
                payload = parse_json_body(self)
            except ValueError as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
                return

            if parsed_url.path == "/api/plan/generate":
                self._handle_plan_generate(payload)
                return
            if parsed_url.path == "/api/plan/chat":
                self._handle_plan_chat(payload)
                return
            if parsed_url.path == "/api/ai/chat":
                self._handle_general_chat(payload)
                return
            if parsed_url.path == "/api/plan/simulate":
                self._handle_plan_simulate(payload)
                return
            self._send_json(404, {"ok": False, "error": "not found"})
          except Exception as e:
            print(f"[ERROR] do_POST {self.path}: {e}")
            try:
                self._send_json(500, {"ok": False, "error": str(e)})
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _handle_plan_generate(self, payload: Dict[str, Any]) -> None:
            try:
                lon = float(payload.get("lon"))
                lat = float(payload.get("lat"))
            except Exception:
                self._send_json(400, {"ok": False, "error": "lon/lat are required"})
                return

            requested_profile_id, selected_data = get_data_for_profile(payload.get("profile"))
            snapshot = evaluate_click(selected_data, lon, lat, geo=geo)
            if snapshot.get("status") != "evaluated":
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "error": "point is not evaluable under current scope",
                        "status": snapshot.get("status"),
                        "detail": snapshot,
                    },
                )
                return

            objective = default_objective(payload.get("objective"))
            constraints = default_constraints(payload)
            scenario_pack = get_scenario_pack(payload.get("scenario_pack"))
            progress_mode = parse_progress_mode(payload)
            task_type = default_plan_task(payload.get("task_type"))

            plan_payload = build_plan_payload(
                snapshot,
                scenario_pack,
                objective,
                constraints,
                task_type=task_type,
                progress_mode=progress_mode,
            )
            knowledge_hits: list[dict[str, object]] = []
            knowledge_context = ""
            if knowledge_base is not None:
                plan_query = " ".join(
                    part
                    for part in [
                        str(plan_payload.get("summary", "")).strip(),
                        str(scenario_pack.get("name", "")).strip(),
                        str(scenario_pack.get("description", "")).strip(),
                        str(objective).strip(),
                    ]
                    if part
                )
                knowledge_hits = [
                    hit.to_dict()
                    for hit in knowledge_base.retrieve(
                        plan_query,
                        source="plan_generate",
                        fallback_query=plan_query,
                    )
                ]
                knowledge_context = build_knowledge_context(knowledge_hits)

            assistant_reply = fallback_plan_text(plan_payload)
            used_llm = False
            if llm_client is not None:
                try:
                    assistant_reply = sanitize_llm_reply(
                        llm_client.generate(
                            build_llm_messages_for_plan(
                                plan_payload,
                                snapshot,
                                knowledge_context=knowledge_context,
                            )
                        )
                    )
                    used_llm = True
                except Exception as exc:
                    print(f"[WARN] plan llm fallback: {exc}")

            session_id = f"{selected_data.region_id}-{requested_profile_id}-r{snapshot['row']}-c{snapshot['col']}"
            timestamp = now_iso()
            with sessions_lock:
                old_history: list[Dict[str, str]] = []
                if session_id in sessions:
                    old_history = sessions[session_id].chat_history
                session = PlanSession(
                    session_id=session_id,
                    row=int(snapshot["row"]),
                    col=int(snapshot["col"]),
                    lon=lon,
                    lat=lat,
                    created_at=timestamp if session_id not in sessions else sessions[session_id].created_at,
                    updated_at=timestamp,
                    objective=objective,
                    constraints=constraints,
                    score_profile_id=requested_profile_id,
                    scenario_pack_id=scenario_pack["id"],
                    progress_mode=progress_mode,
                    snapshot=snapshot,
                    plan=plan_payload,
                    chat_history=build_plan_chat_history(old_history, assistant_reply),
                )
                sessions[session_id] = session
                persist_sessions_locked(session)

            self._send_json(
                200,
                {
                    "ok": True,
                    "session_id": session_id,
                    "snapshot": build_plan_snapshot_payload(snapshot),
                    "plan": plan_payload,
                    "assistant_reply": assistant_reply,
                    "used_llm": used_llm,
                    "generated_at": timestamp,
                    "knowledge_hits": knowledge_hits,
                },
            )

        def _handle_plan_chat(self, payload: Dict[str, Any]) -> None:
            session_id = str(payload.get("session_id", "")).strip()
            message = str(payload.get("message", "")).strip()
            if not session_id:
                self._send_json(400, {"ok": False, "error": "session_id is required"})
                return
            if not message:
                self._send_json(400, {"ok": False, "error": "message is required"})
                return

            with sessions_lock:
                session = sessions.get(session_id)
            if session is None:
                self._send_json(404, {"ok": False, "error": "session not found"})
                return

            knowledge_hits: list[dict[str, object]] = []
            knowledge_context = ""
            if knowledge_base is not None:
                scenario_pack = session.plan.get("scenario_pack", {}) if isinstance(session.plan.get("scenario_pack"), dict) else {}
                trace_explanations = " ".join(
                    str(trace.get("explanation", "")).strip()
                    for trace in session.plan.get("rule_traces", [])[:4]
                    if isinstance(trace, dict) and str(trace.get("explanation", "")).strip()
                )
                plan_chat_query = " ".join(
                    part
                    for part in [
                        message,
                        str(session.plan.get("summary", "")).strip(),
                        str(session.objective).strip(),
                        str(scenario_pack.get("name", "")).strip(),
                        str(scenario_pack.get("description", "")).strip(),
                        trace_explanations,
                    ]
                    if part
                )
                decision = decide_knowledge_usage(
                    message,
                    source="plan_chat",
                    fallback_query=plan_chat_query,
                )
                if decision.enabled:
                    min_score = decision.min_score
                    relative_score_cutoff = 0.72 if decision.mode == "primary" else 0.8
                    if decision.mode == "primary" and len(message) <= 16:
                        min_score = min(min_score, 0.3)
                        relative_score_cutoff = 0.68
                    knowledge_hits = [
                        hit.to_dict()
                        for hit in knowledge_base.search(
                            decision.query or plan_chat_query,
                            top_k=decision.max_hits,
                            min_score=min_score,
                            relative_score_cutoff=relative_score_cutoff,
                        )
                    ]
                knowledge_context = build_knowledge_context(knowledge_hits)

            reply = fallback_chat_reply(session, message)
            used_llm = False
            if llm_client is not None:
                try:
                    reply = sanitize_llm_reply(
                        llm_client.generate(
                            build_llm_messages_for_chat(session, message, knowledge_context=knowledge_context)
                        )
                    )
                    used_llm = True
                except Exception as exc:
                    print(f"[WARN] chat llm fallback: {exc}")

            user_msg = {"role": "user", "content": message}
            assistant_msg = {"role": "assistant", "content": reply}
            session.chat_history.append(user_msg)
            session.chat_history.append(assistant_msg)
            session.chat_history = session.chat_history[-20:]
            session.updated_at = now_iso()

            with sessions_lock:
                sessions[session_id] = session
                persist_sessions_locked(session)

            self._send_json(
                200,
                {
                    "ok": True,
                    "session_id": session_id,
                    "reply": reply,
                    "used_llm": used_llm,
                    "updated_plan_summary": session.plan.get("summary", ""),
                    "rule_traces": session.plan.get("rule_traces", []),
                    "chat_history": session.chat_history,
                    "knowledge_hits": knowledge_hits,
                },
            )

        def _handle_general_chat(self, payload: Dict[str, Any]) -> None:
            message = str(payload.get("message", "")).strip()
            if not message:
                self._send_json(400, {"ok": False, "error": "message is required"})
                return

            history = normalize_chat_history(payload.get("chat_history"))
            knowledge_hits: list[dict[str, object]] = []
            knowledge_context = ""
            if knowledge_base is not None:
                knowledge_hits = [
                    hit.to_dict()
                    for hit in knowledge_base.retrieve(message, source="general_chat")
                ]
                knowledge_context = build_knowledge_context(knowledge_hits)

            reply = fallback_general_chat_reply(history, message)
            used_llm = False
            if llm_client is not None:
                try:
                    reply = sanitize_llm_reply(
                        llm_client.generate(
                            build_llm_messages_for_general_chat(history, message, knowledge_context=knowledge_context)
                        )
                    )
                    used_llm = True
                except Exception as exc:
                    print(f"[WARN] general chat llm fallback: {exc}")

            updated_history = history + [
                {"role": "user", "content": message},
                {"role": "assistant", "content": reply},
            ]
            updated_history = updated_history[-20:]
            self._send_json(
                200,
                {
                    "ok": True,
                    "reply": reply,
                    "used_llm": used_llm,
                    "chat_history": updated_history,
                    "knowledge_hits": knowledge_hits,
                },
            )

        def _handle_plan_simulate(self, payload: Dict[str, Any]) -> None:
            session_id = str(payload.get("session_id", "")).strip()
            if not session_id:
                self._send_json(400, {"ok": False, "error": "session_id is required"})
                return

            with sessions_lock:
                session = sessions.get(session_id)
            if session is None:
                self._send_json(404, {"ok": False, "error": "session not found"})
                return

            progress_mode = str(payload.get("progress_mode") or getattr(session, "progress_mode", "stable"))
            progress_mode = progress_mode if progress_mode in {"aggressive", "stable", "conservative"} else "stable"
            scenario_pack = get_scenario_pack(payload.get("scenario_pack") or session.scenario_pack_id)
            requested_profile_id, selected_data = get_data_for_profile(getattr(session, "score_profile_id", None))
            selected_spatial_model = get_spatial_model_for_profile(requested_profile_id)
            simulation = run_simulation(
                session,
                scenario_pack,
                progress_mode=progress_mode,
                data=selected_data,
                spatial_model=selected_spatial_model,
            )
            session.updated_at = now_iso()
            session.score_profile_id = requested_profile_id
            session.scenario_pack_id = scenario_pack["id"]
            session.progress_mode = progress_mode
            with sessions_lock:
                sessions[session_id] = session
                persist_sessions_locked(session)

            self._send_json(
                200,
                {
                    "ok": True,
                    "session_id": session_id,
                    "scenario_pack": {
                        "id": scenario_pack["id"],
                        "name": scenario_pack["name"],
                    },
                    "simulation": simulation,
                    "rule_traces": session.plan.get("rule_traces", []),
                },
            )

        def log_message(self, fmt: str, *args) -> None:
            # Suppress routine request logs but allow explicit print() errors
            return

    return Handler
