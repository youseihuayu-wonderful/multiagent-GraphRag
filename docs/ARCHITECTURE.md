# Architecture and Decision Record

## Design objective

Create a minimal but real multi-agent retrieval workflow in which safety properties are executable and testable rather than descriptive.

## Graph state

The overall LangGraph state carries the query, approved routes, reducer-backed agent outputs, reducer-backed errors and audit events, aggregated answer, and final trust report. `Send` creates one worker state per selected domain. Parallel worker updates are merged before aggregation.

## Build-time artifacts

1. `financial_corpus.json` defines 12 source-stable synthetic documents.
2. `HybridRetriever` creates BM25 and vector indexes over title + text.
3. `financial_knowledge_graph.json` defines reviewed entity nodes and source-linked relation edges.
4. `FinancialKnowledgeGraph` fails initialization if an edge references an unknown node or corpus source.
5. The compiled LangGraph runtime, FastAPI service, regression suite, and frontend replay assets all consume these same artifacts.

## Query-time workflow

The router chooses an allowlisted set of domains. `Send` creates one isolated worker state per route. Each domain agent links query entities, traverses one relation hop, maps paths to corpus sources, runs BM25/vector/title retrieval, fuses all four scores, constructs extractive citations, and crosses a Pydantic boundary. Reducer-backed state joins valid branches before aggregation and independent trust evaluation.

## Execution trace

Every graph node emits a typed `TraceStep` containing its purpose, measured duration, exact input and output payloads, invoked functions, and enforced checks. Retrieval-agent traces additionally expose linked entities, graph paths, document boosts, score-fusion weights, and ranked BM25, vector, title, graph, and combined scores. The React demo replays these committed traces instead of reconstructing fictional browser-only events.

## Failure boundaries

1. **Router boundary:** only known domains can be dispatched.
2. **Graph provenance boundary:** every relation endpoint and attached source ID must exist in committed artifacts.
3. **Agent schema boundary:** Pydantic validates structure, required citations, unique source IDs, and bounded scores.
4. **Corpus boundary:** citation IDs and exact quoted text are independently verified.
5. **Trust boundary:** deterministic policy maps metrics to ACCEPT, REJECT, or ESCALATE.
6. **API boundary:** fault injection is available in test/CLI surfaces but intentionally excluded from the HTTP API.

## Decision policy

`REJECT` takes precedence when an agent fails schema validation, an unapproved agent contributes output, citation coverage is incomplete, or a citation cannot be verified. `ESCALATE` is used for structurally valid but low-confidence, low-quality, or weakly supported output. `ACCEPT` requires every hard and soft check to pass.

## Why deterministic evaluation first

A rule layer is fast, reproducible, easy to audit, and cannot hallucinate its own policy. A semantic judge can improve entailment detection, but should sit behind deterministic source and schema checks rather than replace them.

## Graph-aware retrieval

The portable baseline fuses four normalized signals: BM25 lexical relevance (38%), TF-IDF or Qwen3 cosine similarity (32%), title overlap (12%), and source-linked graph relevance (18%). Runtime graph retrieval performs deterministic query-to-entity linking, one-hop relation expansion, organization-aware source scoping, and per-document boost normalization. Domain filtering occurs before top-k selection.

This is a real, intentionally small GraphRAG implementation: graph traversal influences ranking and every path carries source provenance. It does not claim automated extraction, community summaries, multi-hop production policies, or a persistent graph database. Those are explicit extensions rather than hidden assumptions.
