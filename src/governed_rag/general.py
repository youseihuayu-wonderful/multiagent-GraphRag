from __future__ import annotations

import hashlib
import itertools
import re
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from governed_rag.agents import best_quote
from governed_rag.corpus import Corpus
from governed_rag.models import (
    AgentOutput,
    AuditEvent,
    Citation,
    Document,
    ExecutionMetadata,
    GeneralDocumentInput,
    GraphContext,
    GraphEdge,
    GraphNode,
    GraphPath,
    KnowledgeGraphBundle,
    QueryResponse,
    TraceStep,
)
from governed_rag.retrieval import BM25Index, content_tokens
from governed_rag.trust import TrustEvaluator

Strategy = str
STRATEGY_WEIGHTS: dict[Strategy, dict[str, float]] = {
    "keyword": {"lexical": 0.65, "vector": 0.20, "title": 0.10, "graph": 0.05},
    "semantic": {"lexical": 0.25, "vector": 0.60, "title": 0.10, "graph": 0.05},
    "graph": {"lexical": 0.20, "vector": 0.20, "title": 0.05, "graph": 0.55},
}
ENTITY_PATTERN = re.compile(r"[^a-z0-9]+")
CJK_PATTERN = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def _identifier(value: str) -> str:
    normalized = ENTITY_PATTERN.sub("-", value.lower()).strip("-")
    if normalized:
        return normalized[:56]
    return hashlib.blake2s(value.encode(), digest_size=6).hexdigest()


def _evidence_quote(text: str, query: str, max_characters: int = 420) -> str:
    if len(text) <= max_characters:
        return text.strip()
    sentence = best_quote(text, query, max_characters=max_characters)
    start = max(0, text.find(sentence))
    return text[start : start + max_characters].strip()


def _split_document(document: GeneralDocumentInput, document_index: int) -> list[Document]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", document.text) if part.strip()]
    if not paragraphs:
        paragraphs = [document.text.strip()]
    segments: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= 1200:
            segments.append(paragraph)
            continue
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph)
            if sentence.strip()
        ]
        current = ""
        for sentence in sentences or [paragraph]:
            if current and len(current) + len(sentence) + 1 > 1200:
                segments.append(current)
                current = sentence
            elif len(sentence) > 1200:
                if current:
                    segments.append(current)
                    current = ""
                segments.extend(
                    sentence[offset : offset + 1200]
                    for offset in range(0, len(sentence), 1200)
                )
            else:
                current = f"{current} {sentence}".strip()
        if current:
            segments.append(current)

    chunks: list[str] = []
    current = ""
    for segment in segments:
        if current and len(current) + len(segment) + 2 > 1200:
            chunks.append(current)
            current = segment
        else:
            current = f"{current}\n\n{segment}".strip()
    if current:
        chunks.append(current)

    return [
        Document(
            source_id=f"DOC-{document_index:02d}-C{chunk_index:02d}",
            title=document.title,
            domain="general",
            published_at="workspace-session",
            text=chunk,
            synthetic=False,
        )
        for chunk_index, chunk in enumerate(chunks, start=1)
        if chunk.strip()
    ]


