import {
  Boxes,
  Braces,
  Database,
  GitBranch,
  Network,
  PackageCheck,
  RadioTower,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'

const BUILD_STEPS = [
  {
    id: 'corpus',
    number: '01',
    phase: 'Build time',
    title: 'Define the corpus contract',
    icon: Braces,
    purpose: 'Turn every source into a stable, auditable document record before indexing.',
    input: 'Bundled corpus or request-scoped user text',
    output: 'Validated documents + source-stable chunks',
    implementation: [
      'Validate bundled sources or up to 20 request-scoped text documents with Pydantic.',
      'Split general documents into source-stable chunks without persisting their contents.',
      'Retain exact text so every citation quote can be verified before release.',
    ],
    code: 'Document.model_validate(item)\nCorpus.by_id[source_id] = document',
    artifact: 'Corpus | GeneralDocumentInput[]',
  },
  {
    id: 'indexes',
    number: '02',
    phase: 'Build time',
    title: 'Build lexical + vector indexes',
    icon: Database,
    purpose: 'Create complementary retrieval signals instead of depending on one embedding score.',
    input: 'title + document text',
    output: 'BM25 index + embedding matrix',
    implementation: [
      'Tokenize documents and calculate BM25 inverse document frequency.',
      'Embed the same text with Qwen3 through Ollama or local TF-IDF for deterministic CI.',
      'Keep title overlap as an independent, explainable ranking feature.',
    ],
    code: 'BM25Index(texts)\nembedder.embed(texts)\nTfidfVectorizer(ngram_range=(1, 2))',
    artifact: 'HybridRetriever.document_vectors',
  },
  {
    id: 'knowledge-graph',
    number: '03',
    phase: 'Build time',
    title: 'Construct the knowledge graph',
    icon: Network,
    purpose: 'Represent source-linked concepts and relationships that document similarity alone cannot express.',
    input: 'Validated corpus or request-scoped chunks',
    output: 'Reviewed graph or ephemeral concept graph',
    implementation: [
      'Use the reviewed financial graph for the bundled domain pack.',
      'Extract request-scoped TF-IDF concepts and co-occurrence edges for general documents.',
      'Attach every relationship to one or more source IDs and validate all endpoints.',
      'Expose which construction mode produced the graph instead of overstating extraction quality.',
    ],
    code: 'KnowledgeGraph.from_corpus(corpus)\nvalidate(edge.source, edge.target, edge.source_ids)',
    artifact: 'FinancialKnowledgeGraph | SessionKnowledgeGraph',
  },
  {
    id: 'orchestration',
    number: '04',
    phase: 'Request time',
    title: 'Route and fan out agents',
    icon: GitBranch,
    purpose: 'Run only the domain specialists needed by the question and join their results safely.',
    input: 'Query + top_k + optional fault',
    output: 'Domain or retrieval-strategy worker states',
    implementation: [
      'Financial mode routes equity, macro, and ESG domain specialists.',
      'General mode routes only viable keyword, semantic, and graph retrieval strategies.',
      'Reducer-backed state collects outputs, errors, audit events, and traces across branches.',
    ],
    code: 'Send("retrieval_agent", {"domain": domain, ...})\nAnnotated[list[dict], operator.add]',
    artifact: 'Compiled LangGraph StateGraph',
  },
  {
    id: 'graphrag',
    number: '05',
    phase: 'Request time',
    title: 'Run GraphRAG retrieval',
    icon: Boxes,
    purpose: 'Combine semantic similarity with explicit relationship traversal and source provenance.',
    input: 'Query + domain-scoped graph',
    output: 'Ranked chunks + graph paths',
    implementation: [
      'Link query terms to graph seed entities.',
      'Traverse one auditable relation hop and collect source-linked document boosts.',
      'Fuse BM25 38%, vector 32%, title 12%, and graph 18%.',
      'Generate extractive citations from the final top-k documents.',
    ],
    code: 'score = .38*bm25 + .32*vector + .12*title + .18*graph',
    artifact: 'GraphContext + RetrievedChunk[]',
  },
  {
    id: 'governance',
    number: '06',
    phase: 'Request time',
    title: 'Enforce boundaries and trust',
    icon: ShieldCheck,
    purpose: 'Stop malformed or unsupported output before it reaches a user.',
    input: 'Raw agent outputs + corpus',
    output: 'ACCEPT / REJECT / ESCALATE',
    implementation: [
      'Pydantic validates required citations, ranges, and unique IDs at every agent boundary.',
      'Aggregation accepts only schema-valid branches and preserves source attribution.',
      'TrustEvaluator independently checks source existence, exact quotes, coverage, support, and confidence.',
    ],
    code: 'AgentOutput.model_validate(raw)\nTrustEvaluator.evaluate(routes, outputs, errors)',
    artifact: 'TrustReport + AuditEvent[] + TraceStep[]',
  },
  {
    id: 'delivery',
    number: '07',
    phase: 'Delivery',
    title: 'Expose and regression-test',
    icon: RadioTower,
    purpose: 'Make the same governed graph available through CLI, API, tests, and the walkthrough.',
    input: 'Compiled runtime',
    output: 'FastAPI /query + committed replay assets',
    implementation: [
      'FastAPI validates QueryRequest and serializes the typed QueryResponse.',
      'The 20-case suite verifies routes, expected sources, decisions, unsafe blocking, and latency.',
      'GitHub Actions runs Ruff, pytest, evaluation, frontend lint, build, and Pages deployment.',
    ],
    code: 'POST /query { query, top_k }\nmake test && make evaluate && make frontend-build',
    artifact: 'Docker image + GitHub Pages artifact',
  },
] as const

export function BuildWorkflow() {
  const [selectedId, setSelectedId] = useState<string>(BUILD_STEPS[0].id)
  const selected = BUILD_STEPS.find((step) => step.id === selectedId) ?? BUILD_STEPS[0]
  const SelectedIcon = selected.icon

  return (
    <section className="section build-section" id="build" aria-labelledby="build-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Build the pipeline</span>
          <h2 id="build-title">From files to governed answers.</h2>
        </div>
        <p>
          Build-time artifacts are separated from request-time decisions. Select each stage to see
          its contract, implementation, output, and why it exists.
        </p>
      </div>

      <div className="phase-legend" aria-label="Workflow phase legend">
        <span><i className="phase-dot phase-dot--build" /> Build time</span>
        <span><i className="phase-dot phase-dot--runtime" /> Request time</span>
        <span><i className="phase-dot phase-dot--delivery" /> Delivery</span>
      </div>

      <ol className="build-rail" aria-label="Pipeline build stages">
        {BUILD_STEPS.map((step) => {
          const Icon = step.icon
          return (
            <li key={step.id}>
              <button
                type="button"
                className={selected.id === step.id ? 'build-step build-step--active' : 'build-step'}
                onClick={() => setSelectedId(step.id)}
                aria-current={selected.id === step.id ? 'step' : undefined}
              >
                <span className={`build-step__icon build-step__icon--${step.phase.toLowerCase().replace(' ', '-')}`}><Icon size={18} /></span>
                <small>{step.number} · {step.phase}</small>
                <strong>{step.title}</strong>
              </button>
            </li>
          )
        })}
      </ol>

      <article className="build-detail">
        <div className="build-detail__lead">
          <span className="concept-icon"><SelectedIcon size={23} /></span>
          <div>
            <span className="eyebrow">Stage {selected.number} · {selected.phase}</span>
            <h3>{selected.title}</h3>
            <p>{selected.purpose}</p>
          </div>
        </div>
        <div className="build-io" aria-label="Stage input and output">
          <div><span>Input</span><strong>{selected.input}</strong></div>
          <div className="build-io__arrow" aria-hidden="true">→</div>
          <div><span>Output</span><strong>{selected.output}</strong></div>
        </div>
        <div className="build-detail__body">
          <div>
            <h4>Implementation workflow</h4>
            <ol>{selected.implementation.map((item) => <li key={item}>{item}</li>)}</ol>
          </div>
          <div className="build-artifact">
            <h4><PackageCheck size={16} /> Concrete artifact</h4>
            <code>{selected.artifact}</code>
            <pre><code>{selected.code}</code></pre>
          </div>
        </div>
      </article>
    </section>
  )
}
