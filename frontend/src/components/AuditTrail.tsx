import { Braces, Check, GitBranch, Merge, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import type { AuditEvent } from '../types'

interface AuditTrailProps {
  events: AuditEvent[]
}

function eventIcon(stage: string) {
  if (stage === 'router') return GitBranch
  if (stage.startsWith('agent:')) return Braces
  if (stage === 'aggregation') return Merge
  return ShieldCheck
}

export function AuditTrail({ events }: AuditTrailProps) {
  return (
    <section className="audit-card" aria-labelledby="audit-title">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Observability</span>
          <h3 id="audit-title">Audit trail</h3>
        </div>
        <span className="event-count">{events.length} events</span>
      </div>
      <ol className="audit-list">
        {events.map((event, index) => {
          const Icon = eventIcon(event.stage)
          const StatusIcon = event.status === 'FAIL' ? X : event.status === 'WARN' ? TriangleAlert : Check
          return (
            <li key={`${event.stage}-${event.timestamp}`}>
              <span className="audit-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <div>
                <div className="audit-meta">
                  <strong>{event.stage}</strong>
                  <span className={`audit-status audit-status--${event.status.toLowerCase()}`}>
                    <StatusIcon size={13} aria-hidden="true" /> {event.status}
                  </span>
                </div>
                <p>{event.detail}</p>
              </div>
              <span className="audit-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
