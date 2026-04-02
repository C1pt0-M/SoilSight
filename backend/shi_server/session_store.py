from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote

from .models import PlanSession


class FilePlanSessionStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def load_sessions(self) -> Dict[str, PlanSession]:
        sidecar_sessions = self._load_sidecar_sessions()
        if sidecar_sessions is not None:
            return sidecar_sessions
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
        self._write_json_atomic(self.path, payload)
        self._sync_sidecar_sessions(sessions)

    def save_session(self, session: PlanSession) -> None:
        sidecar_path = self._sidecar_path(session.session_id)
        sidecar_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_json_atomic(sidecar_path, self._session_to_dict(session))
        self._write_sidecar_manifest()

    def _session_to_dict(self, session: PlanSession) -> Dict[str, Any]:
        return asdict(session)

    def _sidecar_dir(self) -> Path:
        return self.path.with_suffix(self.path.suffix + '.sessions')

    def _sidecar_path(self, session_id: str) -> Path:
        encoded_session_id = quote(str(session_id), safe='-_.()')
        return self._sidecar_dir() / f'{encoded_session_id}.json'

    def _load_sidecar_sessions(self) -> Dict[str, PlanSession] | None:
        sidecar_dir = self._sidecar_dir()
        if not sidecar_dir.exists():
            return None

        sidecar_files = sorted(sidecar_dir.glob('*.json'))
        if not sidecar_files:
            return None

        sessions: Dict[str, PlanSession] = {}
        for file_path in sidecar_files:
            try:
                raw = json.loads(file_path.read_text(encoding='utf-8'))
            except Exception:
                continue
            session = self._session_from_dict(file_path.stem, raw)
            if session is not None:
                sessions[session.session_id] = session
        return sessions

    def _write_sidecar_manifest(self) -> None:
        sidecar_dir = self._sidecar_dir()
        payload = {
            'version': 2,
            'storage': 'per_session_files',
            'sessions_dir': sidecar_dir.name,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write_json_atomic(self.path, payload)

    def _sync_sidecar_sessions(self, sessions: Dict[str, PlanSession]) -> None:
        sidecar_dir = self._sidecar_dir()
        sidecar_dir.mkdir(parents=True, exist_ok=True)
        expected_names: set[str] = set()
        for session_id, session in sorted(sessions.items()):
            sidecar_path = self._sidecar_path(session_id)
            expected_names.add(sidecar_path.name)
            self._write_json_atomic(sidecar_path, self._session_to_dict(session))
        for file_path in sidecar_dir.glob('*.json'):
            if file_path.name not in expected_names:
                file_path.unlink()

    def _write_json_atomic(self, path: Path, payload: Dict[str, Any]) -> None:
        temp_path = path.with_suffix(path.suffix + '.tmp')
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        temp_path.replace(path)

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
