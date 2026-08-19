import { Blocks, DatabaseZap, GitFork, Network, Scale, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

const CONCEPTS = [
  {
    id: 'boundary',
    label: 'Agent boundary',
    icon: Blocks,
    question: 'Why is structured output not enough?',
    answer:
      'Model-side structured output reduces malformed responses, but it does not independently enforce policy. A deterministic Pydantic gate validates the result again at the node boundary and fails closed before aggregation.',
    implementation: 'AgentOutput.model_validate(raw_output)',
    tradeoff: 'Excellent for shape and ranges; insufficient for semantic truth by itself.',
  },
  {
    id: 'grounding',
    label: 'Citation grounding',
    icon: DatabaseZap,
    question: 'What makes a citation valid?',
    answer:
      'The system verifies both source identity and the quoted span. A citation that merely looks plausible still fails if its source ID is absent or its quote cannot be located in the indexed document.',
    implementation: 'Corpus.validate_quote(source_id, quote)',
    tradeoff: 'Exact spans are auditable, but paraphrase entailment needs an additional semantic evaluator.',
  },
  {
    id: 'graphrag',
    label: 'GraphRAG',
    icon: Network,
    question: 'Why add graph traversal to hybrid search?',
    answer:
      'Embeddings retrieve semantically similar text, but they do not explicitly model how a risk pressures margin or how inflation informs monetary policy. Entity linking and one-hop traversal recover these source-linked relationships and contribute a separate, inspectable ranking signal.',
    implementation: 'FinancialKnowledgeGraph.expand(query, domain)',
    tradeoff: 'Graphs improve relational recall and provenance, but extraction quality and entity resolution become new failure surfaces.',
  },
  {
    id: 'routing',
    label: 'Dynamic fan-out',
    icon: GitFork,
    question: 'Why use LangGraph Send?',
    answer:
      'The router creates only the branches supported by measured evidence. General workspaces fan out to keyword, semantic, and graph workers; the financial pack routes equity, macro, and ESG specialists.',
    implementation: 'Send("retrieval_agent", worker_state)',
    tradeoff: 'Parallelism reduces wall-clock latency but increases observability and merge complexity.',
  },
  {
    id: 'trust',
    label: 'Trust decision',
    icon: Scale,
    question: 'Reject or escalate?',
    answer:
      'Hard integrity failures—missing schema fields, invalid sources, incomplete citation coverage—are rejected. Structurally valid but low-confidence or weakly supported answers are escalated for human review.',
    implementation: 'ACCEPT | REJECT | ESCALATE',
    tradeoff: 'Thresholds are explainable but require calibration on representative data.',
  },
]

export function ConceptExplorer() {
  const [selectedId, setSelectedId] = useState(CONCEPTS[0].id)
  const selected = CONCEPTS.find((concept) => concept.id === selectedId) ?? CONCEPTS[0]
  const Icon = selected.icon

  return (
    <section className="section concepts-section" aria-labelledby="concepts-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Concept explorer</span>
          <h2 id="concepts-title">Principles behind the code.</h2>
        </div>
        <p>
          The system separates structural correctness, evidence validity, semantic support, and
          human judgment instead of hiding them behind one opaque score.
        </p>
      </div>
      <div className="concept-workspace">
        <div className="concept-tabs" role="tablist" aria-label="System concepts">
          {CONCEPTS.map((concept) => {
            const TabIcon = concept.icon
            return (
              <button
                key={concept.id}
                type="button"
                role="tab"
                aria-selected={selectedId === concept.id}
                onClick={() => setSelectedId(concept.id)}
              >
                <TabIcon size={17} aria-hidden="true" /> {concept.label}
              </button>
            )
          })}
        </div>
        <article className="concept-detail">
          <span className="concept-icon"><Icon size={24} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">{selected.label}</span>
            <h3>{selected.question}</h3>
            <p>{selected.answer}</p>
            <div className="concept-facts">
              <div>
                <span>Implementation</span>
                <code>{selected.implementation}</code>
              </div>
              <div>
                <span>Trade-off</span>
                <p>{selected.tradeoff}</p>
              </div>
            </div>
          </div>
        </article>
        <div className="defense-stack">
          <span className="eyebrow">Defense in depth</span>
          <ol>
            <li><strong>L1</strong><span>Router allowlist</span></li>
            <li><strong>L2</strong><span>Graph source provenance</span></li>
            <li><strong>L3</strong><span>Pydantic schema gate</span></li>
            <li><strong>L4</strong><span>Source + quote verification</span></li>
            <li><strong>L5</strong><span>Trust policy + HITL</span></li>
          </ol>
          <p><ShieldCheck size={16} /> No single model grades its own work.</p>
        </div>
      </div>
    </section>
  )
}
