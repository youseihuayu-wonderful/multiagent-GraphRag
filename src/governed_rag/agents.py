from __future__ import annotations

import re
from typing import Any

from pydantic import ValidationError

from governed_rag.models import AgentOutput, AuditEvent, Citation, Domain
from governed_rag.retrieval import HybridRetriever, tokenize

DOMAIN_KEYWORDS: dict[Domain, set[str]] = {
    "equity": {
        "company", "revenue", "earnings", "margin", "cloud", "customer",
        "risk", "quarter", "annual", "operating", "profit",
    },
    "macro": {
        "cpi", "inflation", "gdp", "unemployment", "rate", "rates", "federal",
        "economy", "economic", "labor", "treasury", "consumer", "macro",
    },
    "esg": {
        "esg", "emission", "emissions", "carbon", "climate", "energy", "renewable",
        "sustainability", "workforce", "water", "governance", "supplier",
    },
}


def route_query(query: str) -> tuple[list[Domain], dict[Domain, float]]:
    terms = set(tokenize(query))
    raw = {domain: len(terms & keywords) for domain, keywords in DOMAIN_KEYWORDS.items()}
    maximum = max(raw.values()) if raw else 0
    if maximum == 0:
        return ["equity"], {"equity": 0.15, "macro": 0.0, "esg": 0.0}
    threshold = max(1, int(maximum * 0.5))
    routes = [domain for domain, score in raw.items() if score >= threshold and score > 0]
    total = sum(raw.values()) or 1
    scores = {domain: raw[domain] / total for domain in DOMAIN_KEYWORDS}
    return routes, scores


def best_quote(text: str, query: str, max_characters: int = 360) -> str:
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", text) if sentence]
    query_terms = set(tokenize(query))
    sentence = max(
        sentences,
        key=lambda candidate: len(query_terms & set(tokenize(candidate))),
        default=text,
    )
    return sentence[:max_characters].strip()


class RetrievalAgent:
    def __init__(self, retriever: HybridRetriever) -> None:
        self.retriever = retriever

    def run_raw(
        self,
        query: str,
        domain: Domain,
        top_k: int,
        fault: str = "none",
    ) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
        chunks, graph_context = self.retriever.search_with_trace(query, domain, top_k=top_k)
        citations = [
            Citation(
                source_id=chunk.source_id,
                quote=best_quote(chunk.text, query),
                relevance_score=chunk.combined_score,
            ).model_dump()
            for chunk in chunks
        ]
        evidence = " ".join(
            f"{chunk.title}: {best_quote(chunk.text, query)}" for chunk in chunks[:2]
        )
        top_score = chunks[0].combined_score if chunks else 0.0
        confidence = min(0.98, 0.35 + 0.65 * top_score)
        data_quality = 0.95 if chunks else 0.0
        raw: dict[str, Any] = {
            "source_agent": domain,
            "answer": evidence or f"No {domain} evidence was retrieved for the query.",
            "citations": citations,
            "confidence": confidence,
            "data_quality": data_quality,
        }

        if fault == "no_citation":
            raw["citations"] = []
        elif fault == "invalid_citation" and raw["citations"]:
            raw["citations"][0]["source_id"] = "NONEXISTENT-SOURCE"
        elif fault == "low_confidence":
            raw["confidence"] = 0.05
        candidates = [
            {
                "rank": rank,
                "source_id": chunk.source_id,
                "title": chunk.title,
                "lexical_score": round(chunk.lexical_score, 4),
                "vector_score": round(chunk.vector_score, 4),
                "title_score": round(chunk.title_score, 4),
                "graph_score": round(chunk.graph_score, 4),
                "combined_score": round(chunk.combined_score, 4),
                "selected_quote": best_quote(chunk.text, query),
            }
            for rank, chunk in enumerate(chunks, start=1)
        ]
        return raw, candidates, graph_context.model_dump()

    def run_with_gate(
        self,
        query: str,
        domain: Domain,
        top_k: int,
        fault: str = "none",
    ) -> tuple[AgentOutput | None, list[str], AuditEvent, dict[str, Any]]:
        raw, candidates, graph_context = self.run_raw(query, domain, top_k, fault)
        trace = {
            "retrieval_backend": self.retriever.embedding_backend,
            "score_fusion": {
                "bm25": self.retriever.lexical_weight,
                "vector": 1
                - self.retriever.lexical_weight
                - self.retriever.title_weight
                - self.retriever.graph_weight,
                "title": self.retriever.title_weight,
                "graph": self.retriever.graph_weight,
            },
            "graph_context": graph_context,
            "candidates": candidates,
            "raw_agent_output": raw,
            "injected_fault": fault,
        }
        top_relevance = candidates[0]["combined_score"] if candidates else 0.0
        minimum_relevance = self.retriever.minimum_relevance_score
        topic_entities = [
            entity
            for entity in graph_context.get("seed_entities", [])
            if entity.get("type") != "organization"
        ]
        topic_anchored = bool(topic_entities) and top_relevance >= 0.10
        relevance_gate = {
            "passed": top_relevance >= minimum_relevance or topic_anchored,
            "top_relevance": top_relevance,
            "minimum_relevance": minimum_relevance,
            "topic_anchored": topic_anchored,
            "topic_entities": [entity.get("label") for entity in topic_entities],
        }
        trace["relevance_gate"] = relevance_gate
        if not relevance_gate["passed"]:
            message = (
                f"{domain} relevance gate blocked retrieval: top evidence score "
                f"{top_relevance:.3f} is below the {minimum_relevance:.2f} release threshold "
                "and no indexed topic entity provided a safe retrieval anchor."
            )
            return (
                None,
                [message],
                AuditEvent(stage=f"agent:{domain}", status="FAIL", detail=message),
                {
                    **trace,
                    "schema_gate": {
                        "passed": False,
                        "skipped": True,
                        "reason": "No sufficiently relevant evidence entered the schema boundary.",
                    },
                },
            )
        try:
            output = AgentOutput.model_validate(raw)
        except ValidationError as error:
            message = f"{domain} output failed schema gate: {error.errors()[0]['msg']}"
            return (
                None,
                [message],
                AuditEvent(stage=f"agent:{domain}", status="FAIL", detail=message),
                {**trace, "schema_gate": {"passed": False, "error": message}},
            )
        return (
            output,
            [],
            AuditEvent(
                stage=f"agent:{domain}",
                status="PASS",
                detail=(
                    f"Relevance and schema gates passed with {len(output.citations)} citations; "
                    f"top evidence score={top_relevance:.3f}."
                ),
            ),
            {
                **trace,
                "schema_gate": {
                    "passed": True,
                    "required_fields": [
                        "source_agent",
                        "answer",
                        "citations[min_length=1]",
                        "confidence[0..1]",
                        "data_quality[0..1]",
                    ],
                },
            },
        )
