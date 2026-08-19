import { useState } from 'react'
import {
  ArrowRight,
  Bot,
  Braces,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FunctionSquare,
  GitFork,
  Link2,
  ListChecks,
  LoaderCircle,
  Merge,
  Network,
  Quote,
  Route,
  ScanSearch,
  Search,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
} from 'lucide-react'
import { AuditTrail } from './AuditTrail'
import { Citations } from './Citations'
import { GraphRagExplorer } from './GraphRagExplorer'
import { TraceInspector } from './TraceInspector'
import { TrustPanel } from './TrustPanel'
import type { KnowledgeGraphBundle, QueryResponse, TraceStep } from '../types'

export type LiveRunPhase = 'idle' | 'requesting' | 'revealing' | 'complete' | 'error'
type GraphLayer = 'entity' | 'traverse' | 'retrieve' | 'fuse' | 'cite' | 'gate'
type WorkspaceView = 'workflow' | 'graphrag' | 'trace' | 'result'

interface LiveExecutionWorkspaceProps {
  phase: Exclude<LiveRunPhase, 'idle'>
  query: string
  result: QueryResponse
  graph: KnowledgeGraphBundle
  visibleCount: number
  selectedIndex: number
  requestElapsedMs: number
  error: string | null
  onSelect: (index: number) => void
}

interface GraphLayerDefinition {
  id: GraphLayer
  label: string
  implementation: string
  explanation: string
  icon: typeof Network
}

const GRAPH_LAYERS: GraphLayerDefinition[] = [
  {
    id: 'entity',
    label: 'Entity link',
    implementation: 'KnowledgeGraph.link_entities(query)',
    explanation: 'Matches query terms and aliases to reviewed graph entities. These seed nodes define where graph retrieval begins.',
    icon: Search,
  },
  {
    id: 'traverse',
    label: 'Graph traverse',
    implementation: 'KnowledgeGraph.expand(query, route)',
    explanation: 'Expands source-linked one-hop relationships. Every traversed edge retains the document IDs that support it.',
    icon: Network,
  },
  {
    id: 'retrieve',
    label: 'Hybrid retrieve',
    implementation: 'BM25 + vector + title + graph signals',
    explanation: 'Retrieves domain-scoped documents with lexical and vector similarity while preserving each individual score.',
    icon: Database,
  },
  {
    id: 'fuse',
    label: 'Score fusion',
    implementation: '0.38 BM25 + 0.32 vector + 0.12 title + 0.18 graph',
    explanation: 'Combines independently inspectable signals. Graph context may rerank existing evidence but cannot invent a source.',
    icon: SlidersHorizontal,
  },
  {
    id: 'cite',
    label: 'Build citations',
    implementation: 'Citation(source_id, exact_quote, relevance_score)',
    explanation: 'Builds exact source-and-quote citations from retrieved documents so downstream policy can verify the evidence.',
    icon: Quote,
  },
  {
    id: 'gate',
    label: 'Schema gate',
    implementation: 'AgentOutput.model_validate(raw_output)',
    explanation: 'Fails closed when required fields, citations, domain identity, confidence, or data-quality constraints are invalid.',
    icon: ShieldCheck,
  },
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
}

function nodeExplanation(step: TraceStep) {
  if (step.node === 'router') {
    return 'The control-plane node scores domain relevance and creates only the worker branches required by this question.'
  }
  if (step.node.startsWith('agent:')) {
    return 'A domain-isolated GraphRAG worker links entities, traverses source-backed relationships, performs hybrid retrieval, builds citations, and crosses a typed boundary.'
  }
  if (step.node === 'aggregation') {
    return 'The reducer joins schema-valid worker outputs while preserving source attribution. Failed branches cannot contaminate the final answer.'
  }
  return 'The independent policy node verifies routing, citation coverage, quote validity, evidence support, confidence, and data quality before releasing output.'
}

function workflowStatus(index: number, visibleCount: number, phase: LiveExecutionWorkspaceProps['phase']) {
  if (index < visibleCount) return 'complete'
  if (phase === 'revealing' && index === visibleCount) return 'running'
  return 'pending'
}

