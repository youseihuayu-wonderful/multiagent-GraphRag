import { FilePlus2, FileText, LockKeyhole, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

export interface WorkspaceDocument {
  id: string
  title: string
  text: string
}

interface DocumentWorkspaceProps {
  documents: WorkspaceDocument[]
  disabled: boolean
  onChange: (documents: WorkspaceDocument[]) => void
}

const SAMPLE_DOCUMENTS: WorkspaceDocument[] = [
  {
    id: 'sample-mission',
    title: 'Ares mission brief',
    text: 'The Ares mission will launch in September 2028. Its primary objective is to collect ice samples near the Martian north pole. The mission uses the Helios lander and will operate for ninety days. Mission control will publish a science report after the first thirty days of surface operations.',
  },
  {
    id: 'sample-ocean',
    title: 'Pelagos research program',
    text: 'The Pelagos research program studies coral reef recovery. Field teams will survey water temperature, coral cover, and biodiversity across twelve protected sites during 2027. The program compares restoration sites with untreated reference reefs and publishes an open dataset after quality review.',
  },
]

const ACCEPTED_EXTENSIONS = ['txt', 'md', 'csv', 'json']
const MAX_WORKSPACE_CHARACTERS = 120_000

function createId() {
  return `document-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function DocumentWorkspace({ documents, disabled, onChange }: DocumentWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const readyDocuments = documents.filter(
    (document) => document.title.trim().length > 0 && document.text.trim().length > 0,
  )
  const incompleteDocuments = documents.length - readyDocuments.length
  const readyCharacters = readyDocuments.reduce(
    (total, document) => total + document.text.trim().length,
    0,
  )

  function updateDocument(id: string, field: 'title' | 'text', value: string) {
    onChange(documents.map((document) => (
      document.id === id ? { ...document, [field]: value } : document
    )))
  }

  function addBlankDocument() {
    if (documents.length >= 20) return
    onChange([...documents, { id: createId(), title: 'Untitled document', text: '' }])
  }

  async function importFiles(files: FileList | null) {
    if (!files) return
    setFileError(null)
    const remaining = Math.max(0, 20 - documents.length)
    const selected = [...files].slice(0, remaining)
    const imported: WorkspaceDocument[] = []
    for (const file of selected) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        setFileError('Use TXT, Markdown, CSV, or JSON files. PDF ingestion is not enabled yet.')
        continue
      }
      const text = await file.text()
      if (!text.trim()) {
        setFileError(`${file.name} is empty.`)
        continue
      }
      imported.push({
        id: createId(),
        title: file.name.replace(/\.[^.]+$/, ''),
        text: text.trim(),
      })
    }
    onChange([...documents, ...imported])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="document-workspace" aria-labelledby="document-workspace-title">
      <div className="document-workspace__header">
        <div>
          <span className="eyebrow">Request-scoped knowledge</span>
          <h3 id="document-workspace-title">Build a document workspace</h3>
          <p>Paste text or import files without a per-document size threshold. The API indexes them only for the current request and does not persist their contents.</p>
        </div>
        <div className="document-workspace__meter">
          <strong>{documents.length} / 20 sources</strong>
          <span>{readyCharacters.toLocaleString()} / 120,000 ready characters</span>
        </div>
      </div>

      <div className="document-workspace__privacy"><LockKeyhole size={15} /><span><strong>Ephemeral by design</strong> No database write. Deterministic mode stays server-side; enabled LLM modes send only retrieved excerpts to the configured provider.</span></div>

      {documents.length === 0 ? (
        <div className="document-empty">
          <FilePlus2 size={28} />
          <strong>Add the sources you want Groundline to answer from</strong>
          <p>Questions without supporting text will fail closed.</p>
          <div>
            <button type="button" onClick={() => onChange(SAMPLE_DOCUMENTS)} disabled={disabled}><Sparkles size={15} /> Load non-financial example</button>
            <button type="button" onClick={addBlankDocument} disabled={disabled}><Plus size={15} /> Paste a document</button>
          </div>
        </div>
      ) : (
        <div className="document-list">
          {documents.map((document, index) => (
            <article className="document-editor" key={document.id}>
              <div className="document-editor__heading">
                <span><FileText size={15} /> Document {index + 1}</span>
                <button type="button" aria-label={`Remove ${document.title}`} onClick={() => onChange(documents.filter((item) => item.id !== document.id))} disabled={disabled}><Trash2 size={14} /></button>
              </div>
              <label>
                <span>Source title</span>
                <input value={document.title} onChange={(event) => updateDocument(document.id, 'title', event.target.value)} maxLength={160} disabled={disabled} />
              </label>
              <label>
                <span>Document text</span>
                <textarea value={document.text} onChange={(event) => updateDocument(document.id, 'text', event.target.value)} rows={5} disabled={disabled} />
              </label>
              <small className={!document.text.trim() ? 'is-incomplete' : ''}>{document.text.trim() ? `${document.text.length.toLocaleString()} characters` : 'Add any non-empty text'}</small>
            </article>
          ))}
        </div>
      )}

      <div className="document-workspace__actions">
        <input ref={inputRef} type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" multiple hidden onChange={(event) => void importFiles(event.target.files)} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || documents.length >= 20}><Upload size={15} /> Import files</button>
        <button type="button" onClick={addBlankDocument} disabled={disabled || documents.length >= 20}><Plus size={15} /> Add document</button>
        {documents.length > 0 ? <button type="button" onClick={() => onChange([])} disabled={disabled}><Trash2 size={15} /> Clear workspace</button> : null}
      </div>
      <p className={`document-workspace__readiness ${readyDocuments.length > 0 && readyCharacters <= MAX_WORKSPACE_CHARACTERS ? 'is-ready' : ''}`} role="status">
        {readyCharacters > MAX_WORKSPACE_CHARACTERS
          ? 'Workspace exceeds the 120,000-character request budget.'
          : readyDocuments.length === 0
            ? 'Run live unlocks as soon as one document contains non-empty text.'
            : `${readyDocuments.length} source${readyDocuments.length === 1 ? '' : 's'} ready${incompleteDocuments > 0 ? ` · ${incompleteDocuments} incomplete draft${incompleteDocuments === 1 ? '' : 's'} will be excluded` : ''}.`}
      </p>
      {fileError ? <p className="document-workspace__error" role="alert">{fileError}</p> : null}
    </section>
  )
}
