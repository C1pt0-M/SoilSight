from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict

import numpy as np


@dataclass(frozen=True)
class GridInfo:
    x0: float
    y0: float
    sx: float
    sy: float
    width: int
    height: int
    radius_m: float


@dataclass
class SHIData:
    score: np.ndarray
    cls: np.ndarray
    prod: np.ndarray
    stab: np.ndarray
    soil: np.ndarray | None
    water: np.ndarray | None
    salinity: np.ndarray | None
    terrain: np.ndarray | None
    drought_risk: np.ndarray | None
    heat_risk: np.ndarray | None
    ml_delta_pred: np.ndarray | None
    ml_shi_end_pred: np.ndarray | None
    ml_feature_year: int | None
    ml_target_year: int | None
    ml_model_type: str | None
    valid_years: np.ndarray | None
    data_quality: np.ndarray | None
    region_id: str
    baseline_start_year: int
    baseline_end_year: int
    time_window_months: tuple[int, ...]
    crop: np.ndarray
    cotton: np.ndarray | None
    nodata: float
    grid: GridInfo
    score_profile_id: str = "general"
    sugarbeet: np.ndarray | None = None
    maize: np.ndarray | None = None


@dataclass
class RuleTrace:
    rule_id: str
    title: str
    trigger: str
    evidence: str
    explanation: str
    source: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "rule_id": self.rule_id,
            "title": self.title,
            "trigger": self.trigger,
            "evidence": self.evidence,
            "explanation": self.explanation,
            "source": self.source,
        }


@dataclass
class PlanStage:
    stage_id: str
    title: str
    actions: list[str]
    expected_changes: list[str]
    rule_ids: list[str]
    milestones: list[str] = field(default_factory=list)
    entry_conditions: list[str] = field(default_factory=list)
    exit_conditions: list[str] = field(default_factory=list)
    fallback_actions: list[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage_id": self.stage_id,
            "title": self.title,
            "actions": self.actions,
            "expected_changes": self.expected_changes,
            "rule_ids": self.rule_ids,
            "milestones": self.milestones,
            "entry_conditions": self.entry_conditions,
            "exit_conditions": self.exit_conditions,
            "fallback_actions": self.fallback_actions,
        }


@dataclass
class PlanSession:
    session_id: str
    row: int
    col: int
    lon: float
    lat: float
    created_at: str
    updated_at: str
    objective: str
    constraints: Dict[str, Any]
    scenario_pack_id: str
    snapshot: Dict[str, Any]
    plan: Dict[str, Any]
    progress_mode: str = "stable"
    chat_history: list[Dict[str, str]] = field(default_factory=list)
    score_profile_id: str = "general"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
