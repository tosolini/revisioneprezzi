import React, { useEffect, useRef, useState } from 'react'

interface Group {
  key: string
  series_count: number
  observation_count: number
}

interface Observation {
  period: string
  value: number
  is_definitive: boolean
}

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

interface Series {
  id: string
  name: string
  frequency: string
  normative_category: string
  observation_count: number
  observations: Observation[]
  saved_query?: SavedQuery | null
}

interface SearchHit {
  id: string
  name: string
  source: string
  normative_category: string | null
  classification_ref: string | null
  frequency: string
  saved_query?: SavedQuery | null
}

const GROUP_LABELS: Record<string, string> = {
  ps_business: 'Prezzi produzione servizi (BtoB)',
  tol: 'Tipologie Omogenee Lavorazioni (TOL)',
  construction_cost_residential: 'Costo costruzione - Fabbricato residenziale',
  construction_cost_tunnel: 'Costo costruzione - Tronco stradale con galleria',
  nic: 'Prezzi al consumo (NIC)',
  ppi: 'Prezzi alla produzione industria (PPI)',
  wages: 'Retribuzioni contrattuali orarie',
  wages_ateco: 'Retribuzioni orarie per settore ATECO',
}

const PINNED = ['tol', 'ps_business']
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
    if (!res.ok) throw new Error('Errore nel controllo dell\'import')
    const job = (await res.json()) as ImportJob
    if (job.status === 'done') return job
    if (job.status === 'error') throw new Error(job.error || 'Errore importazione')
  }
  throw new Error('Tempo scaduto: Istat non ha risposto entro 15 minuti. Riprova.')
}

function formatPeriod(period: string, freq: string): string {
  if (freq === 'monthly') {
    const d = period.slice(0, 7)
    const months = ['', 'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
    const m = parseInt(d.slice(5, 7))
    return `${months[m]} ${d.slice(0, 4)}`
  }
  if (freq === 'quarterly') {
    const y = period.slice(0, 4)
    const q = Math.ceil(parseInt(period.slice(5, 6)) / 3)
    return `T${q} ${y}`
  }
  if (freq === 'annual') return period.slice(0, 4)
  return period
}

const GROUP_OPTIONS = [
  { value: 'ppi', label: 'Prezzi alla produzione industria (PPI)' },
  { value: 'ps_business', label: 'Prezzi produzione servizi (BtoB)' },
  { value: 'tol', label: 'Tipologie Omogenee Lavorazioni (TOL)' },
  { value: 'construction_cost_residential', label: 'Costo costruzione - Fabbricato residenziale' },
  { value: 'construction_cost_tunnel', label: 'Costo costruzione - Tronco stradale con galleria' },
  { value: 'nic', label: 'Prezzi al consumo (NIC)' },
  { value: 'nic_ecoicop2', label: 'NIC - tutte le basi (Ecoicop 2)' },
  { value: 'wages', label: 'Retribuzioni contrattuali orarie' },
  { value: 'wages_ateco', label: 'Retribuzioni orarie per settore ATECO' },
]

const FREQ_OPTIONS = [
  { value: 'monthly', label: 'Mensile' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'annual', label: 'Annuale' },
]

function SdmxChip({ query }: { query: SavedQuery }) {
  const strat = query.end_period_strategy || "last_month_end"
  const badge = strat === "last_month_end" ? { label: "◷", title: "Auto: fine mese precedente", bg: "var(--color-bg-success)", color: "var(--color-text-success)" }
    : strat === "today" ? { label: "◷", title: "Auto: oggi", bg: "var(--color-bg-info)", color: "var(--color-text-info)" }
    : null
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 6, verticalAlign: 'middle' }}>
      <span
        title={query.dataflow_id}
        style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
          background: 'var(--color-bg-info)', color: 'var(--color-text-info)',
          whiteSpace: 'nowrap',
        }}
      >SDMX</span>
      {badge && (
        <span
          title={badge.title}
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
            background: badge.bg, color: badge.color, whiteSpace: 'nowrap',
          }}
        >{badge.label}</span>
      )}
    </span>
  )
}

