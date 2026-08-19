import { Check, Clipboard, Code2, Terminal } from 'lucide-react'
import { useState } from 'react'

const EXAMPLES = {
  curl: `curl -X POST http://127.0.0.1:8000/general/query \\
  -H 'Content-Type: application/json' \\
  -d '{
    "query": "When does the Ares mission launch?",
    "documents": [{
      "title": "Mission brief",
      "text": "The Ares mission launches in September 2028 and will collect polar ice samples."
    }],
    "top_k": 3,
    "mode": "deterministic"
  }'`,
  python: `import requests

response = requests.post(
    "http://127.0.0.1:8000/general/query",
    json={
        "query": "When does the Ares mission launch?",
        "documents": [{
            "title": "Mission brief",
            "text": "The Ares mission launches in September 2028 and will collect polar ice samples.",
        }],
        "top_k": 3,
        "mode": "hybrid",  # uses provider when configured; otherwise safe fallback
    },
    timeout=30,
)
payload = response.json()
assert payload["trust_report"]["decision"] == "ACCEPT"
graph = payload["knowledge_graph"]`,
  javascript: `const response = await fetch("http://127.0.0.1:8000/general/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "When does the Ares mission launch?",
    documents: [{
      title: "Mission brief",
      text: "The Ares mission launches in September 2028 and will collect polar ice samples.",
    }],
    top_k: 3,
    mode: "hybrid", // safely falls back if the provider is unavailable
  }),
});
const { trust_report, trace_steps, knowledge_graph } = await response.json();`,
}

type ExampleKey = keyof typeof EXAMPLES

export function ApiExamples() {
  const [selected, setSelected] = useState<ExampleKey>('curl')
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    await navigator.clipboard.writeText(EXAMPLES[selected])
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className="section api-section" aria-labelledby="api-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Integration surface</span>
          <h2 id="api-title">Bring documents. Get the full trace.</h2>
        </div>
        <p>
          The general endpoint accepts request-scoped text and returns extractive evidence, trust
          metrics, citations, an ephemeral knowledge graph, and every node payload. The original
          financial endpoint remains available at <code>/query</code>.
        </p>
      </div>
      <div className="api-console">
        <div className="console-topbar">
          <div className="console-tabs" role="tablist" aria-label="API language examples">
            {(Object.keys(EXAMPLES) as ExampleKey[]).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={selected === key} onClick={() => setSelected(key)}>
                {key === 'curl' ? <Terminal size={15} /> : <Code2 size={15} />} {key}
              </button>
            ))}
          </div>
          <button className="copy-button" type="button" onClick={copyCode}>
            {copied ? <Check size={15} /> : <Clipboard size={15} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre><code>{EXAMPLES[selected]}</code></pre>
      </div>
    </section>
  )
}