function WorkflowNode({
  step,
  index,
  visibleCount,
  phase,
  selected,
  onSelect,
}: {
  step: TraceStep
  index: number
  visibleCount: number
  phase: LiveExecutionWorkspaceProps['phase']
  selected: boolean
  onSelect: () => void
}) {
  const status = workflowStatus(index, visibleCount, phase)
  const nodeKind = step.node === 'router' || step.node === 'llm_planner'
    ? 'control'
    : step.node.startsWith('agent:')
      ? 'retrieval'
      : step.node === 'aggregation' || step.node === 'llm_synthesizer'
        ? 'aggregation'
        : 'governance'
  const Icon = step.node === 'router' || step.node === 'llm_planner'
    ? Route
    : step.node.startsWith('agent:')
      ? Bot
      : step.node === 'aggregation' || step.node === 'llm_synthesizer'
        ? Merge
        : ShieldCheck

  return (
    <button
      type="button"
      className={`execution-node execution-node--${nodeKind} execution-node--${status} ${selected ? 'execution-node--selected' : ''}`}
      onClick={onSelect}
      disabled={status === 'pending'}
      aria-pressed={selected}
    >
      <span className="execution-node__icon">
        {status === 'complete' ? <Check size={16} /> : status === 'running' ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />}
      </span>
      <span>
        <small>{step.node.startsWith('agent:') ? step.node.replace('agent:', '').toUpperCase() : step.node}</small>
        <strong>{step.title}</strong>
      </span>
      <span className="execution-node__meta">{status === 'complete' ? `${step.duration_ms.toFixed(2)} ms` : status}</span>
    </button>
  )
}

function FlowConnector({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={active ? 'execution-connector execution-connector--active' : 'execution-connector'} aria-hidden="true">
      <span>{label}</span><ArrowRight size={17} />
    </div>
  )
}

function GraphRagPipeline({ step }: { step: TraceStep }) {
  const [selectedLayer, setSelectedLayer] = useState<GraphLayer>('entity')
  const output = step.output
  const context = asRecord(output.graph_context)
  const seeds = asRecords(context.seed_entities)
  const paths = asRecords(context.paths)
  const candidates = asRecords(output.candidates)
  const rawOutput = asRecord(output.raw_agent_output)
  const citations = asRecords(rawOutput.citations)
  const schemaGate = asRecord(output.schema_gate)
  const scoreFusion = asRecord(output.score_fusion)
  const selected = GRAPH_LAYERS.find((layer) => layer.id === selectedLayer) ?? GRAPH_LAYERS[0]
  const SelectedIcon = selected.icon

  const layerValue: Record<GraphLayer, string> = {
    entity: `${seeds.length} seeds`,
    traverse: `${paths.length} paths`,
    retrieve: `${candidates.length} candidates`,
    fuse: `${candidates.length} ranked`,
    cite: `${citations.length} citations`,
    gate: schemaGate.passed === true ? 'passed' : 'failed',
  }

  return (
    <section className="graphrag-runtime" aria-labelledby="graphrag-runtime-title">
      <div className="graphrag-runtime__heading">
        <div><Network size={17} /><span><strong id="graphrag-runtime-title">Retrieval pipeline inside this agent</strong><small>Click each layer to inspect what happened and why it exists.</small></span></div>
        <code>{String(output.retrieval_backend ?? 'hybrid')}</code>
      </div>

      <div className="graphrag-runtime__flow" role="tablist" aria-label="GraphRAG runtime layers">
        {GRAPH_LAYERS.map((layer, index) => {
          const Icon = layer.icon
          return (
            <div key={layer.id} className="graphrag-runtime__stage-wrap">
              <button type="button" role="tab" aria-selected={selectedLayer === layer.id} onClick={() => setSelectedLayer(layer.id)}>
                <Icon size={15} /><span><strong>{layer.label}</strong><small>{layerValue[layer.id]}</small></span>
              </button>
              {index < GRAPH_LAYERS.length - 1 ? <ChevronRight size={14} aria-hidden="true" /> : null}
            </div>
          )
        })}
      </div>

      <div className="graphrag-runtime__explanation">
        <span className="concept-icon"><SelectedIcon size={19} /></span>
        <div><span className="eyebrow">{selected.label} · runtime explanation</span><p>{selected.explanation}</p><code>{selected.implementation}</code></div>
      </div>

      <div className="graphrag-runtime__evidence">
        <details open={selectedLayer === 'entity'}>
          <summary><Search size={14} /> Linked entities <span>{seeds.length}</span></summary>
          <div className="runtime-chip-list">{seeds.map((seed) => <code key={String(seed.id)}>{String(seed.label)} · {Number(seed.score).toFixed(2)}</code>)}</div>
        </details>
        <details open={selectedLayer === 'traverse'}>
          <summary><Link2 size={14} /> Traversed relationships <span>{paths.length}</span></summary>
          <div className="runtime-path-list">{paths.slice(0, 6).map((path, index) => <p key={`${String(path.source)}-${index}`}><strong>{String(path.source_label)}</strong><code>{String(path.relation)}</code><strong>{String(path.target_label)}</strong><small>{Array.isArray(path.source_ids) ? path.source_ids.join(' · ') : ''}</small></p>)}</div>
        </details>
        <details open={selectedLayer === 'retrieve' || selectedLayer === 'fuse'}>
          <summary><Database size={14} /> Retrieval score breakdown <span>{candidates.length}</span></summary>
          <div className="runtime-score-table">
            <div className="runtime-score-row runtime-score-row--head"><span>Source</span><span>BM25</span><span>Vector</span><span>Graph</span><span>Combined</span></div>
            {candidates.slice(0, 5).map((candidate) => <div className="runtime-score-row" key={String(candidate.source_id)}><code>{String(candidate.source_id)}</code><span>{Number(candidate.lexical_score).toFixed(3)}</span><span>{Number(candidate.vector_score).toFixed(3)}</span><span>{Number(candidate.graph_score).toFixed(3)}</span><strong>{Number(candidate.combined_score).toFixed(3)}</strong></div>)}
          </div>
          <p className="runtime-formula">Weights: BM25 {String(scoreFusion.bm25 ?? '—')} · vector {String(scoreFusion.vector ?? '—')} · title {String(scoreFusion.title ?? '—')} · graph {String(scoreFusion.graph ?? '—')}</p>
        </details>
        <details open={selectedLayer === 'cite'}>
          <summary><Quote size={14} /> Constructed citations <span>{citations.length}</span></summary>
          <div className="runtime-citation-list">{citations.map((citation) => <blockquote key={String(citation.source_id)}><strong>{String(citation.source_id)}</strong><p>“{String(citation.quote)}”</p><small>relevance {Number(citation.relevance_score).toFixed(3)}</small></blockquote>)}</div>
        </details>
        <details open={selectedLayer === 'gate'}>
          <summary><ShieldCheck size={14} /> Agent boundary <span>{schemaGate.passed === true ? 'PASS' : 'FAIL'}</span></summary>
          <p className="runtime-gate-note">{schemaGate.passed === true ? 'The output satisfied the typed AgentOutput contract and may enter aggregation.' : 'The output failed its boundary contract and is blocked from aggregation.'}</p>
          <div className="runtime-chip-list">{Array.isArray(schemaGate.required_fields) ? schemaGate.required_fields.map((field) => <code key={String(field)}>{String(field)}</code>) : null}</div>
        </details>
      </div>
    </section>
  )
}

