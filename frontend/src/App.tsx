import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Code2,
  Database,
  GitFork,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Target,
  TerminalSquare,
} from 'lucide-react'
import { ApiExamples } from './components/ApiExamples'
import { BuildWorkflow } from './components/BuildWorkflow'
import { ConceptExplorer } from './components/ConceptExplorer'
import { DocumentWorkspace, type WorkspaceDocument } from './components/DocumentWorkspace'
import { LiveExecutionWorkspace, type LiveRunPhase } from './components/LiveExecutionWorkspace'
import { MultiAgentWorkflow } from './components/MultiAgentWorkflow'
import { PageNavigation } from './components/PageNavigation'
import { ScenarioLab } from './components/ScenarioLab'
import { evaluationBundle, knowledgeGraph, recordedDemo, scenarioBundle, scenarios } from './demo'
import type { ExecutionMode, QueryResponse, Scenario } from './types'

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
const LIVE_API_AVAILABLE = import.meta.env.DEV || Boolean(import.meta.env.VITE_API_URL)
const REPLAY_DELAY_MS = 520
const LIVE_TRACE_REVEAL_MS = 360
const DETERMINISTIC_API_TIMEOUT_MS = 30_000
const LLM_API_TIMEOUT_MS = 130_000

type ApiStatus = 'checking' | 'online' | 'offline' | 'recorded-only'
type WorkspaceMode = 'financial' | 'documents'

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

