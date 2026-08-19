# End-to-End Workflow

This document separates what is built before a request from what happens during a request. All corpus, graph, and evaluation data in this repository are synthetic.

## 1. Build-time workflow

```text
Synthetic disclosures
  → Pydantic document validation
  → Corpus identity index
  ├─→ BM25 lexical index
  ├─→ TF-IDF or Qwen3 embedding matrix
  └─→ Reviewed entity/relation graph
        → graph endpoint + source validation
  → compiled LangGraph runtime
  → FastAPI / CLI / evaluation / replay assets
```

### 1.1 Corpus contract

Each item in `data/documents/financial_corpus.json` must satisfy `Document`:

```python
class Document(BaseModel):
    source_id: str
    title: str
    domain: Literal["equity", "macro", "esg"]
    published_at: str
    text: str
    synthetic: bool = True
```

`Corpus` creates an O(1) identity map and rejects duplicate `source_id` values. Original document text remains available because citation verification checks whether a quoted span actually occurs in that source.

### 1.2 Text indexes

`HybridRetriever` indexes `title + text` in two complementary forms:

- **BM25:** exact term relevance with length normalization and inverse document frequency.
- **Vector:** local TF-IDF n-grams by default, or Qwen3 embeddings through Ollama.
- **Title overlap:** a separate transparent feature rather than an implicit boost.

TF-IDF keeps CI portable and API-key free. Ollama exercises the same pipeline with neural embeddings; contracts and policy do not change when the vector backend changes.

### 1.3 Knowledge-graph construction

`data/graph/financial_knowledge_graph.json` contains:

- 22 entity nodes: organizations, products, metrics, risks, ESG metrics, markets, governance bodies, macro indicators, and policy.
- 24 directed relations such as `drives`, `pressures`, `informs`, `reduces`, and `mitigates`.
- one or more `source_ids` on every edge.

Example:

```json
{
  "source": "risk:compute",
  "target": "metric:margin",
  "relation": "pressures",
  "source_ids": ["NST-10K-2025-RISK", "NST-Q1-2026-MARGIN"]
}
```

At initialization, `FinancialKnowledgeGraph` verifies:

1. every edge source exists as a node;
2. every edge target exists as a node;
3. every attached `source_id` exists in the corpus.

The graph is a reviewed extraction from the bundled synthetic corpus. The repository does **not** claim automated LLM extraction or production entity resolution.

### 1.4 Runtime compilation

`GovernedRAG._build_graph()` compiles four LangGraph node functions:

```text
START → router → retrieval_agent branches → aggregate → trust_evaluator → END
```

The apparent single `retrieval_agent` node is invoked once per selected domain through `Send`. Reducer annotations merge branch results into shared state.

## 2. Query-time multi-agent workflow

### 2.1 Shared state

```python
class OverallState(TypedDict, total=False):
    query: str
    top_k: int
    fault: str
    routes: list[Domain]
    route_scores: dict[Domain, float]
    agent_outputs: Annotated[list[dict], operator.add]
    errors: Annotated[list[str], operator.add]
    audit_trail: Annotated[list[dict], operator.add]
    trace_steps: Annotated[list[dict], operator.add]
    answer: str | None
    trust_report: dict
```

The reducers matter: parallel workers append outputs, errors, events, and traces instead of overwriting one another.

### 2.2 Router

`route_query()` tokenizes the query and scores allowlisted equity, macro, and ESG vocabularies. The node returns only known domains. `_dispatch()` converts each route to a worker state:

```python
Send(
    "retrieval_agent",
    {"query": query, "top_k": top_k, "fault": fault, "domain": domain},
)
```

A query mentioning revenue, inflation, and emissions can therefore create three independent workers. A single-domain question creates one.

### 2.3 Domain agents

Equity, Macro, and ESG workers share the same implementation but receive a fixed domain. Each worker:

1. links query terms to graph entities;
2. expands the entity neighborhood;
3. retrieves and ranks domain documents;
4. extracts the best supporting sentence from each selected document;
5. constructs a raw answer with citations, confidence, and data-quality values;
6. validates the result with `AgentOutput.model_validate()`.

Workers cannot silently change domain. They return either one valid typed output or a visible error and failed audit event.

### 2.4 Fan-in and aggregation

