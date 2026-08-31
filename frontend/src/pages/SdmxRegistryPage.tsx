import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'

interface SavedQuery {
  id: string
  url: string
  dataflow_id: string
  key_part?: string
  created_at?: string | null
  end_period_strategy?: "fixed" | "last_month_end" | "today"
  start_period_strategy?: "fixed" | "earliest" | "expand_1y" | "expand_5y"
  last_run_at?: string | null
  series_count?: number
}

interface ImportDetails {
  added: number
  updated: number
  skipped: number
  errors: number
  series_created: number
  dataflow_id?: string
  dataflow_matched?: boolean
  group_key?: string
  frequency?: string
  frequency_adjusted?: string
}

interface ImportJob {
  id: string
  status: 'ready' | 'running' | 'done' | 'error'
  result?: { details: ImportDetails } | null
  error?: string | null
}

const delay = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

async function pollImportJob(jobId: string): Promise<ImportJob> {
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await delay(3000)
    const res = await fetch(`/api/v1/indices/import-jobs/${jobId}`)
    if (!res.ok) throw new Error("Errore nel controllo dell'import")
    const job = await res.json() as ImportJob
    if (job.status === 'done') return job
    if (job.status === 'error') throw new Error(job.error || 'Errore importazione')
  }
  throw new Error('Tempo scaduto: Istat non ha risposto entro 15 minuti. Riprova.')
}