class SessionKnowledgeGraph:
    """Small, request-scoped concept graph extracted from uploaded text."""

    def __init__(self, documents: list[Document]) -> None:
        self.documents = documents
        texts = [document.text for document in documents]
        contains_cjk = any(CJK_PATTERN.search(text) for text in texts)
        vectorizer = TfidfVectorizer(
            analyzer="char" if contains_cjk else "word",
            ngram_range=(2, 4) if contains_cjk else (1, 2),
            stop_words=None if contains_cjk else "english",
            max_features=48,
            sublinear_tf=True,
        )
        try:
            matrix = vectorizer.fit_transform(texts)
        except ValueError:
            matrix = None
        features = vectorizer.get_feature_names_out() if matrix is not None else []
        totals = np.asarray(matrix.sum(axis=0)).ravel() if matrix is not None else np.array([])
        ranked_features = [
            feature
            for feature, _ in sorted(
                zip(features, totals, strict=True), key=lambda item: (-item[1], item[0])
            )
            if len(feature) >= 3
        ][:36]

        self.feature_by_id = {
            f"concept:{_identifier(feature)}": feature for feature in ranked_features
        }
        self.nodes = [
            GraphNode(
                id=node_id,
                label=feature.title(),
                type="workspace_concept",
                aliases=[feature],
            )
            for node_id, feature in self.feature_by_id.items()
        ]
        self.node_by_id = {node.id: node for node in self.nodes}
        edge_sources: dict[tuple[str, str], set[str]] = defaultdict(set)
        self.document_entities: dict[str, set[str]] = {}
        for document in documents:
            lowered = document.text.lower()
            present = [
                node_id
                for node_id, feature in self.feature_by_id.items()
                if re.search(rf"\b{re.escape(feature)}\b", lowered)
            ][:7]
            self.document_entities[document.source_id] = set(present)
            for source, target in itertools.combinations(sorted(present), 2):
                edge_sources[(source, target)].add(document.source_id)

        ranked_edges = sorted(
            edge_sources.items(), key=lambda item: (-len(item[1]), item[0])
        )[:60]
        self.edges = [
            GraphEdge(
                source=source,
                target=target,
                relation="co_occurs_with",
                source_ids=sorted(source_ids),
            )
            for (source, target), source_ids in ranked_edges
        ]

    def context(self, query: str) -> GraphContext:
        query_terms = set(content_tokens(query))
        seeds: list[tuple[str, float]] = []
        for node_id, feature in self.feature_by_id.items():
            feature_terms = set(content_tokens(feature))
            if not feature_terms:
                continue
            score = len(query_terms & feature_terms) / len(feature_terms)
            if score >= 0.5:
                seeds.append((node_id, score))
        seeds.sort(key=lambda item: (-item[1], item[0]))
        seeds = seeds[:6]
        seed_ids = {node_id for node_id, _ in seeds}
        paths: list[GraphPath] = []
        expanded_scores: dict[str, float] = {}
        boosts: dict[str, float] = defaultdict(float)
        for edge in self.edges:
            if edge.source not in seed_ids and edge.target not in seed_ids:
                continue
            source_score = next(
                (score for node_id, score in seeds if node_id in {edge.source, edge.target}),
                0.5,
            )
            neighbor = edge.target if edge.source in seed_ids else edge.source
            expanded_scores[neighbor] = max(expanded_scores.get(neighbor, 0.0), source_score * 0.6)
            for source_id in edge.source_ids:
                boosts[source_id] += source_score
            paths.append(
                GraphPath(
                    source=edge.source,
                    source_label=self.node_by_id[edge.source].label,
                    relation=edge.relation,
                    target=edge.target,
                    target_label=self.node_by_id[edge.target].label,
                    hop=1,
                    score=min(1.0, source_score * 0.8),
                    source_ids=edge.source_ids,
                )
            )
        maximum = max(boosts.values(), default=0.0)
        return GraphContext(
            seed_entities=[
                {
                    "id": node_id,
                    "label": self.node_by_id[node_id].label,
                    "type": self.node_by_id[node_id].type,
                    "score": round(score, 4),
                }
                for node_id, score in seeds
            ],
            expanded_entities=[
                {
                    "id": node_id,
                    "label": self.node_by_id[node_id].label,
                    "type": self.node_by_id[node_id].type,
                    "score": round(score, 4),
                }
                for node_id, score in sorted(
                    expanded_scores.items(), key=lambda item: (-item[1], item[0])
                )[:10]
                if node_id not in seed_ids
            ],
            paths=paths[:12],
            document_boosts={
                source_id: round(score / maximum, 4) if maximum else 0.0
                for source_id, score in boosts.items()
            },
        )

    def bundle(self) -> KnowledgeGraphBundle:
        return KnowledgeGraphBundle(
            generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
            synthetic=False,
            construction=(
                "Request-scoped deterministic TF-IDF concept extraction and source-linked "
                "co-occurrence edges from user-provided documents"
            ),
            nodes=self.nodes,
            edges=self.edges,
        )