function QueryActions({ query, running, onRun, onManage }: {
  query: SavedQuery
  running: boolean
  onRun: (q: SavedQuery) => void
  onManage: (q: SavedQuery) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <button
        title="Riscarica dati"
        onClick={e => { e.stopPropagation(); onRun(query) }}
        disabled={running}
        style={{
          padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1,
          border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
          color: 'var(--color-text-secondary)', cursor: running ? 'not-allowed' : 'pointer',
          opacity: running ? 0.5 : 1,
        }}
      >⟳</button>
      <button
        title="Aggiorna o elimina query"
        onClick={e => { e.stopPropagation(); onManage(query) }}
        style={{
          padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1,
          border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
          color: 'var(--color-text-secondary)', cursor: 'pointer',
        }}
      >✎</button>
    </div>
  )
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [groupKey, setGroupKey] = useState('ppi')
  const [freq, setFreq] = useState('monthly')

  const handleUpload = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const params = new URLSearchParams({ group_key: groupKey, freq_param: freq })
      const res = await fetch(`/api/v1/indices/import-csv?${params}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Errore importazione')
      }
      const data = await res.json()
      const d = data.details
      setResult(`✓ Importato: ${d.added} aggiunte, ${d.updated} aggiornate, ${d.skipped} saltate, ${d.errors} errori. ${d.series_created} nuove serie create.`)
      onImported()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--color-overlay)', overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 460,
        maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 24px var(--color-shadow-heavy)', margin: 'auto',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, color: 'var(--color-text-primary)', flexShrink: 0, position: 'sticky', top: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingBottom: 8 } }>Importa CSV ISTAT</h3>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 12 }}>
            Scarica il file CSV{' '}
            <a
              href="https://www.istat.it/notizia/il-nuovo-codice-dei-contratti-pubblici-d-lgs-31-marzo-2023-n-36-art-60/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
            >
              dal Portale ISTAT
            </a>
            .
          </p>
          <p style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>Se il CSV contiene la colonna DATAFLOW la configurazione viene rilevata automaticamente.</p>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Tipo dati</label>
            <select value={groupKey} onChange={e => setGroupKey(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
              {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Frequenza</label>
            <select value={freq} onChange={e => setFreq(e.target.value)} style={{ padding: '8px 10px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <input ref={inputRef} type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 16, color: 'var(--color-text-primary)' }} />
        {file && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
        {error && <div style={{ padding: '8px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{error}</div>}
        {result && <div style={{ padding: '8px 12px', background: 'var(--color-bg-success)', color: 'var(--color-text-success)', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{result}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, position: 'sticky', bottom: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}>Chiudi</button>
          <button onClick={handleUpload} disabled={!file || loading} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !file || loading ? 'var(--color-text-light)' : 'var(--color-primary)', color: '#fff', cursor: !file || loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>{loading ? 'Importazione...' : 'Importa CSV'}</button>
        </div>
      </div>
    </div>
  )
}

function SdmxModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [url, setUrl] = useState('')
  const [strategy, setStrategy] = useState<"fixed" | "last_month_end" | "today">("last_month_end")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const FREQ_LABELS: Record<string, string> = {
    monthly: 'mensile',
    quarterly: 'trimestrale',
    annual: 'annuale',
  }

  const parseErrorDetail = async (res: Response): Promise<string> => {
    let detail = await res.text()
    try {
      const j: unknown = JSON.parse(detail)
      if (j && typeof j === 'object' && 'detail' in j) {
        const raw = (j as { detail?: unknown }).detail
        if (typeof raw === 'string' && raw) detail = raw
      }
    } catch { /* body non JSON: usa il testo grezzo */ }
    return detail || 'Errore importazione'
  }

  const showResult = (job: ImportJob) => {
    const d = job.result?.details
    if (!d) throw new Error('Risultato import mancante')
    const detected = d.dataflow_matched
      ? ` Dataflow rilevato: ${d.dataflow_id}.`
      : ` Dataflow non in configurazione: importato come "${d.group_key}" (${d.frequency ? FREQ_LABELS[d.frequency] || d.frequency : ''}).`
    const adjusted = d.frequency_adjusted ? ` Frequenza corretta: ${d.frequency_adjusted}.` : ''
    setResult(`✓ Importato: ${d.added} aggiunte, ${d.updated} aggiornate, ${d.skipped} saltate, ${d.errors} errori. ${d.series_created} nuove serie create.${detected}${adjusted}`)
    onImported()
  }

  const handleImport = async () => {
    if (!url.trim() || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/v1/indices/import-sdmx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), end_period_strategy: strategy }),
      })
      if (!res.ok) throw new Error(await parseErrorDetail(res))
      const data = await res.json()
      if (data.job_id) {
        showResult(await pollImportJob(data.job_id))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--color-overlay)', overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 480,
        maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 24px var(--color-shadow-heavy)', margin: 'auto',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, color: 'var(--color-text-primary)', flexShrink: 0, position: 'sticky', top: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingBottom: 8 } }>Importa Query SDMX</h3>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 8 }}>
            Copia l'URL <strong>Data</strong> dalla sezione{' '}
            <a
              href="https://esploradati.istat.it/databrowser/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
            >
              Query SDMX
            </a>{' '}
            di esploradati.istat.it/databrowser.
          </p>
          <p style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            Esempio:{' '}
            <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              https://esploradati.istat.it/SDMXWS/rest/data/IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0/Q..../ALL/?detail=full&amp;startPeriod=2024-01-01&amp;endPeriod=2026-03-31&amp;dimensionAtObservation=TIME_PERIOD
            </span>
          </p>
          <p style={{ marginBottom: 0, fontSize: 12, color: 'var(--color-text-warning)' }}>
            Istat consente 5 query/minuto per IP: l'importazione può richiedere fino a ~1 minuto.
          </p>
        </div>

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

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Strategia date (endPeriod)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" name="sdmx-strategy" checked={strategy === "last_month_end"} onChange={() => setStrategy("last_month_end")} />
            <span>Automatica: fine mese precedente (consigliata)</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
            <input type="radio" name="sdmx-strategy" checked={strategy === "today"} onChange={() => setStrategy("today")} />
            <span>Automatica: oggi</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name="sdmx-strategy" checked={strategy === "fixed"} onChange={() => setStrategy("fixed")} />
            <span>Fissa (usa date salvate)</span>
          </label>
        </div>

        {loading && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13,
            background: 'var(--color-bg-offset)', color: 'var(--color-text-secondary)',
          }}>
            Importazione in corso — Istat può impiegare anche 5-10 minuti per query
            con dimensioni non filtrate. Puoi chiudere la finestra: l'import continua
            in background.
          </div>
        )}
        {error && <div style={{ padding: '8px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{error}</div>}
        {result && <div style={{ padding: '8px 12px', background: 'var(--color-bg-success)', color: 'var(--color-text-success)', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap' }}>{result}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, position: 'sticky', bottom: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}>Chiudi</button>
          <button onClick={handleImport} disabled={!url.trim() || loading} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !url.trim() || loading ? 'var(--color-text-light)' : 'var(--color-primary)', color: '#fff', cursor: !url.trim() || loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>{loading ? 'Importazione in corso...' : 'Importa'}</button>
        </div>
      </div>
    </div>
  )
}

function ClearIndexModal({ series, onClose, onCleared }: { series: Series; onClose: () => void; onCleared: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [understood, setUnderstood] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const parseErrorDetail = async (res: Response): Promise<string> => {
    let detail = await res.text()
    try {
      const j: unknown = JSON.parse(detail)
      if (j && typeof j === 'object' && 'detail' in j) {
        const raw = (j as { detail?: unknown }).detail
        if (typeof raw === 'string' && raw) detail = raw
      }
    } catch { /* body non JSON: usa il testo grezzo */ }
    return detail || 'Errore operazione'
  }

  const doClear = async () => {
    if (!understood || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/indices/${encodeURIComponent(series.id)}/observations`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await parseErrorDetail(res))
      onCleared()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const dangerBtn: React.CSSProperties = {
    padding: '8px 20px', borderRadius: 8, border: 'none',
    background: step === 1 ? 'var(--color-primary)' : 'var(--color-text-error)',
    color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--color-overlay)', overflowY: 'auto', padding: '24px 16px',
    }}>
      <div style={{
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 460,
        maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        boxShadow: '0 4px 24px var(--color-shadow-heavy)', margin: 'auto',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 18, color: 'var(--color-text-error)' }}>
          {step === 1 ? 'Svuota indice' : 'Conferma definitiva'}
        </h3>

        {step === 1 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            <p style={{ marginBottom: 8 }}>
              Stai per svuotare l'indice:
            </p>
            <p style={{ marginBottom: 8, fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-primary)' }}>
              {series.id}
            </p>
            <p style={{ marginBottom: 8 }}>{series.name}</p>
            <p style={{ marginBottom: 0, color: 'var(--color-text-warning)' }}>
              Verranno eliminate <strong>{series.observation_count}</strong> osservazioni.
              La serie resta, ma vuota.
            </p>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            <p style={{ marginBottom: 8 }}>
              Ultimo passaggio: l'operazione è <strong>irreversibile</strong>. Le{' '}
              <strong>{series.observation_count}</strong> osservazioni dell'indice{' '}
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{series.id}</span>{' '}
              saranno cancellate definitivamente.
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} />
              <span>Ho capito: la cancellazione è irreversibile</span>
            </label>
          </div>
        )}

        {error && <div style={{ padding: '8px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0, position: 'sticky', bottom: 0, background: 'var(--color-bg-card)', zIndex: 1, paddingTop: 12, borderTop: '1px solid var(--color-border)', marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}>Annulla</button>
          {step === 1 ? (
            <button onClick={() => setStep(2)} style={dangerBtn}>Continua</button>
          ) : (
            <button onClick={doClear} disabled={!understood || loading} style={{
              ...dangerBtn,
              background: !understood || loading ? 'var(--color-text-light)' : 'var(--color-text-error)',
              cursor: !understood || loading ? 'not-allowed' : 'pointer',
            }}>{loading ? 'Svuotamento...' : 'Svuota indice'}</button>
          )}
        </div>
      </div>
    </div>
  )
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
      if (j && typeof j === 'object' && 'detail' in j) {
        const raw = (j as { detail?: unknown }).detail
        if (typeof raw === 'string' && raw) detail = raw
      }
    } catch { /* body non JSON: usa il testo grezzo */ }
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
                <input type="radio" name="strategy" checked={strategy === "fixed"} onChange={() => setStrategy("fixed")} />
                <span>Fissa (usa date salvate)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
                <input type="radio" name="strategy" checked={strategy === "last_month_end"} onChange={() => setStrategy("last_month_end")} />
                <span>Automatica: fine mese precedente (consigliata)</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" name="strategy" checked={strategy === "today"} onChange={() => setStrategy("today")} />
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
                const preview = lm.toISOString().slice(0,10)
                return <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>Anteprima riscrittura: endPeriod={preview} {strategy === "today" ? "(oggi)" : "(fine mese precedente)"}</div>
              } catch { return null }
            })()}
            <div style={{ fontSize: 12, color: 'var(--color-text-warning)', marginBottom: 16, lineHeight: 1.5 }}>
              "Aggiorna" salva solo l'URL — per ri-scaricare i dati usa il pulsante ⟳ sulla riga.
              Istat consente 5 query/minuto per IP.
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

