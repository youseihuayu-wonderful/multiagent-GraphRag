from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from governed_rag.graph import GovernedRAG

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "frontend" / "src" / "generated"

SCENARIOS = [
    {
        "id": "grounded-equity",
        "label": "Grounded equity",
        "description": "A normal single-domain path with valid citations and an ACCEPT decision.",
        "query": "What drove Northstar cloud revenue growth and what risks could affect margin?",
        "fault": "none",
        "concepts": ["entity linking", "one-hop GraphRAG", "score fusion", "citation grounding"],
    },
    {
        "id": "cross-domain",
        "label": "Cross-domain fan-out",
        "description": "Router dispatches equity, macro, and ESG agents through LangGraph Send.",
        "query": "How could inflation and energy costs affect Northstar revenue and emissions?",
        "fault": "none",
        "concepts": ["dynamic routing", "parallel GraphRAG agents", "map-reduce aggregation"],
    },
    {
        "id": "missing-citation",
        "label": "Missing citation",
        "description": (
            "Fault injection removes citations; Pydantic rejects the output before aggregation."
        ),
        "query": "Give Northstar revenue with no supporting source.",
        "fault": "no_citation",
        "concepts": ["Pydantic min_length", "fail closed", "boundary enforcement"],
    },
    {
        "id": "fabricated-source",
        "label": "Fabricated source",
        "description": (
            "The schema passes, but runtime source validation catches a nonexistent citation ID."
        ),
        "query": "Provide the current CPI inflation result from a fabricated document.",
        "fault": "invalid_citation",
        "concepts": ["source verification", "defense in depth", "runtime rejection"],
    },
    {
        "id": "low-confidence",
        "label": "Human escalation",
        "description": (
            "Structurally valid evidence falls below policy thresholds and escalates to review."
        ),
        "query": "Assess uncertainty in the inflation and CPI outlook.",
        "fault": "low_confidence",
        "concepts": ["soft thresholds", "human in the loop", "ESCALATE policy"],
    },
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["tfidf", "ollama"], default="tfidf")
    args = parser.parse_args()

    runtime = GovernedRAG(embedding_backend=args.backend)
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "backend": args.backend,
        "retrieval_mode": "BM25 + embeddings + one-hop knowledge-graph expansion",
        "embedding_model": (
            runtime.retriever.embedder.model
            if runtime.retriever.embedder
            else "scikit-learn-tfidf-ngram-1-2"
        ),
        "scenarios": [
            {
                **scenario,
                "response": runtime.invoke(
                    scenario["query"], top_k=3, fault=scenario["fault"]
                ).model_dump(mode="json"),
            }
            for scenario in SCENARIOS
        ],
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "scenarios.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8"
    )
    graph_payload = {
        "generated_at": payload["generated_at"],
        "synthetic": True,
        "construction": (
            "Curated entity-relation extraction from the 12-document synthetic corpus"
        ),
        **runtime.retriever.knowledge_graph.export(),
    }
    (OUTPUT_DIR / "knowledge_graph.json").write_text(
        json.dumps(graph_payload, indent=2), encoding="utf-8"
    )

    evaluation_source = PROJECT_ROOT / "reports" / f"evaluation_results_{args.backend}.json"
    evaluation_target = OUTPUT_DIR / "evaluation.json"
    evaluation_target.write_text(evaluation_source.read_text(encoding="utf-8"), encoding="utf-8")
    print(
        f"Exported {len(SCENARIOS)} scenarios and "
        f"{len(graph_payload['nodes'])} graph nodes to {OUTPUT_DIR}"
    )


if __name__ == "__main__":
    main()
