from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol


_CJK_BLOCK_RE = re.compile(r"[\u4e00-\u9fff]+")
_WORD_RE = re.compile(r"[A-Za-z0-9_]+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；!?])|\n+")
_RULE_CODE_RE = re.compile(r"\b(?:PACK|R)_[A-Z0-9_]+\b")

_CONTEXT_SKIP_PHRASES = (
    "当前短板",
    "这两项",
    "为什么是这两项",
    "当前地块",
    "该地块",
    "这个地块",
    "当前像元",
    "该像元",
    "规则链",
    "规则依据",
    "分项得分",
    "预测变化量",
    "基线shi",
    "预测shi",
    "点击结果",
)

_KNOWLEDGE_HINTS = (
    "为什么会影响",
    "为什么有效",
    "怎么做",
    "如何",
    "措施",
    "改良",
    "治理",
    "管理",
    "机理",
    "原理",
    "保墒",
    "保水",
    "节水",
    "控盐",
    "排盐",
    "盐碱地",
    "有机质",
    "有机肥",
    "秸秆还田",
    "保护性耕作",
    "滴灌",
    "热胁迫",
    "干旱",
    "土壤健康",
    "农业",
)

_FOLLOWUP_EXPLAIN_HINTS = (
    "为什么",
    "原因",
    "依据",
    "参考",
    "文献",
    "研究",
    "解释",
    "展开",
    "细说",
    "细讲",
    "具体说",
    "详细说",
)

_AGRONOMIC_HINTS = (
    "改土",
    "改良",
    "有机质",
    "有机肥",
    "秸秆",
    "覆膜",
    "覆盖作物",
    "保墒",
    "保水",
    "节水",
    "灌溉",
    "滴灌",
    "控盐",
    "排盐",
    "盐碱",
    "团聚体",
    "地力",
    "土壤",
    "热胁迫",
    "干旱",
    "稳产",
)


class EmbeddingProvider(Protocol):
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        ...


@dataclass(frozen=True)
class KnowledgeDocument:
    doc_id: str
    title: str
    category: str
    path: str
    text: str
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class KnowledgeHit:
    doc_id: str
    title: str
    category: str
    path: str
    score: float
    excerpt: str

    def to_dict(self) -> dict[str, object]:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "category": self.category,
            "path": self.path,
            "score": round(self.score, 4),
            "excerpt": self.excerpt,
        }


@dataclass(frozen=True)
class KnowledgeSearchDecision:
    enabled: bool
    mode: str
    query: str
    max_hits: int
    min_score: float
    reason: str