function SavedQueryModal({ query, onClose, onSaved, onDeleted }: {
  query: SavedQuery
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [url, setUrl] = useState(query.url)
  const [strategy, setStrategy] = useState<"fixed" | "last_month_end" | "today">(query.end_period_strategy || "last_month_end")
  const [startStrategy, setStartStrategy] = useState<"fixed" | "earliest" | "expand_1y" | "expand_5y">(query.start_period_strategy || "fixed")
  const [step, setStep] = useState<1 | 2>(1)
  const [understood, setUnderstood] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const parseErrorDetail = async (res: Response): Promise<string> => {
    let detail = await res.text()
    try {
      const j: unknown = JSON.parse(detail)
      if (j && typeof j === 'object' && j !== null && 'detail' in j) {
        const raw = (j as { detail?: unknown }).detail
        if (typeof raw === 'string' && raw) detail = raw
      }
    } catch { /* body non JSON */ }
    return detail || 'Errore operazione'
  }

  const handleSave = async () => {
    if (!url.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/indices/saved-queries/${encodeURIComponent(query.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), end_period_strategy: strategy, start_period_strategy: startStrategy }),
      })
      if (!res.ok) throw new Error(await parseErrorDetail(res))
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!understood || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/indices/saved-queries/${encodeURIComponent(query.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await parseErrorDetail(res))
      onDeleted()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const dangerBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: 'var(--color-text-error)',
    color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--color-overlay)', overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 480,
        maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 24px var(--color-shadow-heavy)', margin: 'auto',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, color: 'var(--color-text-primary)', flexShrink: 0, position: 'sticky', top: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingBottom: 8 } }>
          {step === 1 ? 'Query SDMX salvata' : 'Conferma eliminazione'}
        </h3>

        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Dataflow:{' '}
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-primary)' }}>{query.dataflow_id}</span>
        </p>

        {step === 1 ? (
          <>
            <textarea
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://esploradati.istat.it/SDMXWS/rest/data/…"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 12, fontFamily: 'monospace',
                border: '1px solid var(--color-border)', borderRadius: 8,
                background: 'var(--color-bg-card)', color: 'var(--color-text-primary)',
                resize: 'vertical', boxSizing: 'border-box', marginBottom: 16,
              }}
            />
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Strategia endPeriod</div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="strategy2" checked={strategy === "fixed"} onChange={() => setStrategy("fixed")} />
                <span>Fissa (usa date salvate)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="strategy2" checked={strategy === "last_month_end"} onChange={() => setStrategy("last_month_end")} />
                <span>Automatica: fine mese precedente (consigliata)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="strategy2" checked={strategy === "today"} onChange={() => setStrategy("today")} />
                <span>Automatica: oggi</span>
              </label>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Strategia startPeriod (inizio più vecchio)</div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="startStrategy" checked={startStrategy === "fixed"} onChange={() => setStartStrategy("fixed")} />
                <span>Fissa (usa date salvate)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="startStrategy" checked={startStrategy === "earliest"} onChange={() => setStartStrategy("earliest")} />
                <span>Inizio più vecchio (2000)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="startStrategy" checked={startStrategy === "expand_1y"} onChange={() => setStartStrategy("expand_1y")} />
                <span>Espandi di 1 anno</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="startStrategy" checked={startStrategy === "expand_5y"} onChange={() => setStartStrategy("expand_5y")} />
                <span>Espandi di 5 anni</span>
              </label>
            </div>
            {(() => {
              try {
                const u = new URL(url)
                const sp = u.searchParams.get("startPeriod")
                if (!sp) return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>La query non ha startPeriod: nessuna riscrittura inizio</div>
                if (startStrategy === "fixed") return null
                let preview = sp
                if (startStrategy === "earliest") {
                  if (/^\d{4}$/.test(sp)) preview = "2000"
                  else if (/^\d{4}-\d{2}$/.test(sp)) preview = "2000-01"
                  else if (/^\d{4}-\d{2}-\d{2}$/.test(sp)) preview = "2000-01-01"
                  else if (/^\d{4}-Q[1-4]$/.test(sp)) preview = "2000-Q1"
                  else preview = "2000-01-01"
                } else if (startStrategy === "expand_1y") {
                  const y = parseInt(sp.slice(0,4), 10)
                  if (!isNaN(y)) preview = `${y - 1}${sp.slice(4)}`
                } else if (startStrategy === "expand_5y") {
                  const y = parseInt(sp.slice(0,4), 10)
                  if (!isNaN(y)) preview = `${y - 5}${sp.slice(4)}`
                }
                return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>Anteprima riscrittura: startPeriod={preview} ({startStrategy})</div>
              } catch { return null }
            })()}
            {(() => {
              try {
                const u = new URL(url)
                const ep = u.searchParams.get("endPeriod")
                if (!ep) return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>La query non ha endPeriod: nessuna riscrittura</div>
                if (strategy === "fixed") return null
                const lm = new Date()
                lm.setDate(0)
                const preview = lm.toISOString().slice(0, 10)
                return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>Anteprima riscrittura: endPeriod={preview} {strategy === "today" ? "(oggi)" : "(fine mese precedente)"}</div>
              } catch { return null }
            })()}
            <div style={{ fontSize: 12, color: 'var(--color-text-warning)', marginBottom: 16, lineHeight: 1.5 }}>
              "Aggiorna" salva solo l'URL — per ri-scaricare i dati usa il pulsante ⟳ sulla riga.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            <p style={{ marginBottom: 8 }}>
              La query salvata sarà rimossa dai dati dell'indice. Le osservazioni
              già caricate <strong>restano</strong>.
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
              <span>Ho capito: la query sarà rimossa, le osservazioni caricate restano</span>
            </label>
          </div>
        )}

        {error && <div style={{ padding: '8px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, position: 'sticky', bottom: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}>Annulla</button>
          {step === 1 ? (
            <>
              <button onClick={handleSave} disabled={!url.trim() || loading} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: !url.trim() || loading ? 'var(--color-text-light)' : 'var(--color-primary)',
                color: '#fff', cursor: !url.trim() || loading ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 600,
              }}>{loading ? 'Salvataggio...' : 'Salva'}</button>
              <button onClick={() => setStep(2)} style={dangerBtn}>Elimina</button>
            </>
          ) : (
            <button onClick={handleDelete} disabled={!understood || loading} style={{
              ...dangerBtn,
              background: !understood || loading ? 'var(--color-text-light)' : 'var(--color-text-error)',
              cursor: !understood || loading ? 'not-allowed' : 'pointer',
            }}>{loading ? 'Eliminazione...' : 'Elimina query'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SdmxRegistryPage() {
  const [queries, setQueries] = useState<SavedQuery[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [runState, setRunState] = useState<{ id: string; status: 'running' | 'done' | 'error'; message?: string } | null>(null)
  const [structuredRunError, setStructuredRunError] = useState<{ unfiltered_dimensions?: Record<string, string[]>; example_url?: string } | null>(null)
  const [manageTarget, setManageTarget] = useState<SavedQuery | null>(null)

  const tryParseStructured = (text: string): { message: string; unfiltered_dimensions?: Record<string, string[]>; example_url?: string; suggestion?: string } | null => {
    try {
      const obj: unknown = JSON.parse(text)
      if (obj && typeof obj === 'object') {
        const o = obj as Record<string, unknown>
        if (typeof o.message === 'string' && o.unfiltered_dimensions && typeof o.unfiltered_dimensions === 'object') {
          return o as { message: string; unfiltered_dimensions: Record<string, string[]>; example_url?: string; suggestion?: string }
        }
        if (o.detail && typeof o.detail === 'object') {
          const d = o.detail as Record<string, unknown>
          if (typeof d.message === 'string' && d.unfiltered_dimensions) {
            return d as { message: string; unfiltered_dimensions: Record<string, string[]>; example_url?: string; suggestion?: string }
          }
        }
      }
    } catch { }
    return null
  }

  const formatStructuredMessage = (s: { message: string; unfiltered_dimensions?: Record<string, string[]>; example_url?: string }): string => {
    let msg = s.message
    if (s.unfiltered_dimensions) {
      const dims = Object.entries(s.unfiltered_dimensions).map(([k, v]) => `${k} = [${(v as string[]).join(', ')}]`).join('; ')
      msg += `\nDimensioni non filtrate: ${dims}`
    }
    if (s.example_url) msg += `\nEsempio URL filtrato: ${s.example_url}`
    return msg
  }
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/indices/saved-queries')
      .then(r => r.json())
      .then((data: SavedQuery[]) => setQueries(data))
      .catch(() => setQueries([]))
      .finally(() => setLoading(false))
  }, [reloadKey])

  const filtered = queries.filter(q => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return q.dataflow_id.toLowerCase().includes(f) || q.url.toLowerCase().includes(f) || (q.key_part || '').toLowerCase().includes(f)
  })

  const handleRun = async (q: SavedQuery) => {
    if (runState?.status === 'running' && runState.id === q.id) return
    setRunState({ id: q.id, status: 'running' })
    setStructuredRunError(null)
    try {
      const res = await fetch(`/api/v1/indices/saved-queries/${encodeURIComponent(q.id)}/run`, { method: 'POST' })
      if (!res.ok) {
        let detail = await res.text()
        try {
          const j: unknown = JSON.parse(detail)
          if (j && typeof j === 'object' && j !== null && 'detail' in j) {
            const raw = (j as { detail?: unknown }).detail
            if (typeof raw === 'string' && raw) detail = raw
          }
        } catch { /* ignore */ }
        throw new Error(detail || 'Errore')
      }
      const data = await res.json()
      const job = await pollImportJob(data.job_id)
      const d = job.result?.details
      if (!d) throw new Error('Risultato import mancante')
      let suffix = ''
      if (data && typeof data === 'object' && 'resolved_meta' in data && data.resolved_meta && typeof data.resolved_meta === 'object' && 'endPeriod' in data.resolved_meta) {
        const ep = (data.resolved_meta as { endPeriod?: unknown }).endPeriod
        if (typeof ep === 'string' && ep && data.url !== data.original_url) suffix = ` (endPeriod aggiornato a ${ep})`
      }
      setRunState({ id: q.id, status: 'done', message: `Riscaricata "${q.dataflow_id}": ${d.added} aggiunte, ${d.updated} aggiornate. ${suffix}` })
      setReloadKey(k => k + 1)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const structured = tryParseStructured(msg)
      if (structured) {
        setStructuredRunError({ unfiltered_dimensions: structured.unfiltered_dimensions, example_url: structured.example_url })
        setRunState({ id: q.id, status: 'error', message: formatStructuredMessage(structured) })
      } else {
        setRunState({ id: q.id, status: 'error', message: msg })
      }
    }
  }

  const getEndPeriod = (url: string) => {
    try { return new URL(url).searchParams.get("endPeriod") || "—" } catch { return "—" }
  }

  const strategyBadge = (s?: string) => {
    if (s === "today") return <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--color-bg-info)', color: 'var(--color-text-info)' }}>Oggi</span>
    if (s === "fixed") return <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: '#f3f4f6', color: '#6b7280' }}>Fissa</span>
    return <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: 'var(--color-bg-success)', color: 'var(--color-text-success)' }}>Fine mese prec.</span>
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Caricamento registro...</div>

  return (
    <div>
      <div style={{ background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 16, boxShadow: '0 1px 3px var(--color-shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Registro Query SDMX</h2>
          <Link to="/catalogs/istat" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-primary)', color: 'var(--color-primary)', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>Vai a Indici ISTAT</Link>
        </div>
        <input
          type="text"
          placeholder="Filtra per dataflow, key o URL…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 14, border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)' }}
        />
      </div>

      {runState && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
          background: runState.status === 'done' ? 'var(--color-bg-success)' : runState.status === 'error' ? 'var(--color-bg-error)' : 'var(--color-bg-offset)',
          color: runState.status === 'done' ? 'var(--color-text-success)' : runState.status === 'error' ? 'var(--color-text-error)' : 'var(--color-text-secondary)',
          whiteSpace: 'pre-wrap',
        }}>
          {runState.status === 'running' ? `Riscaricamento query ${runState.id} in corso — Istat può impiegare 5-10 minuti.` : runState.message}
        </div>
      )}
      {structuredRunError?.unfiltered_dimensions && runState?.status === 'error' && (
        <div style={{ padding: '10px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 12, border: '1px dashed var(--color-text-error)', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Query troppo ampia: filtri mancanti</div>
          <div style={{ marginBottom: 8, fontSize: 12 }}>
            ISTAT ha restituito dati con più valori per le dimensioni elencate. Questi dati verrebbero salvati nella stessa serie nel database, sovrascrivendosi e mescolando popolazioni diverse con la serie già presente.
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Dimensioni da filtrare (un solo valore ciascuna):</div>
          {Object.entries(structuredRunError.unfiltered_dimensions).map(([dim, vals]) => (
            <div key={dim} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{dim}</span> = [{(vals as string[]).join(', ')}]
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
            Apri il databrowser ISTAT, filtra ciascuna dimensione a un singolo valore (es. DATA_TYPE=N) e ricopia l'URL Data. Senza filtro i dati si mescolerebbero nella stessa serie esistente. Se ISTAT per quel filtro restituisce “NULL”, non c'è dato per quella combinazione.
          </div>
          {structuredRunError.example_url && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Esempio URL filtrato (verifica nel databrowser):</div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 11, background: 'var(--color-bg-card)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                {structuredRunError.example_url}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(structuredRunError.example_url || ''); }}
                style={{ marginTop: 6, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 11 }}
              >Copia URL</button>
            </div>
          )}
        </div>
      )}

      <div style={{ background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, boxShadow: '0 1px 3px var(--color-shadow)' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>
            <p style={{ marginBottom: 12 }}>Nessuna query salvata — importa una query SDMX da Indici ISTAT</p>
            <Link to="/catalogs/istat" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Vai a Indici ISTAT</Link>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Dataflow</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Key</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>endPeriod</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Strategia</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Serie collegate</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Ultimo run</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => (
                <tr key={q.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{q.dataflow_id}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.key_part || '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{getEndPeriod(q.url)}</td>
                  <td style={{ padding: '10px 12px' }}>{strategyBadge(q.end_period_strategy)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{q.series_count ?? 0}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{q.last_run_at ? new Date(q.last_run_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        title="Riscarica dati"
                        onClick={() => handleRun(q)}
                        disabled={runState?.status === 'running' && runState.id === q.id}
                        style={{
                          padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1,
                          border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
                          color: 'var(--color-text-secondary)', cursor: runState?.status === 'running' && runState.id === q.id ? 'not-allowed' : 'pointer',
                          opacity: runState?.status === 'running' && runState.id === q.id ? 0.5 : 1,
                        }}
                      >⟳ Riscarica</button>
                      <button
                        title="Gestisci query"
                        onClick={() => setManageTarget(q)}
                        style={{
                          padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1,
                          border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
                          color: 'var(--color-text-secondary)', cursor: 'pointer',
                        }}
                      >✎ Gestisci</button>
                      <a href={q.url} target="_blank" rel="noopener noreferrer" title="Apri URL" style={{ padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', textDecoration: 'none' }}>↗</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {manageTarget && (
        <SavedQueryModal
          query={manageTarget}
          onClose={() => setManageTarget(null)}
          onSaved={() => { setManageTarget(null); setReloadKey(k => k + 1) }}
          onDeleted={() => { setManageTarget(null); setReloadKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
