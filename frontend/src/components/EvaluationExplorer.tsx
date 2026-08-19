import { Filter } from 'lucide-react'
import { useState } from 'react'
import type { EvaluationBundle } from '../types'

interface EvaluationExplorerProps {
  evaluation: EvaluationBundle
}

type FilterKey = 'all' | 'grounded' | 'safety' | 'hitl'

export function EvaluationExplorer({ evaluation }: EvaluationExplorerProps) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const rows = evaluation.results.filter((row) => {
    if (filter === 'safety') return row.unsafe
    if (filter === 'hitl') return row.expected_decision === 'ESCALATE'
    if (filter === 'grounded') return !row.unsafe && row.expected_decision === 'ACCEPT'
    return true
  })

  return (
    <div className="evaluation-explorer">
      <div className="evaluation-toolbar">
        <span><Filter size={15} /> Case-level results</span>
        <div role="group" aria-label="Filter evaluation cases">
          {(['all', 'grounded', 'safety', 'hitl'] as FilterKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <div className="evaluation-table-wrap">
        <table>
          <thead>
            <tr><th>Case</th><th>Expected</th><th>Actual</th><th>Routes</th><th>Citation validity</th><th>Support</th><th>Latency</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.case_id}>
                <td><code>{row.case_id}</code></td>
                <td>{row.expected_decision}</td>
                <td><span className={`table-decision table-decision--${row.actual_decision.toLowerCase()}`}>{row.actual_decision}</span></td>
                <td>{row.actual_routes.join(' + ')}</td>
                <td>{Math.round(row.citation_validity * 100)}%</td>
                <td>{Math.round(row.support_score * 100)}%</td>
                <td>{row.latency_ms.toFixed(1)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="evaluation-caption">Showing {rows.length} of {evaluation.results.length} committed regression cases.</p>
    </div>
  )
}
