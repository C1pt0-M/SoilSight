from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict

from .models import PlanSession


class FilePlanSessionStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def load_sessions(self) -> Dict[str, PlanSession]:
        if not self.path.exists():
            return {}
        try:
            payload = json.loads(self.path.read_text(encoding='utf-8'))
        except Exception:
            return {}
        raw_sessions = payload.get('sessions') if isinstance(payload, dict) else None
        if not isinstance(raw_sessions, dict):
            return {}

        sessions: Dict[str, PlanSession] = {}
        for session_id, raw in raw_sessions.items():
            session = self._session_from_dict(session_id, raw)
            if session is not None:
                sessions[session.session_id] = session
        return sessions

    def save_sessions(self, sessions: Dict[str, PlanSession]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            'version': 1,
            'sessions': {
                session_id: self._session_to_dict(session)
                for session_id, session in sorted(sessions.items())
            },
        }
        temp_path = self.path.with_suffix(self.path.suffix + '.tmp')
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        temp_path.replace(self.path)

    def _session_to_dict(self, session: PlanSession) -> Dict[str, Any]:
        return asdict(session)

    def _session_from_dict(self, session_id: str, raw: Any) -> PlanSession | None:
        if not isinstance(raw, dict):
            return None
        try:
            return PlanSession(
                session_id=str(raw.get('session_id') or session_id),
                row=int(raw['row']),
                col=int(raw['col']),
                lon=float(raw['lon']),
                lat=float(raw['lat']),
                created_at=str(raw['created_at']),
                updated_at=str(raw['updated_at']),
                objective=str(raw['objective']),
                constraints=dict(raw.get('constraints') or {}),
                scenario_pack_id=str(raw['scenario_pack_id']),
                progress_mode=str(raw.get('progress_mode') or 'stable'),
                snapshot=dict(raw.get('snapshot') or {}),
                plan=dict(raw.get('plan') or {}),
                chat_history=self._normalize_chat_history(raw.get('chat_history')),
                score_profile_id=str(raw.get('score_profile_id') or 'general'),
            )
        except Exception:
            return None

    def _normalize_chat_history(self, raw_history: Any) -> list[Dict[str, str]]:
        if not isinstance(raw_history, list):
            return []
        history: list[Dict[str, str]] = []
        for item in raw_history:
            if not isinstance(item, dict):
                continue
            role = str(item.get('role', '')).strip()
            content = str(item.get('content', '')).strip()
            if role not in {'user', 'assistant'} or not content:
                continue
            history.append({'role': role, 'content': content})
        return history
