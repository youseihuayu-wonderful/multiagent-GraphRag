import { CheckCircle2, CircleAlert, ShieldX } from 'lucide-react'
import type { Decision, TrustReport } from '../types'

interface TrustPanelProps {
  report: TrustReport
}

const METRICS: Array<{ key: keyof TrustReport; label: string }> = [
  { key: 'routing_validity', label: 'Routing validity' },
  { key: 'citation_coverage', label: 'Citation coverage' },
  { key: 'citation_validity', label: 'Citation validity' },
  { key: 'support_score', label: 'Evidence support' },
  { key: 'average_confidence', label: 'Agent confidence' },
  { key: 'average_data_quality', label: 'Data quality' },
]

const DECISION_META: Record<
  Decision,
  { icon: typeof CheckCircle2; label: string; className: string }
> = {
  ACCEPT: { icon: CheckCircle2, label: 'Approved for output', className: 'decision--accept' },
  REJECT: { icon: ShieldX, label: 'Blocked by policy', className: 'decision--reject' },
  ESCALATE: { icon: CircleAlert, label: 'Human review required', className: 'decision--escalate' },
}

export function TrustPanel({ report }: TrustPanelProps) {
  const meta = DECISION_META[report.decision]
  const DecisionIcon = meta.icon

  return (
    <aside className="trust-panel" aria-labelledby="trust-title">
      <div className={`decision ${meta.className}`}>
        <DecisionIcon size={22} aria-hidden="true" />
        <div>
          <span id="trust-title">{report.decision}</span>
          <small>{meta.label}</small>
        </div>
      </div>

      <div className="metric-list">
        {METRICS.map(({ key, label }) => {
          const value = report[key]
          if (typeof value !== 'number') return null
          const percent = Math.round(value * 100)
          return (
            <div className="metric" key={key}>
              <div className="metric__label">
                <span>{label}</span>
                <strong>{percent}%</strong>
              </div>
              <div
                className="metric__track"
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <p className="trust-reason">{report.reasons[0]}</p>
    </aside>
  )
}
