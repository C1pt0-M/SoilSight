from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Dict, List


def _normalize_chat_completions_url(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if not base:
        base = "https://api.openai.com/v1"
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _normalize_embeddings_url(base_url: str) -> str:
    base = base_url.strip().rstrip("/")
    if not base:
        base = "https://api.openai.com/v1"
    if base.endswith("/embeddings"):
        return base
    if base.endswith("/v1"):
        return f"{base}/embeddings"
    return f"{base}/v1/embeddings"


def _extract_text(payload: Dict[str, object]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("LLM response missing choices")
    first = choices[0]
    if not isinstance(first, dict):
        raise ValueError("LLM response has invalid choice payload")
    message = first.get("message")
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
        if parts:
            return "\n".join(parts)
    raise ValueError("LLM response missing text content")


def _extract_embeddings(payload: Dict[str, object]) -> list[list[float]]:
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise ValueError("Embedding response missing data")
    ordered: list[tuple[int, list[float]]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        embedding = item.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            continue
        item_index = item.get("index")
        if not isinstance(item_index, int):
            item_index = index
        ordered.append((item_index, [float(value) for value in embedding]))
    if not ordered:
        raise ValueError("Embedding response missing vectors")
    ordered.sort(key=lambda pair: pair[0])
    return [vector for _, vector in ordered]


@dataclass
class OpenAICompatibleLLM:
    api_key: str
    model: str
    chat_completions_url: str
    timeout_seconds: float = 45.0
    temperature: float = 0.4

    def generate(self, messages: List[Dict[str, str]]) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
        }
        req = urllib.request.Request(
            self.chat_completions_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"LLM HTTP {exc.code}: {body[:300]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc.reason}") from exc
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError("LLM response is not valid JSON") from exc
        return _extract_text(parsed)


@dataclass
class OpenAICompatibleEmbeddings:
    api_key: str
    model: str
    embeddings_url: str
    timeout_seconds: float = 20.0

    def embed_texts(self, texts: List[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {
            "model": self.model,
            "input": texts,
        }
        req = urllib.request.Request(
            self.embeddings_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Embedding HTTP {exc.code}: {body[:300]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Embedding request failed: {exc.reason}") from exc
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise RuntimeError("Embedding response is not valid JSON") from exc
        return _extract_embeddings(parsed)


def build_llm_client_from_env() -> OpenAICompatibleLLM | None:
    api_key = (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None
    model = (os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()
    base_url = (
        os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    ).strip()
    timeout_raw = (os.getenv("LLM_TIMEOUT_SECONDS") or "45").strip()
    try:
        timeout_seconds = max(5.0, float(timeout_raw))
    except Exception:
        timeout_seconds = 45.0
    temperature_raw = (os.getenv("LLM_TEMPERATURE") or "0.4").strip()
    try:
        temperature = min(1.5, max(0.0, float(temperature_raw)))
    except Exception:
        temperature = 0.4
    return OpenAICompatibleLLM(
        api_key=api_key,
        model=model,
        chat_completions_url=_normalize_chat_completions_url(base_url),
        timeout_seconds=timeout_seconds,
        temperature=temperature,
    )


def build_embedding_client_from_env() -> OpenAICompatibleEmbeddings | None:
    api_key = (
        os.getenv("EMBEDDING_API_KEY")
        or os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    ).strip()
    model = (os.getenv("EMBEDDING_MODEL") or "").strip()
    if not api_key or not model:
        return None
    base_url = (
        os.getenv("EMBEDDING_BASE_URL")
        or os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    ).strip()
    timeout_raw = (os.getenv("EMBEDDING_TIMEOUT_SECONDS") or "20").strip()
    try:
        timeout_seconds = max(5.0, float(timeout_raw))
    except Exception:
        timeout_seconds = 20.0
    return OpenAICompatibleEmbeddings(
        api_key=api_key,
        model=model,
        embeddings_url=_normalize_embeddings_url(base_url),
        timeout_seconds=timeout_seconds,
    )