function StepInspector({ step }: { step: TraceStep }) {
  return (
    <div className="execution-inspector">
      <div className="execution-inspector__lead">
        <div><span className="eyebrow">Selected runtime node</span><h3>{step.title}</h3><p>{nodeExplanation(step)}</p></div>
        <span className={`trace-status trace-status--${step.status.toLowerCase()}`}>{step.status === 'FAIL' ? '!' : <Check size={14} />}</span>
      </div>

      {step.node.startsWith('agent:') ? <GraphRagPipeline key={step.step_id} step={step} /> : null}

      <div className="execution-accordions">
        <details open>
          <summary><ScanSearch size={15} /> Purpose and runtime result <span>{step.duration_ms.toFixed(2)} ms</span></summary>
          <p>{step.purpose}</p>
        </details>
        <details>
          <summary><Braces size={15} /> Exact input payload <span>JSON</span></summary>
          <pre><code>{JSON.stringify(step.input, null, 2)}</code></pre>
        </details>
        <details>
          <summary><Braces size={15} /> Exact output payload <span>JSON</span></summary>
          <pre><code>{JSON.stringify(step.output, null, 2)}</code></pre>
        </details>
        <details>
          <summary><FunctionSquare size={15} /> Functions and tools <span>{step.calls.length}</span></summary>
          <ul>{step.calls.map((call) => <li key={call}><code>{call}</code></li>)}</ul>
        </details>
        <details>
          <summary><ListChecks size={15} /> Runtime checks <span>{step.checks.length}</span></summary>
          <ul>{step.checks.map((check) => <li key={check}>{check}</li>)}</ul>
        </details>
      </div>
    </div>
  )
}

