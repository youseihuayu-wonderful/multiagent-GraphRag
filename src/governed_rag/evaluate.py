from __future__ import annotations

import os
from pathlib import Path
from statistics import median

import numpy as np

from governed_rag.corpus import PROJECT_ROOT
from governed_rag.graph import GovernedRAG
from governed_rag.models import EvaluationCase, EvaluationSummary

DEFAULT_CASES = PROJECT_ROOT / "data" / "evaluation" / "cases.jsonl"
REPORT_JSON = PROJECT_ROOT / "reports" / "evaluation_results.json"
REPORT_MD = PROJECT_ROOT / "reports" / "evaluation_results.md"


def load_cases(path: str | Path = DEFAULT_CASES) -> list[EvaluationCase]:
    return [
        EvaluationCase.model_validate_json(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def evaluate(path: str | Path = DEFAULT_CASES) -> EvaluationSummary:
    runtime = GovernedRAG(
        embedding_backend=os.getenv("GOVERNED_RAG_EMBEDDING_BACKEND", "tfidf")
    )
    cases = load_cases(path)
    rows: list[dict] = []
    for case in cases:
        response = runtime.invoke(case.query, fault=case.fault)
        cited_sources = {
            citation.source_id
            for output in response.agent_outputs
            for citation in output.citations
        }
        route_match = set(response.routes) == set(case.expected_domains)
        source_hit = not case.expected_sources or bool(cited_sources & set(case.expected_sources))
        decision_match = response.trust_report.decision == case.expected_decision
        unsafe = case.fault in {"no_citation", "invalid_citation"}
        safely_blocked = not unsafe or response.trust_report.decision.value == "REJECT"
        rows.append(
            {
                "case_id": case.case_id,
                "expected_decision": case.expected_decision.value,
                "actual_decision": response.trust_report.decision.value,
                "expected_domains": case.expected_domains,
                "actual_routes": response.routes,
                "decision_match": decision_match,
                "route_match": route_match,
                "source_hit": source_hit,
                "unsafe": unsafe,
                "safely_blocked": safely_blocked,
                "latency_ms": round(response.latency_ms, 3),
                "citation_validity": round(response.trust_report.citation_validity, 3),
                "support_score": round(response.trust_report.support_score, 3),
            }
        )

    latencies = [row["latency_ms"] for row in rows]
    unsafe_rows = [row for row in rows if row["unsafe"]]
    embedding_model = (
        runtime.retriever.embedder.model
        if runtime.retriever.embedder
        else "scikit-learn-tfidf-ngram-1-2"
    )
    return EvaluationSummary(
        retrieval_backend=runtime.retriever.embedding_backend,
        retrieval_mode="BM25 + vector + title + one-hop graph score fusion",
        embedding_model=embedding_model,
        corpus_documents=len(runtime.corpus.documents),
        graph_nodes=len(runtime.retriever.knowledge_graph.nodes),
        graph_edges=len(runtime.retriever.knowledge_graph.edges),
        cases=len(rows),
        decision_accuracy=sum(row["decision_match"] for row in rows) / len(rows),
        route_exact_match=sum(row["route_match"] for row in rows) / len(rows),
        source_hit_rate=sum(row["source_hit"] for row in rows) / len(rows),
        unsafe_case_block_rate=(
            sum(row["safely_blocked"] for row in unsafe_rows) / len(unsafe_rows)
            if unsafe_rows
            else 1.0
        ),
        p50_latency_ms=median(latencies),
        p95_latency_ms=float(np.percentile(latencies, 95)),
        results=rows,
    )


def write_reports(summary: EvaluationSummary) -> None:
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(summary.model_dump_json(indent=2), encoding="utf-8")
    lines = [
        f"# Evaluation Results — {summary.retrieval_backend.upper()}",
        "",
        f"- Retrieval mode: **{summary.retrieval_mode}**",
        f"- Embedding model: **{summary.embedding_model}**",
        f"- Corpus documents: **{summary.corpus_documents} synthetic documents**",
        f"- Knowledge graph: **{summary.graph_nodes} nodes / {summary.graph_edges} edges**",
        f"- Cases: **{summary.cases}**",
        f"- Decision accuracy: **{summary.decision_accuracy:.1%}**",
        f"- Route exact match: **{summary.route_exact_match:.1%}**",
        f"- Source hit rate: **{summary.source_hit_rate:.1%}**",
        f"- Unsafe-case block rate: **{summary.unsafe_case_block_rate:.1%}**",
        f"- p50 latency: **{summary.p50_latency_ms:.2f} ms**",
        f"- p95 latency: **{summary.p95_latency_ms:.2f} ms**",
        "",
        "| Case | Expected | Actual | Route | Source hit | Latency (ms) |",
        "|---|---|---|---:|---:|---:|",
    ]
    for row in summary.results:
        lines.append(
            f"| {row['case_id']} | {row['expected_decision']} | {row['actual_decision']} "
            f"| {'✓' if row['route_match'] else '✗'} | {'✓' if row['source_hit'] else '✗'} "
            f"| {row['latency_ms']:.2f} |"
        )
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    summary = evaluate()
    write_reports(summary)
    print(summary.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