class LocalKnowledgeBase:
    def __init__(self, documents: list[KnowledgeDocument], embedder: EmbeddingProvider | None = None) -> None:
        self.documents = documents
        self._doc_tokens: dict[str, Counter[str]] = {}
        self._doc_title_tokens: dict[str, set[str]] = {}
        self._doc_embeddings: dict[str, tuple[float, ...]] = {}
        self._embedder = embedder
        doc_frequency: Counter[str] = Counter()
        for doc in documents:
            weighted_text = " ".join([doc.title, " ".join(doc.tags), doc.text])
            tokens = Counter(_tokenize(weighted_text))
            self._doc_tokens[doc.doc_id] = tokens
            title_tokens = set(_tokenize(" ".join([doc.title, *doc.tags])))
            self._doc_title_tokens[doc.doc_id] = title_tokens
            for token in tokens:
                doc_frequency[token] += 1
        total_docs = max(1, len(documents))
        self._idf = {
            token: math.log(1.0 + total_docs / (1.0 + freq)) + 1.0
            for token, freq in doc_frequency.items()
        }
        self._load_embeddings()

    @property
    def embedding_enabled(self) -> bool:
        return self._embedder is not None and bool(self._doc_embeddings)

    @classmethod
    def from_root(
        cls,
        root: Path | str,
        include_categories: Iterable[str] = ("core",),
        embedder: EmbeddingProvider | None = None,
    ) -> "LocalKnowledgeBase":
        root_path = Path(root)
        categories = tuple(str(item).strip() for item in include_categories if str(item).strip()) or ("core",)
        manifest_path = root_path / "manifest.json"
        documents: list[KnowledgeDocument] = []
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if not isinstance(manifest, list):
                raise ValueError("knowledge base manifest must be a list")
            seen_paths: set[str] = set()
            for item in manifest:
                if not isinstance(item, dict):
                    continue
                category = str(item.get("category", "")).strip() or "core"
                if category not in categories:
                    continue
                relative_path = str(item.get("path", "")).strip()
                if not relative_path:
                    continue
                file_path = root_path / relative_path
                if not file_path.exists() or file_path.suffix.lower() != ".txt":
                    continue
                text = file_path.read_text(encoding="utf-8", errors="ignore").strip()
                if not text:
                    continue
                rel_path = file_path.relative_to(root_path).as_posix()
                seen_paths.add(rel_path)
                documents.append(
                    KnowledgeDocument(
                        doc_id=str(item.get("doc_id") or file_path.stem),
                        title=str(item.get("title") or file_path.stem),
                        category=category,
                        path=rel_path,
                        text=text,
                        tags=tuple(str(tag).strip() for tag in item.get("tags", []) if str(tag).strip()),
                    )
                )
            for category in categories:
                category_dir = root_path / category
                if not category_dir.exists():
                    continue
                for file_path in sorted(category_dir.glob("*.txt")):
                    rel_path = file_path.relative_to(root_path).as_posix()
                    if rel_path in seen_paths:
                        continue
                    text = file_path.read_text(encoding="utf-8", errors="ignore").strip()
                    if not text:
                        continue
                    title = _first_nonempty_line(text) or file_path.stem
                    documents.append(
                        KnowledgeDocument(
                            doc_id=file_path.stem,
                            title=title,
                            category=category,
                            path=rel_path,
                            text=text,
                        )
                    )
            return cls(documents, embedder=embedder)

        for category in categories:
            category_dir = root_path / category
            if not category_dir.exists():
                continue
            for file_path in sorted(category_dir.glob("*.txt")):
                text = file_path.read_text(encoding="utf-8", errors="ignore").strip()
                if not text:
                    continue
                title = _first_nonempty_line(text) or file_path.stem
                documents.append(
                    KnowledgeDocument(
                        doc_id=file_path.stem,
                        title=title,
                        category=category,
                        path=file_path.relative_to(root_path).as_posix(),
                        text=text,
                    )
                )
        return cls(documents, embedder=embedder)

    def retrieve(
        self,
        query: str,
        *,
        source: str = "general_chat",
        fallback_query: str | None = None,
    ) -> list[KnowledgeHit]:
        decision = decide_knowledge_usage(query, source=source, fallback_query=fallback_query)
        if not decision.enabled:
            return []
        return self.search(
            decision.query,
            top_k=decision.max_hits,
            min_score=decision.min_score,
            relative_score_cutoff=0.72 if decision.mode == "primary" else 0.8,
        )

    def search(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 0.34,
        relative_score_cutoff: float = 0.72,
    ) -> list[KnowledgeHit]:
        cleaned_query = " ".join((query or "").split()).strip()
        if not cleaned_query or top_k <= 0:
            return []
        query_tokens = Counter(_tokenize(cleaned_query))
        query_embedding = self._embed_query(cleaned_query)
        if not query_tokens and query_embedding is None:
            return []

        hits: list[KnowledgeHit] = []
        query_token_set = set(query_tokens)
        for doc in self.documents:
            keyword_score = self._keyword_score(doc.doc_id, query_tokens)
            title_score = self._title_score(doc.doc_id, query_token_set)
            embedding_score = self._embedding_score(doc.doc_id, query_embedding)
            score = _combine_scores(keyword_score, title_score, embedding_score)
            if score < min_score:
                continue
            if keyword_score < 0.05 and title_score < 0.05 and (embedding_score or 0.0) < 0.55:
                continue
            excerpt = _best_excerpt(doc.text, query_tokens)
            hits.append(
                KnowledgeHit(
                    doc_id=doc.doc_id,
                    title=doc.title,
                    category=doc.category,
                    path=doc.path,
                    score=score,
                    excerpt=excerpt,
                )
            )

        hits.sort(key=lambda item: (-item.score, item.title))
        if not hits:
            return []
        best_score = hits[0].score
        score_cutoff = max(min_score, best_score * relative_score_cutoff)
        return [hit for hit in hits if hit.score >= score_cutoff][:top_k]

    def _load_embeddings(self) -> None:
        if self._embedder is None or not self.documents:
            return
        try:
            raw_vectors = self._embedder.embed_texts([_embedding_text_for_doc(doc) for doc in self.documents])
        except Exception:
            self._embedder = None
            self._doc_embeddings = {}
            return
        if len(raw_vectors) != len(self.documents):
            self._embedder = None
            self._doc_embeddings = {}
            return
        for doc, vector in zip(self.documents, raw_vectors):
            normalized = _normalize_vector(vector)
            if normalized is not None:
                self._doc_embeddings[doc.doc_id] = normalized
        if not self._doc_embeddings:
            self._embedder = None

    def _embed_query(self, query: str) -> tuple[float, ...] | None:
        if self._embedder is None or not self._doc_embeddings:
            return None
        try:
            raw_vectors = self._embedder.embed_texts([query])
        except Exception:
            return None
        if not raw_vectors:
            return None
        return _normalize_vector(raw_vectors[0])

    def _keyword_score(self, doc_id: str, query_tokens: Counter[str]) -> float:
        if not query_tokens:
            return 0.0
        doc_tokens = self._doc_tokens.get(doc_id, Counter())
        weighted_total = 0.0
        weighted_match = 0.0
        repeat_bonus = 0.0
        for token, q_freq in query_tokens.items():
            token_weight = self._idf.get(token, 1.0) * q_freq
            weighted_total += token_weight
            d_freq = doc_tokens.get(token, 0)
            if d_freq <= 0:
                continue
            weighted_match += token_weight
            repeat_bonus += 0.04 * min(2, d_freq - 1)
        if weighted_total <= 0.0:
            return 0.0
        return min(1.0, (weighted_match / weighted_total) + repeat_bonus)

    def _title_score(self, doc_id: str, query_token_set: set[str]) -> float:
        if not query_token_set:
            return 0.0
        title_tokens = self._doc_title_tokens.get(doc_id, set())
        if not title_tokens:
            return 0.0
        return len(query_token_set & title_tokens) / max(1, len(query_token_set))

    def _embedding_score(self, doc_id: str, query_embedding: tuple[float, ...] | None) -> float | None:
        if query_embedding is None:
            return None
        doc_embedding = self._doc_embeddings.get(doc_id)
        if doc_embedding is None or len(doc_embedding) != len(query_embedding):
            return None
        return max(0.0, sum(left * right for left, right in zip(doc_embedding, query_embedding)))


