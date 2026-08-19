import { Braces, Check, Clock3, FunctionSquare, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { TraceStep } from '../types'

interface TraceInspectorProps {
  steps: TraceStep[]
  selectedIndex: number
  visibleCount: number
  onSelect: (index: number) => void
}

type DetailTab = 'input' | 'output' | 'calls'

function asCandidates(output: Record<string, unknown>) {
  const candidates = output.candidates
  return Array.isArray(candidates) ? (candidates as Array<Record<string, unknown>>) : []
}

export function TraceInspector({
  steps,
  selectedIndex,
  visibleCount,
  onSelect,
}: TraceInspectorProps) {
  const [tab, setTab] = useState<DetailTab>('output')
  const visibleSteps = steps.slice(0, visibleCount)
  const step = visibleSteps[Math.min(selectedIndex, Math.max(0, visibleSteps.length - 1))]
  const candidates = step ? asCandidates(step.output) : []

  return (
    <section className="trace-section section" aria-labelledby="trace-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Execution microscope</span>
          <h2 id="trace-title">Inspect every call.</h2>
        </div>
        <p>
          Select a node to examine its purpose, exact input and output payloads, invoked functions,
          runtime checks, retrieval candidates, and measured duration.
        </p>
      </div>

      <div className="trace-workspace">
        <ol className="trace-nav" aria-label="Execution steps">
          {visibleSteps.map((item, index) => (
            <li key={item.step_id}>
              <button
                type="button"
                className={index === selectedIndex ? 'trace-nav__active' : ''}
                onClick={() => onSelect(index)}
              >
                <span className={`trace-status trace-status--${item.status.toLowerCase()}`}>
                  {item.status === 'FAIL' ? <X size={14} /> : <Check size={14} />}
                </span>
                <span>
                  <small>{item.node}</small>
                  <strong>{item.title}</strong>
                </span>
                <span className="trace-duration">{item.duration_ms.toFixed(2)} ms</span>
              </button>
            </li>
          ))}
          {visibleSteps.length === 0 ? (
            <li className="trace-empty">Replay a scenario to reveal node calls.</li>
          ) : null}
        </ol>

        <article className="trace-detail">
          {step ? (
            <>
              <div className="trace-detail__header">
                <div>
                  <span className="eyebrow">{step.node}</span>
                  <h3>{step.title}</h3>
                  <p>{step.purpose}</p>
                </div>
                <span className="duration-badge"><Clock3 size={14} /> {step.duration_ms.toFixed(2)} ms</span>
              </div>

              <div className="detail-tabs" role="tablist" aria-label="Trace detail">
                {(['input', 'output', 'calls'] as DetailTab[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={tab === item}
                    onClick={() => setTab(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              {tab === 'calls' ? (
                <div className="call-stack">
                  <h4><FunctionSquare size={16} /> Functions and policies</h4>
                  <ol>
                    {step.calls.map((call) => <li key={call}><code>{call}</code></li>)}
                  </ol>
                  <h4><ShieldAlert size={16} /> Runtime checks</h4>
                  <ul>
                    {step.checks.map((check) => <li key={check}>{check}</li>)}
                  </ul>
                </div>
              ) : (
                <pre className="json-view" tabIndex={0}>
                  <code>{JSON.stringify(tab === 'input' ? step.input : step.output, null, 2)}</code>
                </pre>
              )}

              {tab === 'output' && candidates.length > 0 ? (
                <div className="retrieval-table-wrap">
                  <h4><Braces size={16} /> Top-k retrieval breakdown</h4>
                  <div className="retrieval-table" role="table" aria-label="Retrieval scores">
                    <div className="retrieval-row retrieval-head" role="row">
                      <span>Rank / source</span><span>BM25</span><span>Vector</span><span>Title</span><span>Graph</span><span>Combined</span>
                    </div>
                    {candidates.map((candidate) => (
                      <div className="retrieval-row" role="row" key={String(candidate.source_id)}>
                        <span><strong>#{String(candidate.rank)}</strong> {String(candidate.source_id)}</span>
                        <span>{Number(candidate.lexical_score).toFixed(3)}</span>
                        <span>{Number(candidate.vector_score).toFixed(3)}</span>
                        <span>{Number(candidate.title_score).toFixed(3)}</span>
                        <span>{Number(candidate.graph_score).toFixed(3)}</span>
                        <span>{Number(candidate.combined_score).toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="trace-placeholder">
              <Braces size={28} aria-hidden="true" />
              <h3>No node selected</h3>
              <p>Choose a scenario and replay the execution trace.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
