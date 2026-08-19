from __future__ import annotations

import argparse
import json

from governed_rag.graph import GovernedRAG


def main() -> None:
    parser = argparse.ArgumentParser(description="Governed multi-agent financial retrieval demo")
    subparsers = parser.add_subparsers(dest="command", required=True)
    query_parser = subparsers.add_parser("query", help="Run a query through the LangGraph workflow")
    query_parser.add_argument("query")
    query_parser.add_argument("--top-k", type=int, default=3)
    query_parser.add_argument(
        "--embedding-backend",
        choices=["tfidf", "ollama"],
        default="tfidf",
    )
    query_parser.add_argument(
        "--fault",
        choices=["none", "no_citation", "invalid_citation", "low_confidence"],
        default="none",
        help="Controlled fault injection for governance testing",
    )
    args = parser.parse_args()
    runtime = GovernedRAG(embedding_backend=args.embedding_backend)
    response = runtime.invoke(args.query, top_k=args.top_k, fault=args.fault)
    print(json.dumps(response.model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