def decide_knowledge_usage(
    query: str,
    *,
    source: str = "general_chat",
    fallback_query: str | None = None,
) -> KnowledgeSearchDecision:
    cleaned_query = " ".join((query or "").split()).strip()
    effective_query = " ".join((fallback_query or cleaned_query).split()).strip()
    if source == "plan_generate":
        if len(_tokenize(effective_query)) < 4:
            return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "plan-query-too-short")
        return KnowledgeSearchDecision(True, "assist", effective_query, 2, 0.32, "plan-generate")

    if not cleaned_query:
        return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "empty-query")

    lowered = cleaned_query.lower()
    effective_lower = effective_query.lower()
    context_score = sum(1 for phrase in _CONTEXT_SKIP_PHRASES if phrase in lowered)
    if _RULE_CODE_RE.search(cleaned_query):
        context_score += 2
    knowledge_score = sum(1 for phrase in _KNOWLEDGE_HINTS if phrase in lowered)
    effective_knowledge_score = sum(1 for phrase in _KNOWLEDGE_HINTS if phrase in effective_lower)
    followup_explain_score = sum(1 for phrase in _FOLLOWUP_EXPLAIN_HINTS if phrase in lowered)
    agronomic_score = sum(1 for phrase in _AGRONOMIC_HINTS if phrase in effective_lower)
    rule_explain_score = sum(1 for phrase in ("短板", "这两项", "分项", "规则", "变化量", "基线shi", "预测shi") if phrase in lowered)

    if source == "plan_chat":
        decision_query = effective_query or cleaned_query
        if rule_explain_score >= 1 and knowledge_score == 0:
            return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "contextual-rule-question")
        if knowledge_score > 0 or (followup_explain_score > 0 and agronomic_score > 0) or effective_knowledge_score > 0:
            return KnowledgeSearchDecision(True, "primary", decision_query, 3, 0.34, "contextual-knowledge-question")
        if context_score >= 1:
            return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "contextual-rule-question")
    if context_score >= 2 and knowledge_score == 0:
        return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "context-dominant")
    if knowledge_score > 0:
        return KnowledgeSearchDecision(True, "primary", cleaned_query, 3, 0.34, "knowledge-question")
    if source == "general_chat" and len(_tokenize(cleaned_query)) >= 8:
        return KnowledgeSearchDecision(True, "assist", cleaned_query, 2, 0.42, "long-general-query")
    return KnowledgeSearchDecision(False, "none", "", 0, 1.0, "fallback-skip")


