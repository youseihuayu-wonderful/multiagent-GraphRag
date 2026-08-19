from __future__ import annotations

import operator
import time
from pathlib import Path
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from governed_rag.agents import RetrievalAgent, route_query
from governed_rag.corpus import DEFAULT_CORPUS_PATH, Corpus
from governed_rag.models import AgentOutput, AuditEvent, Domain, QueryResponse, TraceStep
from governed_rag.retrieval import HybridRetriever
from governed_rag.trust import TrustEvaluator


class OverallState(TypedDict, total=False):
    query: str
    top_k: int
    fault: str
    routes: list[Domain]
    route_scores: dict[Domain, float]
    agent_outputs: Annotated[list[dict[str, Any]], operator.add]
    errors: Annotated[list[str], operator.add]
    audit_trail: Annotated[list[dict[str, Any]], operator.add]
    trace_steps: Annotated[list[dict[str, Any]], operator.add]
    answer: str | None
    trust_report: dict[str, Any]


class WorkerState(TypedDict):
    query: str
    top_k: int
    fault: str
    domain: Domain


class GovernedRAG:
    def __init__(
        self,
        corpus_path: str | Path = DEFAULT_CORPUS_PATH,
        embedding_backend: str = "tfidf",
    ) -> None:
        self.corpus = Corpus.from_json(corpus_path)
        self.retriever = HybridRetriever(self.corpus, embedding_backend=embedding_backend)
        self.agent = RetrievalAgent(self.retriever)
        self.evaluator = TrustEvaluator(self.corpus)
        self.graph = self._build_graph()

    def _build_graph(self):
        builder = StateGraph(OverallState)
        builder.add_node("router", self._router_node)
        builder.add_node("retrieval_agent", self._agent_node)
        builder.add_node("aggregate", self._aggregate_node)
        builder.add_node("trust_evaluator", self._trust_node)
        builder.add_edge(START, "router")
        builder.add_conditional_edges("router", self._dispatch, ["retrieval_agent", "aggregate"])
        builder.add_edge("retrieval_agent", "aggregate")
        builder.add_edge("aggregate", "trust_evaluator")
        builder.add_edge("trust_evaluator", END)
        return builder.compile()

    def _router_node(self, state: OverallState) -> dict[str, Any]:
        started = time.perf_counter()
        requested_routes, scores = route_query(state["query"])
        resolved_organizations = self.retriever.knowledge_graph.resolve_organizations(
            state["query"]
        )
        supported_organizations = self.retriever.knowledge_graph.supported_organizations
        requires_organization = bool({"equity", "esg"} & set(requested_routes))
        scope_valid = (
            not requires_organization
            or bool(resolved_organizations)
            or state.get("fault", "none") != "none"
        )
        routes = requested_routes if scope_valid else []
        scope_error = (
            "No indexed organization matched this query. This synthetic demo can answer "
            f"company-specific equity and ESG questions only for: "
            f"{', '.join(supported_organizations)}."
            if not scope_valid
            else None
        )
        status = "PASS" if scope_valid else "FAIL"
        event = AuditEvent(
            stage="router",
            status=status,
            detail=(
                f"Selected routes: {', '.join(routes)}; resolved organizations="
                f"{resolved_organizations}; scope_valid={scope_valid}; scores={scores}"
            ),
        )
        trace = TraceStep(
            step_id="01-router",
            node="router",
            title="Route and validate corpus scope",
            purpose=(
                "Select only the needed financial domains and fail closed when a "
                "company-specific request has no organization in the governed corpus."
            ),
            status=status,
            duration_ms=(time.perf_counter() - started) * 1000,
            calls=[
                "tokenize(query)",
                "route_query(query)",
                "resolve_organizations(query)",
                "corpus_scope_gate(query, routes)",
                "LangGraph Send(...)" if scope_valid else "fail_closed_to_aggregation()",
            ],
            input={"query": state["query"]},
            output={
                "requested_routes": requested_routes,
                "selected_routes": routes,
                "domain_scores": scores,
                "scope_validation": {
                    "passed": scope_valid,
                    "resolved_organizations": resolved_organizations,
                    "supported_organizations": supported_organizations,
                    "reason": scope_error,
                },
            },
            checks=[
                "Output routes must be a subset of equity, macro, and esg.",
                "Equity and ESG requests must resolve to an indexed organization.",
                "Unsupported organizations must fail closed before retrieval.",
            ],
        )
        return {
            "routes": routes,
            "route_scores": scores,
            "errors": [scope_error] if scope_error else [],
            "audit_trail": [event.model_dump()],
            "trace_steps": [trace.model_dump()],
        }

    def _dispatch(self, state: OverallState) -> list[Send] | str:
        if not state["routes"]:
            return "aggregate"
        return [
            Send(
                "retrieval_agent",
                {
                    "query": state["query"],
                    "top_k": state.get("top_k", 3),
                    "fault": state.get("fault", "none"),
                    "domain": domain,
                },
            )
            for domain in state["routes"]
        ]

    def _agent_node(self, state: WorkerState) -> dict[str, Any]:
        started = time.perf_counter()
        output, errors, event, detail = self.agent.run_with_gate(
            query=state["query"],
            domain=state["domain"],
            top_k=state["top_k"],
            fault=state.get("fault", "none"),
        )
        status = "PASS" if output else "FAIL"
        trace = TraceStep(
            step_id=f"02-agent-{state['domain']}",
            node=f"agent:{state['domain']}",
            title=f"{state['domain'].title()} GraphRAG agent",
            purpose=(
                "Link query entities, traverse the knowledge graph, fuse graph and text scores, "
                "construct citations, and enforce the agent contract."
            ),
            status=status,
            duration_ms=(time.perf_counter() - started) * 1000,
            calls=[
                "FinancialKnowledgeGraph.expand(query, domain)",
                "BM25Index.score(query)",
                f"{self.retriever.embedding_backend}.embed(query)",
                "cosine_similarity(query, documents)",
                "weighted_fusion(bm25, vector, title, graph)",
                "AgentOutput.model_validate(raw_output)",
            ],
            input={
                "query": state["query"],
                "domain": state["domain"],
                "top_k": state["top_k"],
                "fault_injection": state.get("fault", "none"),
            },
            output=detail,
            checks=[
                "citations must contain at least one item",
                "citation source IDs must be unique",
                "confidence and data_quality must be within [0, 1]",
                "graph paths may reference only indexed source IDs",
            ],
        )
        return {
            "agent_outputs": [output.model_dump()] if output else [],
            "errors": errors,
            "audit_trail": [event.model_dump()],
            "trace_steps": [trace.model_dump()],
        }

    def _aggregate_node(self, state: OverallState) -> dict[str, Any]:
        started = time.perf_counter()
        outputs = [AgentOutput.model_validate(item) for item in state.get("agent_outputs", [])]
        answer = "\n\n".join(output.answer for output in outputs) if outputs else None
        status = "PASS" if outputs else "FAIL"
        event = AuditEvent(
            stage="aggregation",
            status=status,
            detail=f"Aggregated {len(outputs)} valid agent outputs.",
        )
        trace = TraceStep(
            step_id="03-aggregation",
            node="aggregation",
            title="Evidence-preserving aggregation",
            purpose="Merge valid agent outputs without dropping source attribution.",
            status=status,
            duration_ms=(time.perf_counter() - started) * 1000,
            calls=["AgentOutput.model_validate(...) for each branch", "map-reduce merge"],
            input={
                "valid_agent_count": len(outputs),
                "agents": [output.source_agent for output in outputs],
                "error_count": len(state.get("errors", [])),
            },
            output={
                "answer_created": answer is not None,
                "answer_characters": len(answer or ""),
                "preserved_citations": sum(len(output.citations) for output in outputs),
            },
            checks=["Only schema-valid outputs may enter aggregation."],
        )
        return {
            "answer": answer,
            "audit_trail": [event.model_dump()],
            "trace_steps": [trace.model_dump()],
        }

    def _trust_node(self, state: OverallState) -> dict[str, Any]:
        started = time.perf_counter()
        outputs = [AgentOutput.model_validate(item) for item in state.get("agent_outputs", [])]
        report = self.evaluator.evaluate(
            routes=state.get("routes", []), outputs=outputs, errors=state.get("errors", [])
        )
        status = {
            "ACCEPT": "PASS",
            "REJECT": "FAIL",
            "ESCALATE": "WARN",
        }[report.decision.value]
        event = AuditEvent(
            stage="trust_evaluator",
            status=status,
            detail=f"Decision={report.decision.value}; reasons={' '.join(report.reasons)}",
        )
        trace = TraceStep(
            step_id="04-trust-evaluator",
            node="trust_evaluator",
            title="Runtime trust decision",
            purpose="Independently validate routing, citations, support, and confidence.",
            status=status,
            duration_ms=(time.perf_counter() - started) * 1000,
            calls=[
                "Corpus.validate_quote(source_id, quote)",
                "token_support(answer, citations)",
                "TrustEvaluator.evaluate(...) behavior policy",
            ],
            input={
                "approved_routes": state.get("routes", []),
                "agent_output_count": len(outputs),
                "boundary_errors": state.get("errors", []),
            },
            output=report.model_dump(mode="json"),
            checks=[
                "routing_validity == 1.0",
                "citation_coverage == 1.0",
                "citation_validity == 1.0",
                "confidence, quality, and support clear escalation thresholds",
            ],
        )
        return {
            "trust_report": report.model_dump(),
            "audit_trail": [event.model_dump()],
            "trace_steps": [trace.model_dump()],
        }

    def invoke(
        self,
        query: str,
        top_k: int = 3,
        *,
        fault: str = "none",
    ) -> QueryResponse:
        started = time.perf_counter()
        result = self.graph.invoke(
            {
                "query": query,
                "top_k": top_k,
                "fault": fault,
                "agent_outputs": [],
                "errors": [],
                "audit_trail": [],
                "trace_steps": [],
            }
        )
        latency_ms = (time.perf_counter() - started) * 1000
        return QueryResponse.model_validate(
            {
                "query": query,
                "retrieval_backend": self.retriever.embedding_backend,
                "retrieval_mode": "graphrag-hybrid",
                "routes": result["routes"],
                "answer": result.get("answer"),
                "agent_outputs": result.get("agent_outputs", []),
                "trust_report": result["trust_report"],
                "audit_trail": result.get("audit_trail", []),
                "trace_steps": result.get("trace_steps", []),
                "errors": result.get("errors", []),
                "latency_ms": latency_ms,
            }
        )