function App() {
  const [scenarioId, setScenarioId] = useState(scenarios[0].id)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('financial')
  const [workspaceDocuments, setWorkspaceDocuments] = useState<WorkspaceDocument[]>([])
  const [query, setQuery] = useState(recordedDemo.query)
  const [result, setResult] = useState<QueryResponse>(recordedDemo)
  const [isRecorded, setIsRecorded] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [visibleTraceCount, setVisibleTraceCount] = useState(recordedDemo.trace_steps.length)
  const [selectedTraceIndex, setSelectedTraceIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [apiStatus, setApiStatus] = useState<ApiStatus>(
    LIVE_API_AVAILABLE ? 'checking' : 'recorded-only',
  )
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('deterministic')
  const [llmAvailable, setLlmAvailable] = useState(false)
  const [llmModel, setLlmModel] = useState<string | null>(null)
  const [runPhase, setRunPhase] = useState<LiveRunPhase>('complete')
  const [requestElapsedMs, setRequestElapsedMs] = useState(0)
  const replayToken = useRef(0)
  const liveRunRef = useRef<HTMLDivElement>(null)
  const requestStartedAt = useRef(0)

  useEffect(() => {
    if (!LIVE_API_AVAILABLE) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8_000)

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check returned ${response.status}`)
        const health = await response.json() as {
          llm_available?: boolean
          llm_model?: string | null
        }
        setLlmAvailable(Boolean(health.llm_available))
        setLlmModel(health.llm_model ?? null)
        setApiStatus('online')
      })
      .catch(() => setApiStatus('offline'))
      .finally(() => window.clearTimeout(timeout))

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    if (runPhase !== 'requesting') return
    const scrollFrame = window.requestAnimationFrame(() => {
      liveRunRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const timer = window.setInterval(() => {
      setRequestElapsedMs(performance.now() - requestStartedAt.current)
    }, 100)
    return () => {
      window.cancelAnimationFrame(scrollFrame)
      window.clearInterval(timer)
    }
  }, [runPhase])

  const selectedScenario = scenarios.find((scenario) => scenario.id === scenarioId)
  const validWorkspaceDocuments = workspaceDocuments.filter(
    (document) => document.title.trim().length > 0 && document.text.trim().length > 0,
  )
  const validWorkspaceCharacters = validWorkspaceDocuments.reduce(
    (total, document) => total + document.text.trim().length,
    0,
  )
  const documentWorkspaceReady = validWorkspaceDocuments.length > 0
    && validWorkspaceCharacters <= 120_000

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery)
    if (!isLoading && nextQuery.trim() !== result.query) {
      setRunPhase('idle')
      setVisibleTraceCount(0)
      setSelectedTraceIndex(0)
      setError(null)
    }
  }

  function loadScenario(scenario: Scenario) {
    replayToken.current += 1
    setWorkspaceMode('financial')
    setScenarioId(scenario.id)
    setQuery(scenario.query)
    setResult(scenario.response)
    setIsRecorded(true)
    setIsReplaying(false)
    setVisibleTraceCount(scenario.response.trace_steps.length)
    setSelectedTraceIndex(0)
    setError(null)
    setRunPhase('complete')
  }

  function updateWorkspaceDocuments(documents: WorkspaceDocument[]) {
    setWorkspaceDocuments(documents)
    if (
      !query.trim()
      && documents.some((document) => document.id === 'sample-mission')
    ) {
      setQuery('When will the Ares mission launch and what will it collect?')
    }
    if (!isLoading) {
      setRunPhase('idle')
      setVisibleTraceCount(0)
      setSelectedTraceIndex(0)
      setError(null)
    }
  }

  function selectWorkspace(mode: WorkspaceMode) {
    if (mode === workspaceMode || isLoading) return
    if (mode === 'financial') {
      restoreDemo()
      return
    }
    replayToken.current += 1
    setWorkspaceMode('documents')
    setScenarioId('general-documents')
    setQuery('')
    setIsRecorded(false)
    setIsReplaying(false)
    setVisibleTraceCount(0)
    setSelectedTraceIndex(0)
    setError(null)
    setRunPhase('idle')
  }

  async function replayTrace() {
    const token = replayToken.current + 1
    replayToken.current = token
    setRunPhase('revealing')
    setIsReplaying(true)
    setVisibleTraceCount(0)
    setSelectedTraceIndex(0)
    for (let index = 0; index < result.trace_steps.length; index += 1) {
      await delay(REPLAY_DELAY_MS)
      if (replayToken.current !== token) return
      setVisibleTraceCount(index + 1)
      setSelectedTraceIndex(index)
    }
    setIsReplaying(false)
    setRunPhase('complete')
  }

  function moveTrace(direction: -1 | 1) {
    replayToken.current += 1
    setIsReplaying(false)
    const next = Math.min(
      result.trace_steps.length,
      Math.max(0, visibleTraceCount + direction),
    )
    setVisibleTraceCount(next)
    setSelectedTraceIndex(Math.max(0, next - 1))
  }

  async function runQuery() {
    const trimmed = query.trim()
    if (
      trimmed.length < 3
      || isLoading
      || !LIVE_API_AVAILABLE
      || (workspaceMode === 'documents' && !documentWorkspaceReady)
    ) return

    const token = replayToken.current + 1
    replayToken.current = token
    requestStartedAt.current = performance.now()
    setRequestElapsedMs(0)
    setRunPhase('requesting')
    setIsLoading(true)
    setIsReplaying(false)
    setError(null)
    const controller = new AbortController()
    const timeoutMs = workspaceMode === 'documents' && executionMode !== 'deterministic'
      ? LLM_API_TIMEOUT_MS
      : DETERMINISTIC_API_TIMEOUT_MS
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const endpoint = workspaceMode === 'documents' ? '/general/query' : '/query'
      const requestBody = workspaceMode === 'documents'
        ? {
            query: trimmed,
            top_k: 3,
            documents: validWorkspaceDocuments.map(({ title, text }) => ({
              title: title.trim(),
              text: text.trim(),
            })),
            mode: executionMode,
          }
        : { query: trimmed, top_k: 3 }
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { detail?: string } | null
        const detail = response.status === 429
          ? 'The public demo reached its rate limit. Please wait a minute and try again.'
          : failure?.detail ?? `The API returned status ${response.status}.`
        throw new Error(detail)
      }
      const payload = (await response.json()) as QueryResponse
      if (replayToken.current !== token) return

      setResult(payload)
      setScenarioId('live')
      setIsRecorded(false)
      setVisibleTraceCount(0)
      setSelectedTraceIndex(0)
      setRunPhase('revealing')
      setIsReplaying(true)

      for (let index = 0; index < payload.trace_steps.length; index += 1) {
        await delay(LIVE_TRACE_REVEAL_MS)
        if (replayToken.current !== token) return
        setVisibleTraceCount(index + 1)
        setSelectedTraceIndex(index)
      }
      setIsReplaying(false)
      setRunPhase('complete')
    } catch (requestError) {
      const timedOut = requestError instanceof DOMException && requestError.name === 'AbortError'
      const detail = timedOut
        ? 'The live request timed out.'
        : requestError instanceof Error ? requestError.message : 'Unknown network error.'
      setError(`${detail} Your workspace remains available so you can retry.`)
      setIsReplaying(false)
      setRunPhase('error')
    } finally {
      window.clearTimeout(timeout)
      setIsLoading(false)
    }
  }

  function restoreDemo() {
    loadScenario(scenarios[0])
    setVisibleTraceCount(scenarios[0].response.trace_steps.length)
  }

  function resetCurrentWorkspace() {
    if (workspaceMode === 'financial') {
      restoreDemo()
      return
    }
    replayToken.current += 1
    setQuery('')
    setRunPhase('idle')
    setVisibleTraceCount(0)
    setSelectedTraceIndex(0)
    setIsReplaying(false)
    setError(null)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Groundline home">
          <span className="brand-mark" aria-hidden="true"><ShieldCheck size={19} /></span>
          <span>Groundline</span>
        </a>
        <nav aria-label="Primary navigation">
          <div className="header-section-links">
            <a href="#playground">Try it</a>
            <a href="#scenarios">Examples</a>
            <a href="#build">Architecture</a>
          </div>
          <a className="github-link" href="https://github.com/youseihuayu-wonderful/multiagent-GraphRag" target="_blank" rel="noreferrer">
            <Code2 size={16} aria-hidden="true" /> Source
          </a>
        </nav>
      </header>

      <div className="content-layout">
        <PageNavigation />
        <main id="main-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <span className="eyebrow">Governed multi-agent RAG for any document corpus</span>
            <h1>Trust every answer your agents produce.</h1>
            <p>
              Groundline turns your documents into an ephemeral, inspectable retrieval graph. Run
              general document questions or use the built-in financial demo, then verify every
              citation, retrieval score, policy check, and trust decision.
            </p>
            <div className="objective-statement">
              <Target size={20} aria-hidden="true" />
              <div>
                <span>Objective</span>
                <strong>Make high-risk agent output inspectable before it reaches users.</strong>
              </div>
            </div>
            <div className="hero-actions">
              <a className="button button--primary" href="#playground">Run a live query <ArrowUpRight size={17} /></a>
              <a className="button button--secondary" href="https://github.com/youseihuayu-wonderful/multiagent-GraphRag#readme" target="_blank" rel="noreferrer">
                <BookOpenCheck size={17} /> Read methodology
              </a>
            </div>
          </div>

          <div className="hero-signal" aria-label="Live system status">
            <div className="signal-header">
              <span>Public demonstration</span>
              <span className={`live-dot live-dot--${apiStatus}`}>
                {apiStatus === 'online' ? 'live API' : apiStatus === 'checking' ? 'checking' : apiStatus === 'offline' ? 'API offline' : 'recorded mode'}
              </span>
            </div>
            <div className="signal-score"><strong>3</strong><span>execution modes</span></div>
            <p>Run deterministic retrieval, guarded Hybrid planning, or strict Ollama Cloud agents over request-scoped documents.</p>
            <div className="signal-grid">
              <span><Database size={15} /> Ephemeral document workspace</span>
              <span><GitFork size={15} /> {scenarioBundle.scenarios.length} examples with attached checks</span>
            </div>
            <div className="demo-disclosure"><ShieldCheck size={15} /> No account required · Cloud modes send only retrieved excerpts</div>
          </div>
        </section>

        <section className="workbench section" id="playground" aria-labelledby="playground-title">
          <div className="section-heading section-heading--compact">
            <div><span className="eyebrow">Execution controls</span><h2 id="playground-title">Run any governed document graph.</h2></div>
            <span className={`mode-badge ${isRecorded ? '' : 'mode-badge--live'}`}>{workspaceMode === 'documents' ? `General · ${executionMode} mode` : isRecorded ? `Financial · ${scenarioBundle.embedding_model} · recorded` : 'Financial · live API response'}</span>
          </div>

          <div className="workspace-switch" role="group" aria-label="Knowledge workspace">
            <button type="button" aria-pressed={workspaceMode === 'financial'} onClick={() => selectWorkspace('financial')} disabled={isLoading}><Database size={17} /><span><strong>Examples</strong><small>Recorded cases + attached evaluation</small></span></button>
            <button type="button" aria-pressed={workspaceMode === 'documents'} onClick={() => selectWorkspace('documents')} disabled={isLoading}><BookOpenCheck size={17} /><span><strong>My documents</strong><small>General request-scoped RAG</small></span></button>
          </div>

          {workspaceMode === 'financial' ? (
            <ScenarioLab
              scenarios={scenarios}
              selectedScenario={selectedScenario}
              selectedId={scenarioId}
              evaluation={evaluationBundle}
              disabled={isReplaying || isLoading}
              onSelect={loadScenario}
            />
          ) : null}

          {workspaceMode === 'documents' ? <DocumentWorkspace documents={workspaceDocuments} disabled={isLoading} onChange={updateWorkspaceDocuments} /> : null}

          {workspaceMode === 'documents' ? (
            <div className="agent-mode-selector" aria-labelledby="agent-mode-title">
              <div><span className="eyebrow">Agent runtime</span><h3 id="agent-mode-title">Choose how reasoning runs</h3></div>
              <div role="radiogroup" aria-label="Agent execution mode">
                <button type="button" role="radio" aria-checked={executionMode === 'deterministic'} onClick={() => setExecutionMode('deterministic')} disabled={isLoading}><Database size={16} /><span><strong>Deterministic</strong><small>Private · reproducible retrieval</small></span></button>
                <button type="button" role="radio" aria-checked={executionMode === 'hybrid'} onClick={() => setExecutionMode('hybrid')} disabled={isLoading || !llmAvailable}><ShieldCheck size={16} /><span><strong>Hybrid</strong><small>LLM planner + safe fallback</small></span></button>
                <button type="button" role="radio" aria-checked={executionMode === 'llm'} onClick={() => setExecutionMode('llm')} disabled={isLoading || !llmAvailable}><GitFork size={16} /><span><strong>LLM agents</strong><small>Strict model-driven workflow</small></span></button>
              </div>
              <p className={llmAvailable ? 'agent-mode-status is-ready' : 'agent-mode-status'}>{llmAvailable ? `Server provider ready · ${llmModel ?? 'configured model'} · LLM modes send retrieved excerpts to that provider.` : 'The public server has no LLM secret configured. Deterministic mode remains fully operational; configure the Vercel API project secrets to unlock Hybrid and LLM Agents.'}</p>
            </div>
          ) : null}

          <div className="query-card">
            <label htmlFor="research-query">{workspaceMode === 'documents' ? 'Question about your documents' : 'Financial research question'}</label>
            {workspaceMode === 'financial'
              ? <div className="query-scope" id="query-scope"><Database size={16} /><div><strong>Governed corpus scope</strong><p>12 synthetic documents covering <b>Northstar Technologies</b>, <b>Harbor Industrial Systems</b>, U.S. macro indicators, and ESG disclosures.</p></div></div>
              : <div className="query-scope query-scope--general" id="query-scope"><BookOpenCheck size={16} /><div><strong>General document scope</strong><p>Answers use only the text above. Keyword, semantic, and graph retrieval run against an ephemeral index; unsupported claims are blocked.</p></div></div>}
            <textarea
              id="research-query"
              value={query}
              placeholder={workspaceMode === 'documents' ? 'Ask a question grounded in the documents above…' : 'Ask about the supported financial corpus…'}
              onChange={(event) => updateQuery(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && query.trim().length >= 3 && !isLoading && LIVE_API_AVAILABLE && (workspaceMode === 'financial' || documentWorkspaceReady)) {
                  event.preventDefault()
                  void runQuery()
                }
              }}
              aria-describedby="query-scope query-shortcut"
              rows={4}
              maxLength={1000}
            />
            <div className="query-actions">
              <span id="query-shortcut">{runPhase === 'idle' ? workspaceMode === 'documents' && !documentWorkspaceReady ? 'Add any non-empty text to one document to enable Run live' : workspaceMode === 'documents' && validWorkspaceDocuments.length < workspaceDocuments.length ? `${validWorkspaceDocuments.length} ready · incomplete drafts will be excluded` : '⌘ / Ctrl + Enter to run · fail-closed retrieval' : `${visibleTraceCount} / ${result.trace_steps.length} trace steps visible`}</span>
              <button className="button button--ghost" type="button" onClick={resetCurrentWorkspace}><RotateCcw size={16} /> Reset</button>
              <button className="button button--secondary" type="button" onClick={replayTrace} disabled={isReplaying || isLoading || (workspaceMode === 'documents' && result.retrieval_mode !== 'general-document-graphrag')}>
                {isReplaying ? <><LoaderCircle className="spin" size={17} /> Replaying</> : <><Play size={17} /> Replay trace</>}
              </button>
              <button className="button button--primary" type="button" onClick={runQuery} disabled={query.trim().length < 3 || isLoading || !LIVE_API_AVAILABLE || (workspaceMode === 'documents' && !documentWorkspaceReady)} title={LIVE_API_AVAILABLE ? workspaceMode === 'documents' && !documentWorkspaceReady ? 'Add at least one valid document before running.' : undefined : 'Clone the repo and start FastAPI to run live queries.'}>
                {isLoading ? <><LoaderCircle className="spin" size={17} /> Running</> : LIVE_API_AVAILABLE ? <><Play size={17} /> Run live</> : <><TerminalSquare size={17} /> API runs locally</>}
              </button>
            </div>

            {runPhase !== 'idle' ? (
              <div ref={liveRunRef} className="live-execution-anchor">
                <LiveExecutionWorkspace
                  key={isLoading ? 'active-run' : result.query}
                  phase={runPhase}
                  query={query}
                  result={result}
                  graph={result.knowledge_graph ?? knowledgeGraph}
                  visibleCount={visibleTraceCount}
                  selectedIndex={selectedTraceIndex}
                  requestElapsedMs={requestElapsedMs}
                  error={error}
                  onSelect={setSelectedTraceIndex}
                />
              </div>
            ) : null}

            <div className="step-controls" aria-label="Trace step controls">
              <button type="button" onClick={() => moveTrace(-1)} disabled={visibleTraceCount === 0 || isReplaying}><ArrowLeft size={15} /> Previous node</button>
              <span>Step {visibleTraceCount} of {result.trace_steps.length}</span>
              <button type="button" onClick={() => moveTrace(1)} disabled={visibleTraceCount === result.trace_steps.length || isReplaying}>Next node <ArrowRight size={15} /></button>
            </div>
          </div>

        </section>

        <BuildWorkflow />
        <MultiAgentWorkflow activeRoutes={result.routes} mode={workspaceMode} />
        <div id="concepts"><ConceptExplorer /></div>
        <div id="api"><ApiExamples /></div>
        </main>
      </div>

      <footer>
        <div><span className="brand">Groundline</span><p>Governed multi-agent retrieval, built as an inspectable engineering portfolio project.</p></div>
        <a href="https://github.com/youseihuayu-wonderful/multiagent-GraphRag" target="_blank" rel="noreferrer">View repository <ArrowUpRight size={15} /></a>
      </footer>
    </div>
  )
}

export default App
