import React, { useState } from 'react'

export interface SavedQueryRef {
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

export function SavedQueryModal({ query, onClose, onSaved, onDeleted }: {
  query: SavedQueryRef
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
