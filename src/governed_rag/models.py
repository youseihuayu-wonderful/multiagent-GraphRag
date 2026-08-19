from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ExecutionMode = Literal["deterministic", "hybrid", "llm"]

Domain = Literal[
    "equity",
    "macro",
    "esg",
    "general",
    "keyword",
    "semantic",
    "graph",
    "synthesis",
]


class Decision(StrEnum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    ESCALATE = "ESCALATE"


class Document(BaseModel):
    source_id: str = Field(min_length=3)
    title: str = Field(min_length=3)
    domain: Domain
    published_at: str
    text: str = Field(min_length=1)
    synthetic: bool = True


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    aliases: list[str] = Field(default_factory=list)


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    source_ids: list[str] = Field(min_length=1)


class GraphPath(BaseModel):
    source: str
    source_label: str
    relation: str
    target: str
    target_label: str
    hop: int = Field(ge=1)
    score: float = Field(ge=0.0, le=1.0)
    source_ids: list[str]


class GraphContext(BaseModel):
    seed_entities: list[dict[str, Any]]
    expanded_entities: list[dict[str, Any]]
    paths: list[GraphPath]
    document_boosts: dict[str, float]


class KnowledgeGraphBundle(BaseModel):
    generated_at: str
    synthetic: bool
    construction: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class RetrievedChunk(BaseModel):
    source_id: str
    title: str
    domain: Domain
    text: str
    lexical_score: float = Field(ge=0.0, le=1.0)
    vector_score: float = Field(ge=0.0, le=1.0)
    title_score: float = Field(ge=0.0, le=1.0)
    graph_score: float = Field(ge=0.0, le=1.0)
    combined_score: float = Field(ge=0.0, le=1.0)


class Citation(BaseModel):
    source_id: str = Field(min_length=3)
    quote: str = Field(min_length=1)
    relevance_score: float = Field(ge=0.0, le=1.0)


class AgentOutput(BaseModel):
    source_agent: Domain
    answer: str = Field(min_length=1)
    citations: list[Citation] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    data_quality: float = Field(ge=0.0, le=1.0)

    @field_validator("citations")
    @classmethod
    def unique_citations(cls, citations: list[Citation]) -> list[Citation]:
        ids = [citation.source_id for citation in citations]
        if len(ids) != len(set(ids)):
            raise ValueError("citation source IDs must be unique per agent output")
        return citations


class AuditEvent(BaseModel):
    stage: str
    status: Literal["INFO", "PASS", "FAIL", "WARN"]
    detail: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(timespec="milliseconds")
    )


class TraceStep(BaseModel):
    step_id: str
    node: str
    title: str
    purpose: str
    status: Literal["PASS", "FAIL", "WARN"]
    duration_ms: float = Field(ge=0.0)
    calls: list[str]
    input: dict[str, Any]
    output: dict[str, Any]
    checks: list[str] = Field(default_factory=list)


class TrustReport(BaseModel):
    decision: Decision
    routing_validity: float = Field(ge=0.0, le=1.0)
    citation_coverage: float = Field(ge=0.0, le=1.0)
    citation_validity: float = Field(ge=0.0, le=1.0)
    support_score: float = Field(ge=0.0, le=1.0)
    average_confidence: float = Field(ge=0.0, le=1.0)
    average_data_quality: float = Field(ge=0.0, le=1.0)
    reasons: list[str]


class QueryRequest(BaseModel):
    query: str = Field(min_length=3, max_length=1000)
    top_k: int = Field(default=3, ge=1, le=5)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, query: str) -> str:
        normalized = " ".join(query.split())
        if len(normalized) < 3:
            raise ValueError("query must contain at least 3 non-whitespace characters")
        return normalized


class GeneralDocumentInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1)

    @field_validator("title")
    @classmethod
    def normalize_document_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("document title must not be blank")
        return normalized

    @field_validator("text")
    @classmethod
    def normalize_document_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("document text must not be blank")
        return normalized


class GeneralQueryRequest(BaseModel):
    query: str = Field(min_length=3, max_length=1000)
    documents: list[GeneralDocumentInput] = Field(min_length=1, max_length=20)
    top_k: int = Field(default=3, ge=1, le=5)
    mode: ExecutionMode = "deterministic"

    @field_validator("query")
    @classmethod
    def normalize_general_query(cls, query: str) -> str:
        normalized = " ".join(query.split())
        if len(normalized) < 3:
            raise ValueError("query must contain at least 3 non-whitespace characters")
        return normalized

    @model_validator(mode="after")
    def enforce_workspace_size(self) -> GeneralQueryRequest:
        if sum(len(document.text) for document in self.documents) > 120_000:
            raise ValueError("workspace document text must not exceed 120000 characters")
        return self


class ExecutionMetadata(BaseModel):
    requested_mode: ExecutionMode
    actual_mode: Literal["deterministic", "llm"]
    provider: str | None = None
    model: str | None = None
    fallback_reason: str | None = None


class QueryResponse(BaseModel):
    query: str
    retrieval_backend: str
    retrieval_mode: str
    routes: list[Domain]
    answer: str | None
    agent_outputs: list[AgentOutput]
    trust_report: TrustReport
    audit_trail: list[AuditEvent]
    trace_steps: list[TraceStep]
    errors: list[str]
    latency_ms: float = Field(ge=0.0)
    knowledge_graph: KnowledgeGraphBundle | None = None
    execution: ExecutionMetadata | None = None


class EvaluationCase(BaseModel):
    case_id: str
    query: str
    expected_domains: list[Domain]
    expected_decision: Decision
    expected_sources: list[str] = Field(default_factory=list)
    fault: Literal["none", "no_citation", "invalid_citation", "low_confidence"] = "none"


class EvaluationSummary(BaseModel):
    retrieval_backend: str
    retrieval_mode: str
    embedding_model: str
    corpus_documents: int
    graph_nodes: int
    graph_edges: int
    cases: int
    decision_accuracy: float
    route_exact_match: float
    source_hit_rate: float
    unsafe_case_block_rate: float
    p50_latency_ms: float
    p95_latency_ms: float
    results: list[dict[str, Any]]