export function LiveExecutionWorkspace({
  phase,
  query,
  result,
  graph,
  visibleCount,
  selectedIndex,
  requestElapsedMs,
  error,
  onSelect,
}: LiveExecutionWorkspaceProps) {
  const [view, setView] = useState<WorkspaceView>(
    result.trust_report.decision === 'ACCEPT' ? 'workflow' : 'result',
  )

  if (phase === 'requesting') {
    return (
      <section className="execution-workspace execution-workspace--requesting" aria-live="polite">
        <div className="execution-workspace__topbar">
          <span><Clock3 size={15} /> Live workflow</span><strong><LoaderCircle className="spin" size={14} /> Requesting</strong>
        </div>
        <div className="execution-query-summary"><span>Running query</span><strong>{query}</strong></div>
        <div className="execution-requesting">
          <div><LoaderCircle className="spin" size={22} /><span><strong>Executing the governed graph</strong><p>The API is routing the question, running retrieval workers, aggregating evidence, and evaluating trust.</p></span><time>{(requestElapsedMs / 1000).toFixed(1)}s</time></div>
          <div className="execution-requesting__map" aria-hidden="true"><span className="is-active">Router</span><ArrowRight /><span>Retrieval agents</span><ArrowRight /><span>Aggregation</span><ArrowRight /><span>Trust</span></div>
        </div>
      </section>
    )
  }

  if (phase === 'error') {
    return (
      <section className="execution-workspace execution-workspace--error" aria-live="polite">
        <div className="execution-workspace__topbar"><span><Clock3 size={15} /> Live workflow</span><strong>Failed</strong></div>
        <div className="execution-query-summary"><span>Failed query</span><strong>{query}</strong></div>
        <div className="live-run__error"><strong>Live execution did not complete</strong><p>{error}</p></div>
      </section>
    )
  }

  const steps = result.trace_steps
  const planner = steps.find((step) => step.node === 'llm_planner')
  const router = steps.find((step) => step.node === 'router')
  const agents = steps.filter((step) => step.node.startsWith('agent:'))
  const aggregation = steps.find((step) => step.node === 'aggregation')
  const synthesizer = steps.find((step) => step.node === 'llm_synthesizer')
  const trust = steps.find((step) => step.node === 'trust_evaluator')
  const selectedStep = steps[Math.min(selectedIndex, Math.max(0, visibleCount - 1))] ?? steps[0]
  const stepIndex = (step: TraceStep) => steps.findIndex((candidate) => candidate.step_id === step.step_id)

  return (
    <section className={`execution-workspace execution-workspace--${phase}`} aria-live="polite">
      <div className="execution-workspace__topbar">
        <span><Clock3 size={15} /> Live workflow · actual returned trace</span>
        <div><small>{visibleCount} / {steps.length} nodes · {result.latency_ms.toFixed(1)} ms</small><strong className={`live-run__decision live-run__decision--${result.trust_report.decision.toLowerCase()}`}>{result.trust_report.decision}</strong></div>
      </div>

      <div className="execution-query-summary"><span>Completed query</span><strong>{result.query}</strong></div>
      {result.execution ? <div className={`execution-runtime-mode ${result.execution.fallback_reason ? 'has-fallback' : ''}`}><span><strong>{result.execution.actual_mode === 'llm' ? 'LLM agents executed' : 'Deterministic agents executed'}</strong><small>Requested {result.execution.requested_mode}{result.execution.model ? ` · ${result.execution.model}` : ''}</small></span>{result.execution.fallback_reason ? <p>{result.execution.fallback_reason}</p> : null}</div> : null}

      <div className="execution-view-tabs" role="tablist" aria-label="Live execution framework views">
        <button type="button" role="tab" aria-selected={view === 'workflow'} onClick={() => setView('workflow')}><GitFork size={15} /><span><strong>Workflow</strong><small>Routes and agents</small></span></button>
        <button type="button" role="tab" aria-selected={view === 'graphrag'} onClick={() => setView('graphrag')}><Network size={15} /><span><strong>GraphRAG evidence</strong><small>Graph paths and ranking</small></span></button>
        <button type="button" role="tab" aria-selected={view === 'trace'} onClick={() => setView('trace')}><Braces size={15} /><span><strong>Calls & payloads</strong><small>Every node call</small></span></button>
        <button type="button" role="tab" aria-selected={view === 'result'} onClick={() => setView('result')}><ShieldCheck size={15} /><span><strong>Result & governance</strong><small>Answer, citations, trust</small></span></button>
      </div>

      {view === 'workflow' ? (
        <div className="execution-view-panel" role="tabpanel">
          {planner && synthesizer ? <div className="execution-llm-rail"><span className="execution-llm-rail__label"><GitFork size={14} /> Model-driven control plane</span><WorkflowNode step={planner} index={stepIndex(planner)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === planner.step_id} onSelect={() => onSelect(stepIndex(planner))} /><FlowConnector active={stepIndex(router ?? planner) < visibleCount} label="plans tools" /><span className="execution-llm-rail__tools"><Braces size={15} /><strong>Governed retrieval tools</strong><small>keyword · semantic · graph</small></span><FlowConnector active={stepIndex(synthesizer) < visibleCount} label="evidence" /><WorkflowNode step={synthesizer} index={stepIndex(synthesizer)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === synthesizer.step_id} onSelect={() => onSelect(stepIndex(synthesizer))} /></div> : null}
          <div className="execution-map-legend" aria-label="Workflow color legend"><span className="is-control">Control plane</span><span className="is-retrieval">Graph retrieval</span><span className="is-aggregation">Evidence merge</span><span className="is-governance">Governance</span></div>
          <div className="execution-map" aria-label="Dynamic multi-agent workflow">
            {router ? <WorkflowNode step={router} index={stepIndex(router)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === router.step_id} onSelect={() => onSelect(stepIndex(router))} /> : null}
            <FlowConnector active={visibleCount > 0} label="Send()" />
            <div className="execution-agent-cluster">
              <div className="execution-agent-cluster__label"><GitFork size={14} /><span>Parallel retrieval workers</span><small>{agents.length} routed</small></div>
              {agents.map((step) => <WorkflowNode key={step.step_id} step={step} index={stepIndex(step)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === step.step_id} onSelect={() => onSelect(stepIndex(step))} />)}
            </div>
            <FlowConnector active={aggregation ? stepIndex(aggregation) < visibleCount : false} label="reduce" />
            {aggregation ? <WorkflowNode step={aggregation} index={stepIndex(aggregation)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === aggregation.step_id} onSelect={() => onSelect(stepIndex(aggregation))} /> : null}
            <FlowConnector active={trust ? stepIndex(trust) < visibleCount : false} label="policy" />
            {trust ? <WorkflowNode step={trust} index={stepIndex(trust)} visibleCount={visibleCount} phase={phase} selected={selectedStep?.step_id === trust.step_id} onSelect={() => onSelect(stepIndex(trust))} /> : null}
          </div>
          {selectedStep ? <StepInspector step={selectedStep} /> : null}
        </div>
      ) : null}

      {view === 'graphrag' ? (
        <div className="execution-view-panel execution-integrated-panel" role="tabpanel">
          {agents.length > 0
            ? <GraphRagExplorer graph={graph} steps={steps.slice(0, visibleCount)} />
            : <div className="execution-blocked-panel"><ShieldX size={25} /><span><strong>Graph retrieval did not run</strong><p>The corpus scope gate stopped this request before any GraphRAG worker could retrieve or rank evidence. Inspect the router payload for the exact reason.</p></span><button type="button" onClick={() => { setView('trace'); onSelect(0) }}><Braces size={15} /> Inspect scope decision</button></div>}
        </div>
      ) : null}

      {view === 'trace' ? <div className="execution-view-panel execution-integrated-panel" role="tabpanel"><TraceInspector steps={steps} selectedIndex={selectedIndex} visibleCount={visibleCount} onSelect={onSelect} /></div> : null}

      {view === 'result' ? (
        <div className="execution-view-panel execution-result-panel" role="tabpanel">
          <div className="response-grid">
            <article className="answer-card">
              <div className="card-heading"><div><span className="eyebrow">Grounded response</span><h3>Answer synthesis</h3></div><div className="response-meta"><span>{result.execution?.actual_mode ?? result.retrieval_mode}</span><span>{result.retrieval_backend}</span><span>{result.latency_ms.toFixed(1)} ms</span></div></div>
              {result.answer
                ? <p className="answer-text">{result.answer}</p>
                : <div className="blocked-answer"><ShieldX size={22} /><div><strong>No grounded answer released</strong><p>The system failed closed instead of substituting unrelated documents.</p></div></div>}
              {result.errors.length > 0 ? <div className="boundary-error"><strong>Release blocker</strong>{result.errors.map((item) => <p key={item}>{item}</p>)}</div> : null}
              <div className="route-row"><span>Approved routes</span><div>{result.routes.map((route) => <strong key={route}>{route}</strong>)}</div></div>
            </article>
            <TrustPanel report={result.trust_report} />
          </div>
          <div className="evidence-grid"><Citations outputs={result.agent_outputs} /><AuditTrail events={result.audit_trail.slice(0, visibleCount)} /></div>
        </div>
      ) : null}

      {phase === 'complete' ? <div className="execution-workspace__footer"><p>{result.trust_report.decision === 'ACCEPT' ? <Check size={15} /> : <ShieldX size={15} />} {result.trust_report.decision === 'ACCEPT' ? 'Grounded output released with its workflow, evidence, calls, citations, and governance.' : 'Output blocked: no unrelated evidence was allowed to cross the release boundary.'}</p><button type="button" onClick={() => setView('trace')}><ScanSearch size={15} /> Inspect every call</button></div> : null}
    </section>
  )
}
