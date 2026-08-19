import { Bot, Braces, GitFork, Merge, Route, Scale } from 'lucide-react'
import { useState } from 'react'
import type { Domain } from '../types'

const FINANCIAL_AGENTS = [
  {
    id: 'router',
    label: 'Router',
    icon: Route,
    role: 'Control-plane node',
    receives: 'query',
    returns: 'routes + domain_scores',
    tools: ['tokenize', 'route_query', 'LangGraph Send'],
    contract: 'Routes must be a subset of equity | macro | esg.',
    failure: 'No keyword match falls back to equity with a low score; the choice remains visible in trace.',
  },
  {
    id: 'equity',
    label: 'Equity agent',
    icon: Bot,
    role: 'Domain worker',
    receives: 'query + top_k + equity',
    returns: 'AgentOutput<equity>',
    tools: ['BM25', 'Qwen3 embeddings', 'knowledge graph', 'citation builder'],
    contract: 'At least one unique, source-linked citation; confidence and quality in [0,1].',
    failure: 'Malformed output is rejected locally and never enters aggregation.',
  },
  {
    id: 'macro',
    label: 'Macro agent',
    icon: Bot,
    role: 'Domain worker',
    receives: 'query + top_k + macro',
    returns: 'AgentOutput<macro>',
    tools: ['BM25', 'Qwen3 embeddings', 'policy graph', 'citation builder'],
    contract: 'Same typed boundary as other workers, with domain fixed to macro.',
    failure: 'A fabricated source can pass shape validation but fails independent corpus verification.',
  },
  {
    id: 'esg',
    label: 'ESG agent',
    icon: Bot,
    role: 'Domain worker',
    receives: 'query + top_k + esg',
    returns: 'AgentOutput<esg>',
    tools: ['BM25', 'Qwen3 embeddings', 'ESG relationship graph', 'citation builder'],
    contract: 'The worker cannot emit equity or macro as its source_agent.',
    failure: 'Weak but structurally valid evidence proceeds to the trust layer for possible escalation.',
  },
  {
    id: 'reducer',
    label: 'Reducer',
    icon: Merge,
    role: 'Fan-in node',
    receives: 'Annotated agent_outputs[]',
    returns: 'evidence-preserving answer',
    tools: ['operator.add reducer', 'Pydantic re-validation', 'map-reduce merge'],
    contract: 'Only valid AgentOutput objects are aggregated; citations are never dropped.',
    failure: 'If all branches fail, answer remains null and the trust evaluator rejects.',
  },
  {
    id: 'trust',
    label: 'Trust evaluator',
    icon: Scale,
    role: 'Independent policy node',
    receives: 'routes + outputs + errors + corpus',
    returns: 'TrustReport',
    tools: ['quote verification', 'token support', 'behavior policy'],
    contract: 'One explicit decision: ACCEPT, REJECT, or ESCALATE.',
    failure: 'Hard integrity failures reject; low confidence or support escalates to human review.',
  },
] as const

const GENERAL_AGENTS = [
  {
    id: 'router', label: 'Strategy router', icon: Route, role: 'Control-plane node',
    receives: 'query + request-scoped documents', returns: 'viable retrieval strategies',
    tools: ['document chunker', 'TF-IDF index builder', 'retrieval signal gate'],
    contract: 'Only strategies with measurable evidence may be dispatched.',
    failure: 'If no uploaded source matches, retrieval stops and the answer remains null.',
  },
  {
    id: 'keyword', label: 'Keyword agent', icon: Bot, role: 'Retrieval worker',
    receives: 'query + ephemeral BM25 index', returns: 'AgentOutput<keyword>',
    tools: ['BM25', 'exact term ranking', 'citation builder'],
    contract: 'Every result carries a verbatim quote from an uploaded chunk.',
    failure: 'Weak lexical evidence prevents this branch from being routed.',
  },
  {
    id: 'semantic', label: 'Semantic agent', icon: Bot, role: 'Retrieval worker',
    receives: 'query + ephemeral TF-IDF vectors', returns: 'AgentOutput<semantic>',
    tools: ['TF-IDF n-grams', 'cosine similarity', 'citation builder'],
    contract: 'Vectors rank evidence but cannot create unsupported answer text.',
    failure: 'A zero similarity signal fails closed before aggregation.',
  },
  {
    id: 'graph', label: 'Graph agent', icon: Bot, role: 'Retrieval worker',
    receives: 'query + request-scoped concept graph', returns: 'AgentOutput<graph>',
    tools: ['concept linker', 'one-hop traversal', 'source boost'],
    contract: 'Every traversed relationship retains its uploaded source IDs.',
    failure: 'The branch is skipped when no source-linked graph path exists.',
  },
  FINANCIAL_AGENTS[4],
  FINANCIAL_AGENTS[5],
] as const