class GeneralDocumentRAG:
    """Ephemeral governed RAG over user-provided text documents."""

    def invoke(
        self,
        query: str,
        documents: list[GeneralDocumentInput],
        top_k: int = 3,
        allowed_strategies: list[str] | None = None,
    ) -> QueryResponse:
        started = time.perf_counter()
        chunks = [
            chunk
            for index, document in enumerate(documents, start=1)
            for chunk in _split_document(document, index)
        ]
        corpus = Corpus(chunks)
        graph = SessionKnowledgeGraph(chunks)
        graph_context = graph.context(query)
        texts = [f"{document.title}. {document.text}" for document in chunks]
        bm25 = BM25Index(texts)
        raw_lexical = bm25.score(query)
        lexical = 1.0 - np.exp(-raw_lexical / 6.0)
        contains_cjk = bool(CJK_PATTERN.search(query)) or any(
            CJK_PATTERN.search(text) for text in texts
        )
        vectorizer = TfidfVectorizer(
            analyzer="char" if contains_cjk else "word",
            ngram_range=(2, 5) if contains_cjk else (1, 2),
            stop_words=None if contains_cjk else "english",
            sublinear_tf=True,
        )
        try:
            document_vectors = vectorizer.fit_transform(texts)
        except ValueError:
            vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
            document_vectors = vectorizer.fit_transform(texts)
        query_vector = vectorizer.transform([query])
        vector = np.clip(cosine_similarity(query_vector, document_vectors)[0], 0.0, 1.0)
        query_terms = set(content_tokens(query))
        title = np.array(
            [
                len(query_terms & set(content_tokens(document.title)))
                / max(1, len(query_terms))
                for document in chunks
            ],
            dtype=float,
        )
        graph_scores = np.array(
            [graph_context.document_boosts.get(document.source_id, 0.0) for document in chunks],
            dtype=float,
        )

        viable = {
            "keyword": bool(lexical.size and float(lexical.max()) >= 0.08),
            "semantic": bool(vector.size and float(vector.max()) >= 0.035),
            "graph": bool(
                graph_context.paths
                and graph_scores.size
                and float(graph_scores.max()) > 0
            ),
        }
        routes = [
            strategy
            for strategy in STRATEGY_WEIGHTS
            if viable[strategy]
            and (allowed_strategies is None or strategy in allowed_strategies)
        ]
        scope_error = None
        if not routes:
            scope_error = (
                "No uploaded document cleared the retrieval relevance floor for this question. "
                "Add a document containing the requested topic or ask a question grounded "
                "in the current workspace."
            )
        router_status = "PASS" if routes else "FAIL"
        audit: list[AuditEvent] = [
            AuditEvent(
                stage="router",
                status=router_status,
                detail=(
                    f"Selected retrieval strategies={routes}; documents={len(documents)}; "
                    f"chunks={len(chunks)}; viable={viable}."
                ),
            )
        ]
        traces: list[TraceStep] = [
            TraceStep(
                step_id="01-router",
                node="router",
                title="Route retrieval strategies",
                purpose=(
                    "Inspect the request-scoped index and dispatch only retrieval strategies "
                    "with a measurable evidence signal."
                ),
                status=router_status,
                duration_ms=(time.perf_counter() - started) * 1000,
                calls=[
                    "split_documents(max_chars=1200)",
                    "TfidfVectorizer.fit_transform(workspace)",
                    "SessionKnowledgeGraph.extract(workspace)",
                    "retrieval_signal_gate(query)",
                ],
                input={
                    "query": query,
                    "documents": [
                        {"title": document.title, "characters": len(document.text)}
                        for document in documents
                    ],
                    "top_k": top_k,
                },
                output={
                    "selected_routes": routes,
                    "viable_strategies": viable,
                    "chunks_created": len(chunks),
                    "graph_nodes": len(graph.nodes),
                    "graph_edges": len(graph.edges),
                    "scope_validation": {
                        "passed": bool(routes),
                        "reason": scope_error,
                        "persistence": "none",
                    },
                },
                checks=[
                    "At least one uploaded document is required.",
                    "Only strategies with measurable evidence may be dispatched.",
                    "Uploaded text is request-scoped and is not persisted by the application.",
                ],
            )
        ]

        outputs: list[AgentOutput] = []
        ranked_by_strategy: dict[str, list[dict[str, Any]]] = {}
        for strategy in routes:
            agent_started = time.perf_counter()
            weights = STRATEGY_WEIGHTS[strategy]
            combined = (
                weights["lexical"] * lexical
                + weights["vector"] * vector
                + weights["title"] * title
                + weights["graph"] * graph_scores
            )
            ranked_indices = list(np.argsort(-combined))
            selected_indices = [
                index
                for index in ranked_indices
                if lexical[index] >= 0.04
                or vector[index] >= 0.025
                or graph_scores[index] > 0
            ][:top_k]
            citations = [
                Citation(
                    source_id=chunks[index].source_id,
                    quote=_evidence_quote(chunks[index].text, query),
                    relevance_score=float(min(1.0, combined[index])),
                )
                for index in selected_indices
            ]
            top_score = max((citation.relevance_score for citation in citations), default=0.0)
            output = AgentOutput(
                source_agent=strategy,
                answer=" ".join(citation.quote for citation in citations),
                citations=citations,
                confidence=min(0.95, 0.45 + 0.5 * top_score),
                data_quality=0.90,
            )
            outputs.append(output)
            candidates = [
                {
                    "rank": rank,
                    "source_id": chunks[index].source_id,
                    "title": chunks[index].title,
                    "lexical_score": round(float(lexical[index]), 4),
                    "vector_score": round(float(vector[index]), 4),
                    "title_score": round(float(title[index]), 4),
                    "graph_score": round(float(graph_scores[index]), 4),
                    "combined_score": round(float(min(1.0, combined[index])), 4),
                    "selected_quote": _evidence_quote(chunks[index].text, query),
                }
                for rank, index in enumerate(ranked_indices[:top_k], start=1)
            ]
            ranked_by_strategy[strategy] = candidates
            audit.append(
                AuditEvent(
                    stage=f"agent:{strategy}",
                    status="PASS",
                    detail=(
                        f"{strategy.title()} retrieval returned {len(citations)} verified "
                        f"citations; top score={top_score:.3f}."
                    ),
                )
            )
            traces.append(
                TraceStep(
                    step_id=f"02-agent-{strategy}",
                    node=f"agent:{strategy}",
                    title=f"{strategy.title()} retrieval agent",
                    purpose=(
                        f"Rank request-scoped document chunks using the {strategy} evidence "
                        "view while preserving exact source quotes."
                    ),
                    status="PASS",
                    duration_ms=(time.perf_counter() - agent_started) * 1000,
                    calls=[
                        "BM25Index.score(query)",
                        "TfidfVectorizer.transform(query)",
                        "cosine_similarity(query, chunks)",
                        "SessionKnowledgeGraph.context(query)",
                        f"weighted_fusion(strategy={strategy})",
                        "AgentOutput.model_validate(...)"
                    ],
                    input={"query": query, "strategy": strategy, "top_k": top_k},
                    output={
                        "retrieval_backend": "request-scoped-tfidf",
                        "score_fusion": weights,
                        "graph_context": graph_context.model_dump(),
                        "candidates": candidates,
                        "relevance_gate": {
                            "passed": True,
                            "top_relevance": round(top_score, 4),
                        },
                        "schema_gate": {
                            "passed": True,
                            "citation_count": len(citations),
                        },
                    },
                    checks=[
                        "Every selected quote must exist verbatim in its uploaded chunk.",
                        "Citation source IDs must be unique within each agent output.",
                        "Only request-scoped documents may enter ranking.",
                    ],
                )
            )

        aggregation_started = time.perf_counter()
        unique_citations: dict[str, Citation] = {}
        for output in outputs:
            for citation in output.citations:
                existing = unique_citations.get(citation.source_id)
                if existing is None or citation.relevance_score > existing.relevance_score:
                    unique_citations[citation.source_id] = citation
        ordered_citations = sorted(
            unique_citations.values(), key=lambda citation: -citation.relevance_score
        )[:top_k]
        answer = None
        if ordered_citations:
            answer = "\n\n".join(
                f"{corpus.by_id[citation.source_id].title}: {citation.quote}"
                for citation in ordered_citations
            )
        aggregation_status = "PASS" if answer else "FAIL"
        audit.append(
            AuditEvent(
                stage="aggregation",
                status=aggregation_status,
                detail=(
                    f"Fused {len(outputs)} strategy outputs into "
                    f"{len(ordered_citations)} unique evidence chunks."
                ),
            )
        )
        traces.append(
            TraceStep(
                step_id="03-aggregation",
                node="aggregation",
                title="Cross-strategy evidence fusion",
                purpose=(
                    "Deduplicate citations from keyword, semantic, and graph retrieval while "
                    "retaining the strongest measured relevance."
                ),
                status=aggregation_status,
                duration_ms=(time.perf_counter() - aggregation_started) * 1000,
                calls=["deduplicate(source_id)", "max_relevance_merge()", "extractive_synthesis()"],
                input={
                    "strategy_outputs": len(outputs),
                    "candidate_sets": {
                        strategy: len(candidates)
                        for strategy, candidates in ranked_by_strategy.items()
                    },
                },
                output={
                    "answer_created": answer is not None,
                    "unique_citations": len(ordered_citations),
                    "answer_mode": "extractive",
                },
                checks=[
                    "Final synthesis may contain only verbatim uploaded evidence.",
                    "Duplicate chunk citations must be collapsed."
                ],
            )
        )

        trust_started = time.perf_counter()
        errors = [scope_error] if scope_error else []
        report = TrustEvaluator(corpus).evaluate(
            routes=routes, outputs=outputs, errors=errors
        )
        trust_status = {"ACCEPT": "PASS", "REJECT": "FAIL", "ESCALATE": "WARN"}[
            report.decision.value
        ]
        audit.append(
            AuditEvent(
                stage="trust_evaluator",
                status=trust_status,
                detail=f"Decision={report.decision.value}; reasons={' '.join(report.reasons)}",
            )
        )
        traces.append(
            TraceStep(
                step_id="04-trust-evaluator",
                node="trust_evaluator",
                title="Runtime trust decision",
                purpose=(
                    "Verify route coverage, exact uploaded quotes, evidence support, confidence, "
                    "and data quality before releasing the answer."
                ),
                status=trust_status,
                duration_ms=(time.perf_counter() - trust_started) * 1000,
                calls=[
                    "Corpus.validate_quote(source_id, quote)",
                    "token_support(answer, citations)",
                    "TrustEvaluator.evaluate(...)"
                ],
                input={
                    "approved_routes": routes,
                    "agent_output_count": len(outputs),
                    "boundary_errors": errors,
                },
                output=report.model_dump(mode="json"),
                checks=[
                    "routing_validity == 1.0",
                    "citation_coverage == 1.0",
                    "citation_validity == 1.0",
                    "support, confidence, and quality clear policy thresholds",
                ],
            )
        )
        return QueryResponse(
            query=query,
            retrieval_backend="request-scoped-tfidf",
            retrieval_mode="general-document-graphrag",
            routes=routes,
            answer=answer if report.decision.value == "ACCEPT" else None,
            agent_outputs=outputs,
            trust_report=report,
            audit_trail=audit,
            trace_steps=traces,
            errors=errors,
            latency_ms=(time.perf_counter() - started) * 1000,
            knowledge_graph=graph.bundle(),
            execution=ExecutionMetadata(
                requested_mode="deterministic",
                actual_mode="deterministic",
            ),
        )