export default function IstatCatalog() {
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [seriesList, setSeriesList] = useState<Series[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingSeries, setLoadingSeries] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showSdmx, setShowSdmx] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [clearTarget, setClearTarget] = useState<Series | null>(null)
  const [manageTarget, setManageTarget] = useState<SavedQuery | null>(null)
  const [runState, setRunState] = useState<{ query: SavedQuery; status: 'running' | 'done' | 'error'; message?: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchGroupCache, setSearchGroupCache] = useState<Record<string, Series[]>>({})
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchActive = searchQuery.trim().length > 0

  const parseErrorDetail = async (res: Response): Promise<string> => {
    let detail = await res.text()
    try {
      const j: unknown = JSON.parse(detail)
      if (j && typeof j === 'object' && 'detail' in j) {
        const raw = (j as { detail?: unknown }).detail
        if (typeof raw === 'string' && raw) detail = raw
      }
    } catch { /* body non JSON: usa il testo grezzo */ }
    return detail || 'Errore operazione'
  }

  const handleRunQuery = async (query: SavedQuery) => {
    if (runState?.status === 'running' && runState.query.id === query.id) return
    setRunState({ query, status: 'running' })
    try {
      const res = await fetch(`/api/v1/indices/saved-queries/${encodeURIComponent(query.id)}/run`, { method: 'POST' })
      if (!res.ok) throw new Error(await parseErrorDetail(res))
      const data = await res.json()
      const job = await pollImportJob(data.job_id)
      const d = job.result?.details
      if (!d) throw new Error('Risultato import mancante')
      let suffix = ""
      if (data && typeof data === "object" && "resolved_meta" in data && data.resolved_meta && typeof data.resolved_meta === "object" && "endPeriod" in data.resolved_meta) {
        const ep = data.resolved_meta.endPeriod
        if (typeof ep === "string" && ep && data.url !== data.original_url) suffix = ` (endPeriod aggiornato a ${ep})`
      }
      setRunState({
        query,
        status: 'done',
        message: `Riscaricata "${query.dataflow_id}": ${d.added} aggiunte, ${d.updated} aggiornate, ${d.skipped} saltate, ${d.errors} errori. ${d.series_created} nuove serie create.${suffix}`,
      })
      setReloadKey(k => k + 1)
    } catch (e: unknown) {
      setRunState({ query, status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/indices/groups')
      .then(r => r.json())
      .then((data: Group[]) => {
        data.sort((a, b) => {
          const ai = PINNED.indexOf(a.key)
          const bi = PINNED.indexOf(b.key)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })
        setGroups(data)
        setSelectedGroup(prev => {
          const stillExists = data.some(g => g.key === prev)
          return stillExists ? prev : data.length > 0 ? data[0].key : ''
        })
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }, [reloadKey])

  useEffect(() => {
    if (!selectedGroup) return
    setLoadingSeries(true)
    setExpanded(null)
    fetch(`/api/v1/indices/by-group/${encodeURIComponent(selectedGroup)}`)
      .then(r => r.json())
      .then(data => setSeriesList(data))
      .catch(() => setSeriesList([]))
      .finally(() => setLoadingSeries(false))
  }, [selectedGroup, reloadKey])

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!searchActive) {
      setSearchResults([])
      setSearching(false)
      setExpanded(null)
      return
    }
    searchTimeout.current = setTimeout(() => {
      setSearching(true)
      fetch(`/api/v1/indices/search?q=${encodeURIComponent(searchQuery.trim())}`)
        .then(r => r.json())
        .then(data => setSearchResults(data))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 250)
  }, [searchQuery, searchActive])

  useEffect(() => {
    if (!searchActive || !expanded) return
    const hit = searchResults.find(r => r.id === expanded)
    const groupRef = hit?.classification_ref ?? ''
    if (!groupRef) return
    if (searchGroupCache[groupRef]) return
    fetch(`/api/v1/indices/by-group/${encodeURIComponent(groupRef)}`)
      .then(r => r.json())
      .then(data => setSearchGroupCache(c => ({ ...c, [groupRef]: data })))
      .catch(() => setSearchGroupCache(c => ({ ...c, [groupRef]: [] })))
  }, [expanded, searchActive, searchResults, searchGroupCache])

  return (
    <div>
      <div style={{
        background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px var(--color-shadow)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Indici ISTAT</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>Serie storiche indici ISTAT per la revisione prezzi</p>
            <p style={{ margin: '8px 0 0', fontSize: 13 }}>
              <a href="/catalogs/sdmx-queries" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Cerchi tutte le query salvate? Vai al Registro SDMX →</a>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowSdmx(true)} style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            }}>Importa Query SDMX</button>
            <button onClick={() => setShowImport(true)} style={{
              padding: '10px 20px', borderRadius: 8, border: '1px solid var(--color-primary)',
              background: 'var(--color-bg-card)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            }}>Importa CSV</button>
          </div>
        </div>

        <input
          type="text"
          placeholder="Cerca indice per nome o codice…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 14px', fontSize: 14,
            border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none',
            background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', marginBottom: 16,
          }}
        />

        {searchActive ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            Ricerca attiva — risultati sopra. Cancella la ricerca per tornare ai gruppi.
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--color-text-muted)' }}>Caricamento gruppi...</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {groups.map(g => (
              <button
                key={g.key}
                onClick={() => setSelectedGroup(g.key)}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid #d1d5db',
                  background: selectedGroup === g.key ? 'var(--color-primary)' : 'var(--color-bg-card)',
                  color: selectedGroup === g.key ? '#fff' : 'var(--color-text-secondary)',
                  cursor: 'pointer', fontSize: 13,
                  fontWeight: PINNED.includes(g.key) ? (selectedGroup === g.key ? 700 : 600) : 400,
                }}
              >
                {GROUP_LABELS[g.key] || g.key}
                <span style={{ opacity: 0.6, marginLeft: 6 }}>({g.observation_count})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--color-bg-card)', padding: 24, borderRadius: 12,
        boxShadow: '0 1px 3px var(--color-shadow)',
      }}>
        {runState && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap',
            background: runState.status === 'done'
              ? 'var(--color-bg-success)'
              : runState.status === 'error' ? 'var(--color-bg-error)' : 'var(--color-bg-offset)',
            color: runState.status === 'done'
              ? 'var(--color-text-success)'
              : runState.status === 'error' ? 'var(--color-text-error)' : 'var(--color-text-secondary)',
          }}>
            {runState.status === 'running'
              ? `Riscaricamento query ${runState.query.dataflow_id} in corso — Istat può impiegare 5-10 minuti per query con dimensioni non filtrate. Puoi continuare a usare la pagina: il download continua in background.`
              : runState.status === 'done' ? `✓ ${runState.message}` : runState.message}
          </div>
        )}
        {searchActive ? (
          searching ? (
            <div style={{ color: 'var(--color-text-muted)' }}>Ricerca in corso...</div>
          ) : searchResults.length === 0 ? (
            <div style={{ color: 'var(--color-text-light)', fontStyle: 'italic' }}>
              Nessun risultato per "{searchQuery.trim()}".
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, width: 24 }}></th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Serie</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Codice</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Frequenza</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Gruppo</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Osservazioni</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Query SDMX</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map(hit => {
                  const groupSeries = hit.classification_ref ? searchGroupCache[hit.classification_ref] : undefined
                  const full = groupSeries?.find(s => s.id === hit.id)
                  const expandedSeries = expanded === hit.id ? full : undefined
                  return (
                    <React.Fragment key={hit.id}>
                      <tr
                        onClick={() => setExpanded(expanded === hit.id ? null : hit.id)}
                        style={{
                          borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                          background: expanded === hit.id ? 'var(--color-bg-offset)' : undefined,
                        }}
                      >
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {expanded === hit.id ? '▼' : '▶'}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                          {hit.name}
                          {hit.saved_query && <SdmxChip query={hit.saved_query} />}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{hit.id}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>
                          {hit.frequency === 'quarterly' ? 'Trimestrale' : hit.frequency === 'monthly' ? 'Mensile' : hit.frequency === 'annual' ? 'Annuale' : hit.frequency}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>
                          {hit.classification_ref ? (GROUP_LABELS[hit.classification_ref] || hit.classification_ref) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                          {full ? full.observation_count : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {hit.saved_query && (
                            <QueryActions
                              query={hit.saved_query}
                              running={runState?.status === 'running' && runState.query.id === hit.saved_query.id}
                              onRun={handleRunQuery}
                              onManage={setManageTarget}
                            />
                          )}
                        </td>
                      </tr>
                      {expanded === hit.id && (
                        <tr>
                          <td colSpan={7} style={{ padding: '0 12px 12px 36px' }}>
                            {!expandedSeries ? (
                              <div style={{ color: 'var(--color-text-light)', fontStyle: 'italic', padding: 12 }}>
                                Caricamento osservazioni...
                              </div>
                            ) : expandedSeries.observations.length === 0 ? (
                              <div style={{ color: 'var(--color-text-light)', fontStyle: 'italic', padding: 12 }}>Nessuna osservazione</div>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Periodo</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Valore</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedSeries.observations.map(o => (
                                    <tr key={o.period} style={{ borderBottom: '1px solid #f9fafb' }}>
                                      <td style={{ padding: '4px 8px' }}>{formatPeriod(o.period, expandedSeries.frequency)}</td>
                                      <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                                        {o.value.toFixed(2)}
                                        {!o.is_definitive && <span style={{ color: 'var(--color-text-warning)', marginLeft: 4, fontSize: 10 }}>provv.</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {expandedSeries && (
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                                <button
                                  onClick={() => setClearTarget(expandedSeries)}
                                  style={{
                                    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                    border: '1px solid var(--color-text-error)', background: 'var(--color-bg-card)',
                                    color: 'var(--color-text-error)', cursor: 'pointer',
                                  }}
                                >
                                  Svuota indice
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )
        ) : loadingSeries ? (
          <div style={{ color: 'var(--color-text-muted)' }}>Caricamento serie...</div>
        ) : seriesList.length === 0 ? (
          <div style={{ color: 'var(--color-text-light)', fontStyle: 'italic' }}>Nessuna serie per questo gruppo.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, width: 24 }}></th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Serie</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Codice</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Frequenza</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Osservazioni</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Query SDMX</th>
              </tr>
            </thead>
            <tbody>
              {seriesList.map(s => (
                <React.Fragment key={s.id}>
                  <tr
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    style={{
                      borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                      background: expanded === s.id ? 'var(--color-bg-offset)' : undefined,
                    }}
                  >
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {expanded === s.id ? '▼' : '▶'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                      {s.name}
                      {s.saved_query && <SdmxChip query={s.saved_query} />}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{s.id}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>
                      {s.frequency === 'quarterly' ? 'Trimestrale' : s.frequency === 'monthly' ? 'Mensile' : s.frequency === 'annual' ? 'Annuale' : s.frequency}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{s.observation_count}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {s.saved_query && (
                        <QueryActions
                          query={s.saved_query}
                          running={runState?.status === 'running' && runState.query.id === s.saved_query.id}
                          onRun={handleRunQuery}
                          onManage={setManageTarget}
                        />
                      )}
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr>
                      <td colSpan={6} style={{ padding: '0 12px 12px 36px' }}>
                        {s.observations.length === 0 ? (
                          <div style={{ color: 'var(--color-text-light)', fontStyle: 'italic', padding: 12 }}>Nessuna osservazione</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Periodo</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--color-text-muted)', fontWeight: 600 }}>Valore</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.observations.map(o => (
                                <tr key={o.period} style={{ borderBottom: '1px solid #f9fafb' }}>
                                  <td style={{ padding: '4px 8px' }}>{formatPeriod(o.period, s.frequency)}</td>
                                  <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                                    {o.value.toFixed(2)}
                                    {!o.is_definitive && <span style={{ color: 'var(--color-text-warning)', marginLeft: 4, fontSize: 10 }}>provv.</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                          <button
                            onClick={() => setClearTarget(s)}
                            style={{
                              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                              border: '1px solid var(--color-text-error)', background: 'var(--color-bg-card)',
                              color: 'var(--color-text-error)', cursor: 'pointer',
                            }}
                          >
                            Svuota indice
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={() => setReloadKey(k => k + 1)} />}
      {showSdmx && <SdmxModal onClose={() => setShowSdmx(false)} onImported={() => setReloadKey(k => k + 1)} />}
      {clearTarget && <ClearIndexModal series={clearTarget} onClose={() => setClearTarget(null)} onCleared={() => { setClearTarget(null); setReloadKey(k => k + 1) }} />}
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