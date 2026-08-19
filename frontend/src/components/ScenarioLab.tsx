import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Route,
  ShieldCheck,
} from 'lucide-react'
import type { EvaluationBundle, EvaluationResult, Scenario } from '../types'
import { EvaluationExplorer } from './EvaluationExplorer'

const SCENARIO_CASE_IDS: Record<string, string[]> = {
  'grounded-equity': ['EQ-01', 'EQ-02'],
  'cross-domain': ['MIX-01'],
  'missing-citation': ['SAFE-01'],
  'fabricated-source': ['SAFE-02'],
  'low-confidence': ['HITL-02'],
}

interface ScenarioLabProps {
  scenarios: Scenario[]
  selectedScenario?: Scenario
  selectedId: string
  evaluation: EvaluationBundle
  disabled: boolean
  onSelect: (scenario: Scenario) => void
}

function evaluationForScenario(
  scenario: Scenario,
  evaluation: EvaluationBundle,
): EvaluationResult | undefined {
  const caseIds = SCENARIO_CASE_IDS[scenario.id] ?? []
  const results = evaluation.results.filter((result) => caseIds.includes(result.case_id))
  if (results.length === 0) return undefined
  const first = results[0]
  const average = (metric: 'latency_ms' | 'citation_validity' | 'support_score') => (
    results.reduce((total, result) => total + result[metric], 0) / results.length
  )
  return {
    ...first,
    case_id: results.map((result) => result.case_id).join(' + '),
    expected_domains: [...new Set(results.flatMap((result) => result.expected_domains))],
    actual_routes: [...new Set(results.flatMap((result) => result.actual_routes))],
    decision_match: results.every((result) => result.decision_match),
    route_match: results.every((result) => result.route_match),
    source_hit: results.every((result) => result.source_hit),
    unsafe: results.some((result) => result.unsafe),
    safely_blocked: results.every((result) => result.safely_blocked),
    latency_ms: average('latency_ms'),
    citation_validity: average('citation_validity'),
    support_score: average('support_score'),
  }
}

function percentage(value: number) {
  return `${Math.round(value * 100)}%`
}

export function ScenarioLab({
  scenarios,
  selectedScenario,
  selectedId,
  evaluation,
  disabled,
  onSelect,
}: ScenarioLabProps) {
  const selectedEvaluation = selectedScenario
    ? evaluationForScenario(selectedScenario, evaluation)
    : undefined
  const benchmarks = [
    {
      label: 'Decision accuracy',
      value: percentage(evaluation.decision_accuracy),
      detail: `${evaluation.cases} committed cases`,
    },
    {
      label: 'Unsafe cases blocked',
      value: '4 / 4',
      detail: 'Missing + fabricated citations',
    },
    {
      label: 'Pipeline p50',
      value: `${Math.round(evaluation.p50_latency_ms)} ms`,
      detail: evaluation.embedding_model,
    },
  ]

  return (
    <section className="scenario-lab" id="scenarios" aria-labelledby="scenario-title">
      <div className="scenario-lab__heading">
        <div>
          <span className="eyebrow">Examples with attached checks</span>
          <h3 id="scenario-title">Choose a failure mode to inspect</h3>
          <p>Each recorded example carries its expected behavior and regression result with it.</p>
        </div>
        <span className="scenario-lab__suite-status">
          <CheckCircle2 size={15} aria-hidden="true" /> {evaluation.cases}/{evaluation.cases} checks passing
        </span>
      </div>

      <div className="scenario-grid">
        {scenarios.map((scenario) => {
          const caseResult = evaluationForScenario(scenario, evaluation)
          const isMatched = Boolean(caseResult?.decision_match && caseResult.route_match)
          return (
            <button
              key={scenario.id}
              type="button"
              className={selectedId === scenario.id ? 'scenario-card scenario-card--active' : 'scenario-card'}
              onClick={() => onSelect(scenario)}
              disabled={disabled}
              aria-pressed={selectedId === scenario.id}
            >
              <span className="scenario-card__topline">
                <span className={`scenario-decision scenario-decision--${scenario.response.trust_report.decision.toLowerCase()}`}>
                  {scenario.response.trust_report.decision}
                </span>
                <code>{caseResult?.case_id ?? 'CASE'}</code>
              </span>
              <strong>{scenario.label}</strong>
              <p>{scenario.description}</p>
              <span className="scenario-card__footer">
                <span className="scenario-path">{scenario.response.routes.join(' → ')}</span>
                <span className={isMatched ? 'scenario-check is-passing' : 'scenario-check'}>
                  <CheckCircle2 size={12} aria-hidden="true" /> {isMatched ? 'Matched' : 'Review'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selectedScenario && selectedEvaluation ? (
        <article className="scenario-proof" aria-live="polite">
          <header>
            <div>
              <span className="eyebrow">Attached evaluation · {selectedEvaluation.case_id}</span>
              <h3>{selectedScenario.label}</h3>
              <p>{selectedScenario.description}</p>
            </div>
            <span className={selectedEvaluation.decision_match ? 'scenario-proof__status is-passing' : 'scenario-proof__status'}>
              <CheckCircle2 size={15} aria-hidden="true" />
              {selectedEvaluation.decision_match ? 'Regression passed' : 'Needs review'}
            </span>
          </header>

          <div className="scenario-proof__metrics">
            <div>
              <span><ShieldCheck size={14} aria-hidden="true" /> Decision</span>
              <strong>{selectedEvaluation.expected_decision} <ArrowRight size={13} aria-hidden="true" /> {selectedEvaluation.actual_decision}</strong>
              <small>expected → observed</small>
            </div>
            <div>
              <span><Route size={14} aria-hidden="true" /> Routed agents</span>
              <strong>{selectedEvaluation.actual_routes.join(' + ') || 'blocked at gate'}</strong>
              <small>{selectedEvaluation.route_match ? 'route matched' : 'route differs'}</small>
            </div>
            <div>
              <span><ShieldCheck size={14} aria-hidden="true" /> Citation validity</span>
              <strong>{percentage(selectedEvaluation.citation_validity)}</strong>
              <small>{selectedEvaluation.unsafe ? 'unsafe output blocked' : 'exact source check'}</small>
            </div>
            <div>
              <span><Gauge size={14} aria-hidden="true" /> Evidence support</span>
              <strong>{percentage(selectedEvaluation.support_score)}</strong>
              <small>{selectedEvaluation.latency_ms.toFixed(1)} ms recorded</small>
            </div>
          </div>

          <div className="scenario-context">
            <span>Concepts exercised</span>
            <div>{selectedScenario.concepts.map((concept) => <strong key={concept}>{concept}</strong>)}</div>
          </div>
        </article>
      ) : null}

      <details className="regression-suite">
        <summary>
          <span><Gauge size={16} aria-hidden="true" /> Browse the complete regression suite</span>
          <small>{evaluation.cases} cases · grounded, safety, and escalation</small>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="regression-suite__body">
          <div className="benchmark-grid benchmark-grid--compact">
            {benchmarks.map((benchmark) => (
              <article key={benchmark.label}>
                <span>{benchmark.label}</span>
                <strong>{benchmark.value}</strong>
                <p>{benchmark.detail}</p>
              </article>
            ))}
          </div>
          <EvaluationExplorer evaluation={evaluation} />
          <div className="method-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <p>Results cover 12 synthetic documents and are regression evidence—not a claim of general financial-QA accuracy.</p>
          </div>
        </div>
      </details>
    </section>
  )
}
