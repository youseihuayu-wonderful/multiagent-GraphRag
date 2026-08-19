import {
  Braces,
  ChartNoAxesCombined,
  Combine,
  GitBranch,
  Landmark,
  Leaf,
  ShieldCheck,
} from 'lucide-react'
import type { Domain, QueryResponse } from '../types'

interface PipelineProps {
  result: QueryResponse | null
  currentNode?: string
  completedNodes?: Set<string>
}

const AGENTS: Array<{ domain: Domain; label: string; icon: typeof Landmark }> = [
  { domain: 'equity', label: 'Equity agent', icon: ChartNoAxesCombined },
  { domain: 'macro', label: 'Macro agent', icon: Landmark },
  { domain: 'esg', label: 'ESG agent', icon: Leaf },
]

function StageCard({
  label,
  detail,
  icon: Icon,
  active,
  current = false,
}: {
  label: string
  detail: string
  icon: typeof GitBranch
  active: boolean
  current?: boolean
}) {
  return (
    <div
      className={`pipeline-node ${active ? 'pipeline-node--active' : ''} ${current ? 'pipeline-node--current' : ''}`}
    >
      <span className="pipeline-node__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </div>
  )
}

export function Pipeline({
  result,
  currentNode,
  completedNodes = new Set(),
}: PipelineProps) {
  const selected = new Set(result?.routes ?? [])
  const agentTouched = [...completedNodes].some((node) => node.startsWith('agent:'))
  const agentCurrent = currentNode?.startsWith('agent:') ?? false

  return (
    <section className="section pipeline-section" aria-labelledby="pipeline-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Runtime architecture</span>
          <h2 id="pipeline-title">Governance is part of the graph.</h2>
        </div>
        <p>
          Each selected agent links entities, traverses its domain graph, fuses graph and text
          retrieval, and crosses a typed boundary before evidence-preserving aggregation.
        </p>
      </div>

      <div className="pipeline" aria-label="Multi-agent retrieval pipeline">
        <StageCard
          label="Router"
          detail="Intent + domain dispatch"
          icon={GitBranch}
          active={completedNodes.has('router') || currentNode === 'router'}
          current={currentNode === 'router'}
        />
        <div className="pipeline-connector" aria-hidden="true" />
        <div className="agent-stack">
          {AGENTS.map(({ domain, label, icon }) => (
            <StageCard
              key={domain}
              label={label}
              detail={selected.has(domain) ? 'GraphRAG route' : 'On demand'}
              icon={icon}
              active={selected.has(domain)}
              current={currentNode === `agent:${domain}`}
            />
          ))}
        </div>
        <div className="pipeline-connector" aria-hidden="true" />
        <StageCard
          label="Schema gate"
          detail="Pydantic contracts"
          icon={Braces}
          active={agentTouched || agentCurrent}
          current={agentCurrent}
        />
        <div className="pipeline-connector" aria-hidden="true" />
        <StageCard
          label="Aggregation"
          detail="Evidence-preserving merge"
          icon={Combine}
          active={completedNodes.has('aggregation') || currentNode === 'aggregation'}
          current={currentNode === 'aggregation'}
        />
        <div className="pipeline-connector" aria-hidden="true" />
        <StageCard
          label="Trust evaluator"
          detail="Accept · reject · escalate"
          icon={ShieldCheck}
          active={
            completedNodes.has('trust_evaluator') || currentNode === 'trust_evaluator'
          }
          current={currentNode === 'trust_evaluator'}
        />
      </div>
    </section>
  )
}