def build_knowledge_context(hits: Iterable[KnowledgeHit | dict[str, object]]) -> str:
    normalized: list[dict[str, object]] = []
    for hit in hits:
        if isinstance(hit, KnowledgeHit):
            normalized.append(hit.to_dict())
        elif isinstance(hit, dict):
            normalized.append(hit)
    if not normalized:
        return ""
    lines = [
        "知识库参考：以下资料为本轮回答的优先依据；如果资料没有直接覆盖用户问题，必须明确说明“知识库未直接覆盖，以下为通用建议”。",
    ]
    for idx, item in enumerate(normalized, start=1):
        title = str(item.get("title", "")).strip()
        category = str(item.get("category", "")).strip() or "core"
        excerpt = str(item.get("excerpt", "")).strip()
        path = str(item.get("path", "")).strip()
        if title:
            lines.append(f"[{idx}] {title} | {category} | {path}")
        if excerpt:
            lines.append(f"摘录：{excerpt}")
    return "\n".join(lines)



def _first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""



def _tokenize(text: str) -> list[str]:
    lowered = text.lower()
    tokens: list[str] = []
    for word in _WORD_RE.findall(lowered):
        if len(word) >= 2:
            tokens.append(word)
    for block in _CJK_BLOCK_RE.findall(lowered):
        cleaned = block.strip()
        if not cleaned:
            continue
        if len(cleaned) == 1:
            tokens.append(cleaned)
            continue
        tokens.extend(cleaned[idx : idx + 2] for idx in range(len(cleaned) - 1))
    return tokens



def _split_sentences(text: str) -> list[str]:
    parts: list[str] = []
    for segment in _SENTENCE_SPLIT_RE.split(text):
        cleaned = segment.strip()
        if cleaned:
            parts.append(cleaned)
    return parts



def _best_excerpt(text: str, query_tokens: Counter[str]) -> str:
    sentences = _split_sentences(text)
    if not sentences:
        return text[:160].strip()
    if not query_tokens:
        excerpt = " ".join(sentences[:2]).strip()
        return excerpt[:177].rstrip() + "..." if len(excerpt) > 180 else excerpt

    query_token_set = set(query_tokens)
    ranked: list[tuple[float, int]] = []
    for idx, sentence in enumerate(sentences[:80]):
        sentence_tokens = set(_tokenize(sentence))
        overlap = len(query_token_set & sentence_tokens)
        score = overlap * 2.0 + min(len(sentence), 120) / 240.0
        ranked.append((score, idx))
    ranked.sort(reverse=True)
    _, best_idx = ranked[0]
    selected = [sentences[best_idx]]
    if best_idx + 1 < len(sentences):
        next_sentence = sentences[best_idx + 1]
        next_overlap = len(query_token_set & set(_tokenize(next_sentence)))
        if next_overlap > 0 or len(selected[0]) < 60:
            selected.append(next_sentence)
    excerpt = "；".join(selected).strip()
    if len(excerpt) > 180:
        excerpt = excerpt[:177].rstrip() + "..."
    return excerpt



def _embedding_text_for_doc(doc: KnowledgeDocument) -> str:
    merged = "\n".join(part for part in [doc.title, " ".join(doc.tags), doc.text] if part).strip()
    return merged[:2400]



def _normalize_vector(values: list[float] | tuple[float, ...]) -> tuple[float, ...] | None:
    if not values:
        return None
    total = 0.0
    cleaned: list[float] = []
    for value in values:
        try:
            number = float(value)
        except Exception:
            return None
        cleaned.append(number)
        total += number * number
    if total <= 0.0:
        return None
    scale = math.sqrt(total)
    return tuple(number / scale for number in cleaned)



def _combine_scores(keyword_score: float, title_score: float, embedding_score: float | None) -> float:
    if embedding_score is None:
        return round((keyword_score * 0.84) + (title_score * 0.16), 6)
    return round((embedding_score * 0.56) + (keyword_score * 0.29) + (title_score * 0.15), 6)
