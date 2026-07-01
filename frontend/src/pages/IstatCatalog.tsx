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

interface Series {
  id: string
  name: string
  frequency: string
  normative_category: string
  observation_count: number
  observations: Observation[]
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

function ImportModal({ onClose }: { onClose: () => void }) {
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
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-overlay)',
    }}>
      <div style={{
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 460,
        maxWidth: 540, boxShadow: '0 4px 24px var(--color-shadow-heavy)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, color: 'var(--color-text-primary)' }}>Importa CSV ISTAT</h3>
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
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}>Chiudi</button>
          <button onClick={handleUpload} disabled={!file || loading} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !file || loading ? 'var(--color-text-light)' : 'var(--color-primary)', color: '#fff', cursor: !file || loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>{loading ? 'Importazione...' : 'Importa CSV'}</button>
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
        if (data.length > 0) setSelectedGroup(data[0].key)
      })
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedGroup) return
    setLoadingSeries(true)
    setExpanded(null)
    fetch(`/api/v1/indices/by-group/${encodeURIComponent(selectedGroup)}`)
      .then(r => r.json())
      .then(data => setSeriesList(data))
      .catch(() => setSeriesList([]))
      .finally(() => setLoadingSeries(false))
  }, [selectedGroup])

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
          </div>
          <button onClick={() => setShowImport(true)} style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
          }}>Importa CSV</button>
        </div>

        {loading ? (
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
        {loadingSeries ? (
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
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{s.name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{s.id}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text-muted)' }}>
                      {s.frequency === 'quarterly' ? 'Trimestrale' : s.frequency === 'monthly' ? 'Mensile' : s.frequency === 'annual' ? 'Annuale' : s.frequency}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-text-muted)' }}>{s.observation_count}</td>
                  </tr>
                  {expanded === s.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0 12px 12px 36px' }}>
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
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  )
}
