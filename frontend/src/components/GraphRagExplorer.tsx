import { ArrowRight, Database, Link2, Network, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import type {
  Domain,
  GraphContext,
  GraphPath,
  KnowledgeGraphBundle,
  TraceStep,
} from '../types'

interface GraphRagExplorerProps {
  graph: KnowledgeGraphBundle
  steps: TraceStep[]
}

function readContext(step: TraceStep): GraphContext | null {
  const candidate = step.output.graph_context
  if (!candidate || typeof candidate !== 'object') return null
  const context = candidate as Partial<GraphContext>
  if (!Array.isArray(context.seed_entities) || !Array.isArray(context.paths)) return null
  return context as GraphContext
}

const AGENT_DOMAINS: Domain[] = ['equity', 'macro', 'esg', 'keyword', 'semantic', 'graph']

function nodeIdFromStep(step: TraceStep): Domain | null {
  const domain = step.node.replace('agent:', '') as Domain
  return AGENT_DOMAINS.includes(domain) ? domain : null
}

function shortLabel(label: string) {
  return label.length > 22 ? `${label.slice(0, 20)}…` : label
}

export function GraphRagExplorer({ graph, steps }: GraphRagExplorerProps) {
  const agentContexts = steps.flatMap((step) => {
    const domain = nodeIdFromStep(step)
    const context = readContext(step)
    return domain && context ? [{ domain, context, step }] : []
  })
  const [requestedDomain, setRequestedDomain] = useState<Domain>('equity')
  const [requestedPath, setRequestedPath] = useState(0)
  const current = agentContexts.find((item) => item.domain === requestedDomain) ?? agentContexts[0]
  const context = current?.context
  const paths = context?.paths ?? []
  const pathIndex = Math.min(requestedPath, Math.max(0, paths.length - 1))
  const selectedPath = paths[pathIndex]
  const entities = context
    ? [...context.seed_entities, ...context.expanded_entities].filter(
        (entity, index, list) => list.findIndex((item) => item.id === entity.id) === index,
      )
    : []
  const positions = new Map(
    entities.map((entity, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(entities.length, 1) - Math.PI / 2
      const radiusX = entities.length < 5 ? 205 : 270
      const radiusY = entities.length < 5 ? 115 : 135
      return [entity.id, { x: 380 + Math.cos(angle) * radiusX, y: 180 + Math.sin(angle) * radiusY }]
    }),
  )
  const boosts = Object.entries(context?.document_boosts ?? {}).sort((a, b) => b[1] - a[1])
  const scoreFusion = current?.step.output.score_fusion
  const scoreFormula = scoreFusion && typeof scoreFusion === 'object'
    ? Object.entries(scoreFusion as Record<string, number>)
        .map(([signal, weight]) => `${weight.toFixed(2)} × ${signal}`)
        .join(' + ')
    : 'text + vector + graph score fusion'

  function choosePath(index: number, path: GraphPath) {
    setRequestedPath(index)
    const element = document.getElementById(`graph-node-${path.source}`)
    element?.focus()
  }

  return (
    <section className="section graph-section" id="graphrag" aria-labelledby="graphrag-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GraphRAG explorer</span>
          <h2 id="graphrag-title">See why a document moved up.</h2>
        </div>
        <p>
          Query concepts become graph seeds, source-linked relationships expand the evidence neighborhood,
          and every graph boost remains traceable to an indexed document.
        </p>
      </div>

      <div className="graph-method-strip">
        <div><span>1</span><strong>Entity link</strong><small>query → seed nodes</small></div>
        <ArrowRight size={16} />
        <div><span>2</span><strong>Traverse</strong><small>auditable one-hop edges</small></div>
        <ArrowRight size={16} />
        <div><span>3</span><strong>Map provenance</strong><small>edges → source IDs</small></div>
        <ArrowRight size={16} />
        <div><span>4</span><strong>Fuse scores</strong><small>text + vector + graph</small></div>
      </div>

      <div className="graph-toolbar">
        <div role="tablist" aria-label="GraphRAG agent context">
          {agentContexts.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.domain}
              aria-selected={current?.domain === item.domain}
              onClick={() => { setRequestedDomain(item.domain); setRequestedPath(0) }}
            >
              {item.domain === 'graph' ? 'graph agent' : `${item.domain} graph`}
            </button>
          ))}
        </div>
        <span><Network size={15} /> {graph.nodes.length} nodes · {graph.edges.length} edges · {graph.synthetic ? 'synthetic demo' : 'ephemeral workspace'}</span>
      </div>

      <div className="graph-workspace">
        <div className="graph-canvas">
          {context && entities.length > 0 ? (
            <svg viewBox="0 0 760 360" role="img" aria-labelledby="graph-viz-title graph-viz-desc">
              <title id="graph-viz-title">Graph retrieval neighborhood for the {current?.domain} agent</title>
              <desc id="graph-viz-desc">Seed and expanded concepts connected by source-linked relationships.</desc>
              {paths.map((path, index) => {
                const start = positions.get(path.source)
                const end = positions.get(path.target)
                if (!start || !end) return null
                const active = index === pathIndex
                return (
                  <g key={`${path.source}-${path.relation}-${path.target}`} className={active ? 'graph-edge graph-edge--active' : 'graph-edge'}>
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
                    {active ? <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 7}>{path.relation}</text> : null}
                  </g>
                )
              })}
              {entities.map((entity) => {
                const position = positions.get(entity.id)
                if (!position) return null
                const seed = context.seed_entities.some((item) => item.id === entity.id)
                const active = selectedPath?.source === entity.id || selectedPath?.target === entity.id
                return (
                  <g
                    id={`graph-node-${entity.id}`}
                    key={entity.id}
                    className={`graph-node ${seed ? 'graph-node--seed' : 'graph-node--expanded'} ${active ? 'graph-node--active' : ''}`}
                    transform={`translate(${position.x} ${position.y})`}
                    tabIndex={0}
                  >
                    <circle r={active ? 34 : 29} />
                    <text textAnchor="middle" y="49">{shortLabel(entity.label)}</text>
                    <title>{entity.label} · {entity.type} · score {entity.score.toFixed(2)}</title>
                  </g>
                )
              })}
            </svg>
          ) : (
            <div className="graph-empty"><ScanSearch size={28} /><strong>No linked entities</strong><span>This query falls back to text and vector retrieval.</span></div>
          )}
          <div className="graph-legend"><span><i className="graph-key graph-key--seed" /> Query seed</span><span><i className="graph-key" /> 1-hop expansion</span><span><i className="graph-key graph-key--active" /> Selected path</span></div>
        </div>

        <aside className="graph-evidence">
          <div className="graph-evidence__heading"><Link2 size={16} /><span><strong>Traversed relationships</strong><small>{current?.domain ?? 'No'} agent context</small></span></div>
          <ol>
            {paths.slice(0, 7).map((path, index) => (
              <li key={`${path.source}-${path.relation}-${path.target}`}>
                <button type="button" className={index === pathIndex ? 'graph-path--active' : ''} onClick={() => choosePath(index, path)}>
                  <span>{path.source_label}</span>
                  <code>{path.relation}</code>
                  <span>{path.target_label}</span>
                  <small>{path.source_ids.join(' · ')}</small>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <div className="graph-score-panel">
        <div>
          <span className="eyebrow">Score fusion</span>
          <code>{scoreFormula}</code>
          <p>The graph signal can rerank evidence; it cannot create a citation that is absent from the corpus.</p>
        </div>
        <div className="graph-boosts">
          <span><Database size={15} /> Source boosts from selected neighborhood</span>
          {boosts.slice(0, 5).map(([sourceId, score]) => (
            <div key={sourceId}><code>{sourceId}</code><i><b style={{ width: `${score * 100}%` }} /></i><strong>{score.toFixed(2)}</strong></div>
          ))}
        </div>
      </div>

      <p className="graph-disclosure">
        <strong>Implementation boundary:</strong> {graph.synthetic
          ? 'the bundled graph is a reviewed, source-linked extraction from the synthetic financial corpus.'
          : 'this graph was built inside the current request using deterministic concept extraction and source-linked co-occurrence; uploaded text is not persisted.'} Runtime linking and traversal are implemented; automated LLM extraction, community detection, and production-scale graph storage are not claimed.
      </p>
    </section>
  )
}