interface MultiAgentWorkflowProps {
  activeRoutes: Domain[]
  mode: 'financial' | 'documents'
}

export function MultiAgentWorkflow({ activeRoutes, mode }: MultiAgentWorkflowProps) {
  const [selectedId, setSelectedId] = useState('router')
  const agents = mode === 'documents' ? GENERAL_AGENTS : FINANCIAL_AGENTS
  const workerDomains: Domain[] = mode === 'documents'
    ? ['keyword', 'semantic', 'graph']
    : ['equity', 'macro', 'esg']
  const effectiveSelectedId = agents.some((agent) => agent.id === selectedId) ? selectedId : 'router'
  const selected = agents.find((agent) => agent.id === effectiveSelectedId) ?? agents[0]
  const Icon = selected.icon
  const active = new Set(activeRoutes)

  return (
    <section className="section agents-section" id="agents" aria-labelledby="agents-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Multi-agent choreography</span>
          <h2 id="agents-title">One state. Specialized branches.</h2>
        </div>
        <p>
          {mode === 'documents'
            ? 'The general workspace fans out across keyword, semantic, and graph evidence views. Every branch shares the same citation boundary and independent release policy.'
            : 'The bundled financial domain pack uses isolated equity, macro, and ESG branches, reducer-backed fan-in, observable failures, and one independent policy decision.'}
        </p>
      </div>

      <div className="agent-flow" aria-label="Multi-agent request workflow">
        <button type="button" className={effectiveSelectedId === 'router' ? 'agent-flow__node agent-flow__node--active' : 'agent-flow__node'} onClick={() => setSelectedId('router')}>
          <Route size={18} /><span><small>Control plane</small><strong>Router</strong></span>
        </button>
        <span className="agent-flow__connector"><GitFork size={17} /><small>Send()</small></span>
        <div className="agent-workers">
          {workerDomains.map((domain) => (
            <button
              key={domain}
              type="button"
              className={`${effectiveSelectedId === domain ? 'agent-flow__node agent-flow__node--active' : 'agent-flow__node'} ${active.has(domain) ? 'agent-flow__node--routed' : ''}`}
              onClick={() => setSelectedId(domain)}
            >
              <Bot size={17} /><span><small>{active.has(domain) ? 'Current route' : 'On demand'}</small><strong>{domain.toUpperCase()}</strong></span>
            </button>
          ))}
        </div>
        <span className="agent-flow__connector"><Merge size={17} /><small>operator.add</small></span>
        <button type="button" className={effectiveSelectedId === 'reducer' ? 'agent-flow__node agent-flow__node--active' : 'agent-flow__node'} onClick={() => setSelectedId('reducer')}>
          <Merge size={18} /><span><small>Fan-in</small><strong>Reducer</strong></span>
        </button>
        <span className="agent-flow__connector"><Scale size={17} /><small>policy</small></span>
        <button type="button" className={effectiveSelectedId === 'trust' ? 'agent-flow__node agent-flow__node--active' : 'agent-flow__node'} onClick={() => setSelectedId('trust')}>
          <Scale size={18} /><span><small>Independent</small><strong>Trust</strong></span>
        </button>
      </div>

      <div className="agent-detail">
        <div className="agent-detail__title">
          <span className="concept-icon"><Icon size={22} /></span>
          <div><span className="eyebrow">{selected.role}</span><h3>{selected.label}</h3></div>
        </div>
        <dl>
          <div><dt>Receives</dt><dd><code>{selected.receives}</code></dd></div>
          <div><dt>Returns</dt><dd><code>{selected.returns}</code></dd></div>
          <div><dt>Boundary contract</dt><dd>{selected.contract}</dd></div>
          <div><dt>Failure behavior</dt><dd>{selected.failure}</dd></div>
        </dl>
        <div className="agent-tools">
          <span><Braces size={15} /> Functions / tools</span>
          <div>{selected.tools.map((tool) => <code key={tool}>{tool}</code>)}</div>
        </div>
      </div>

      <div className="state-contract">
        <span className="eyebrow">Shared state contract</span>
        <pre><code>{`class OverallState(TypedDict):
  query: str
  routes: list[Domain]
  agent_outputs: Annotated[list, operator.add]
  errors: Annotated[list, operator.add]
  audit_trail: Annotated[list, operator.add]
  trace_steps: Annotated[list, operator.add]
  trust_report: TrustReport`}</code></pre>
      </div>
    </section>
  )
}