LangGraph waits for dispatched branches. The reducer collects all successful outputs. `aggregate` re-validates every item and joins evidence while preserving each citation. Invalid branches are never converted into free-form text or allowed into synthesis.

### 2.5 Independent trust decision

`TrustEvaluator` receives approved routes, valid outputs, boundary errors, and the original corpus. It calculates:

- routing validity;
- citation coverage;
- citation source/quote validity;
- answer-to-evidence token support;
- average agent confidence;
- average data quality.

Policy precedence:

```text
hard integrity failure → REJECT
valid structure but weak support/confidence/quality → ESCALATE
all hard and soft checks pass → ACCEPT
```

## 3. GraphRAG algorithm

### 3.1 Entity linking

Each graph node has a canonical label and aliases. Query tokens are compared against those phrases. Matches above the deterministic threshold become seed entities.

For:

```text
What drove Northstar cloud revenue growth and what risks could affect margin?
```

representative seeds include:

```text
Northstar Technologies
Cloud platform
Revenue growth
Operating margin
```

### 3.2 Organization-aware one-hop traversal

The retriever visits edges adjacent to seed entities. If the query links an organization, source IDs are scoped to that organization for domains in which linked sources exist. This prevents a generic `Revenue growth` entity from pulling Harbor evidence into a Northstar equity answer.

Each retained path records:

```text
source entity → relation → target entity
hop number
path score
supporting source IDs
```

### 3.3 Document boosts

Path scores are accumulated by attached source ID and normalized within the domain. A document receives graph relevance only because a traversed relation explicitly references that document.

The graph cannot invent a citation: graph edges point to corpus sources, and the final citation still requires an exact quote from the selected document.

### 3.4 Score fusion

The final score is:

```text
0.38 × normalized BM25
+ 0.32 × normalized vector similarity
+ 0.12 × title overlap
+ 0.18 × normalized graph relevance
```

The top-k selection is domain scoped. Every component is exported in the node trace, including the graph paths and fusion weights.

### 3.5 What this implementation is—and is not

It **is** GraphRAG because a knowledge graph is queried at runtime, graph traversal produces source-linked evidence, and the graph signal changes document ranking.

It is intentionally not presented as:

- Microsoft GraphRAG;
- automated LLM entity/relation extraction;
- community detection or global community summaries;
- unrestricted multi-hop reasoning;
- a production graph database or SEC-scale benchmark.

Those would be separate capabilities requiring their own implementation and evaluation.

## 4. Failure workflows

### Missing citation

```text
agent produces citations=[]
→ Pydantic min_length=1 fails
→ branch returns no AgentOutput
→ aggregation cannot release that branch
→ TrustEvaluator REJECT
```

### Fabricated source

```text
agent output has structurally valid citation
→ Pydantic shape passes
→ Corpus.by_id has no matching source
→ citation validity < 1
→ TrustEvaluator REJECT
```

### Low confidence

```text
schema + source + quote checks pass
→ confidence falls below behavior threshold
→ output is structurally usable but uncertain
→ TrustEvaluator ESCALATE
```

## 5. Observability workflow

Every LangGraph node emits `TraceStep`:

```text
step ID and node
purpose
PASS / FAIL / WARN
measured duration
function calls
exact input payload
exact output payload
runtime checks
```

Retrieval-agent traces additionally include:

- entity seeds and one-hop expansions;
- traversed relationships and supporting source IDs;
- per-document graph boosts;
- score-fusion weights;
- top-k BM25, vector, title, graph, and combined scores;
- raw agent output and schema-gate result.

The hosted React walkthrough replays committed traces generated by the Python runtime. It does not synthesize fake browser-only execution events.

## 6. Delivery and verification

### Local execution

```bash
uv sync --extra dev --no-editable
uv run governed-rag query "What drove Northstar cloud revenue growth?"
```

### Neural embeddings

```bash
ollama pull qwen3-embedding
uv run governed-rag query "How could inflation affect Northstar?" --embedding-backend ollama
```

### API

```bash
make serve
curl -X POST http://127.0.0.1:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"How could inflation and energy costs affect revenue and emissions?","top_k":3}'
```

### Regression and frontend assets

```bash
make lint
make test
make evaluate
make export-frontend
make frontend-build
```

CI runs Python lint, tests, and evaluation. The Pages workflow runs frontend lint/build and deploys the static walkthrough.
