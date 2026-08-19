export type Decision = 'ACCEPT' | 'REJECT' | 'ESCALATE'
export type ExecutionMode = 'deterministic' | 'hybrid' | 'llm'
export type Domain = 'equity' | 'macro' | 'esg' | 'general' | 'keyword' | 'semantic' | 'graph'

export interface KnowledgeGraphNode {
  id: string
  label: string
  type: string
  aliases: string[]
}

export interface KnowledgeGraphEdge {
  source: string
  target: string
  relation: string
  source_ids: string[]
}

export interface KnowledgeGraphBundle {
  generated_at: string
  synthetic: boolean
  construction: string
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
}

export interface GraphEntityMatch {
  id: string
  label: string
  type: string
  score: number
}

export interface GraphPath {
  source: string
  source_label: string
  relation: string
  target: string
  target_label: string
  hop: number
  score: number
  source_ids: string[]
}

export interface GraphContext {
  seed_entities: GraphEntityMatch[]
  expanded_entities: GraphEntityMatch[]
  paths: GraphPath[]
  document_boosts: Record<string, number>
}

export interface Citation {
  source_id: string
  quote: string
  relevance_score: number
}

export interface AgentOutput {
  source_agent: Domain
  answer: string
  citations: Citation[]
  confidence: number
  data_quality: number
}

export interface AuditEvent {
  stage: string
  status: 'INFO' | 'PASS' | 'FAIL' | 'WARN'
  detail: string
  timestamp: string
}

export interface TraceStep {
  step_id: string
  node: string
  title: string
  purpose: string
  status: 'PASS' | 'FAIL' | 'WARN'
  duration_ms: number
  calls: string[]
  input: Record<string, unknown>
  output: Record<string, unknown>
  checks: string[]
}

export interface TrustReport {
  decision: Decision
  routing_validity: number
  citation_coverage: number
  citation_validity: number
  support_score: number
  average_confidence: number
  average_data_quality: number
  reasons: string[]
}

export interface ExecutionMetadata {
  requested_mode: ExecutionMode
  actual_mode: 'deterministic' | 'llm'
  provider: string | null
  model: string | null
  fallback_reason: string | null
}

export interface QueryResponse {
  query: string
  retrieval_backend: string
  retrieval_mode: string
  routes: Domain[]
  answer: string | null
  agent_outputs: AgentOutput[]
  trust_report: TrustReport
  audit_trail: AuditEvent[]
  trace_steps: TraceStep[]
  errors: string[]
  latency_ms: number
  knowledge_graph?: KnowledgeGraphBundle | null
  execution?: ExecutionMetadata | null
}

export interface Scenario {
  id: string
  label: string
  description: string
  query: string
  fault: 'none' | 'no_citation' | 'invalid_citation' | 'low_confidence'
  concepts: string[]
  response: QueryResponse
}

export interface ScenarioBundle {
  generated_at: string
  backend: string
  retrieval_mode: string
  embedding_model: string
  scenarios: Scenario[]
}

export interface EvaluationResult {
  case_id: string
  expected_decision: Decision
  actual_decision: Decision
  expected_domains: Domain[]
  actual_routes: Domain[]
  decision_match: boolean
  route_match: boolean
  source_hit: boolean
  unsafe: boolean
  safely_blocked: boolean
  latency_ms: number
  citation_validity: number
  support_score: number
}

export interface EvaluationBundle {
  retrieval_backend: string
  retrieval_mode: string
  embedding_model: string
  corpus_documents: number
  graph_nodes: number
  graph_edges: number
  cases: number
  decision_accuracy: number
  route_exact_match: number
  source_hit_rate: number
  unsafe_case_block_rate: number
  p50_latency_ms: number
  p95_latency_ms: number
  results: EvaluationResult[]
}
