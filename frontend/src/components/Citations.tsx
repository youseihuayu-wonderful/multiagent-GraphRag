import { FileCheck2 } from 'lucide-react'
import type { AgentOutput } from '../types'

interface CitationsProps {
  outputs: AgentOutput[]
}

export function Citations({ outputs }: CitationsProps) {
  const citations = [...outputs.reduce((bySource, output) => {
    for (const citation of output.citations) {
      const existing = bySource.get(citation.source_id)
      if (existing) {
        existing.agents.add(output.source_agent)
        existing.relevance_score = Math.max(existing.relevance_score, citation.relevance_score)
      } else {
        bySource.set(citation.source_id, {
          ...citation,
          agents: new Set([output.source_agent]),
        })
      }
    }
    return bySource
  }, new Map<string, AgentOutput['citations'][number] & { agents: Set<AgentOutput['source_agent']> }>()).values()]

  return (
    <section className="citation-card" aria-labelledby="citations-title">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Grounding evidence</span>
          <h3 id="citations-title">Verified citations</h3>
        </div>
        <span className="event-count">{citations.length} sources</span>
      </div>
      <div className="citation-list">
        {citations.map((citation) => (
          <article key={citation.source_id}>
            <div className="citation-source">
              <FileCheck2 size={16} aria-hidden="true" />
              <strong>{citation.source_id}</strong>
              <span>{[...citation.agents].join(' · ')}</span>
            </div>
            <blockquote>{citation.quote}</blockquote>
            <div className="relevance">
              <span>Retrieval relevance</span>
              <strong>{Math.round(citation.relevance_score * 100)}%</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
