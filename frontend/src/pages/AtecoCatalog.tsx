import { useState, useRef, useEffect } from 'react'

interface Hit { code: string; description: string }

function getLevel(code: string): number {
  if (/^[A-Z]$/.test(code)) return 0
  const digits = code.replace(/\./g, '')
  if (digits.length <= 2) return 1
  return digits.length - 1
}

const LEVEL_LABELS = ['Sezione', 'Divisione', 'Gruppo', 'Classe', 'Categoria', 'Sottocategoria']

export default function AtecoCatalog() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(50)
  const [hasMore, setHasMore] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchList = (q: string, off: number) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(off))
      if (q && q.trim()) params.set('q', q.trim())
      fetch(`/api/v1/ateco?${params.toString()}`)
        .then(r => r.json())
        .then(data => {
          setResults(data.results || [])
          setHasMore(Boolean(data.has_more))
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 200)
  }

  useEffect(() => {
    // fetch on mount and when offset changes
    fetchList(query, offset)
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [offset])

  useEffect(() => {
    // when query changes, reset offset and fetch
    setOffset(0)
    fetchList(query, 0)
  }, [query])

  const [showSdmxModal, setShowSdmxModal] = useState(false)
  const [showZipModal, setShowZipModal] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [cacheStatus, setCacheStatus] = useState<Record<string, number | null> | null>(null)
  const [lastImport, setLastImport] = useState<string | null>(null)

  const fetchCacheStatus = async () => {
    try {
      const resp = await fetch('/api/v1/ateco/cache_status')
      const data = await resp.json()
      if (resp.ok && data.candidates) {
        const map: Record<string, number | null> = {}
        data.candidates.forEach((c: any) => map[c.id] = c.fetched_at || null)
        setCacheStatus(map)
      }
    } catch (e) {
      // ignore
    }
  }

  const fetchLastImport = async () => {
    try {
      const resp = await fetch('/api/v1/ateco/last-import')
      const data = await resp.json()
      if (resp.ok && data.last_import_at) {
        setLastImport(new Date(data.last_import_at).toLocaleString())
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchCacheStatus()
    fetchLastImport()
  }, [])

  const confirmImport = async () => {
    setShowSdmxModal(false)
    setImporting(true)
    setImportMessage(null)
    try {
      const resp = await fetch('/api/v1/ateco/import', { method: 'POST' })
      const data = await resp.json()
      if (resp.ok) {
        setImportMessage(`Importati ${data.imported} elementi (id provati: ${data.tried.join(',')})`)
        fetchList(query, offset)
        fetchCacheStatus()
        fetchLastImport()
      } else {
        setImportMessage(`Import fallito: ${JSON.stringify(data)}`)
      }
    } catch (e) {
      setImportMessage('Errore durante import: ' + String(e))
    } finally {
      setImporting(false)
    }
  }

  const latestFetchTs = cacheStatus ? Object.values(cacheStatus).filter(Boolean).map(v => v as number).sort((a,b)=>b-a)[0] || null : null
  const latestFetchStr = latestFetchTs ? new Date(latestFetchTs * 1000).toLocaleString() : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Catalogo ATECO</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {latestFetchStr && <div style={{ color: 'var(--color-text-light)', fontSize: 13 }}>Ultimo fetch: {latestFetchStr}</div>}
          <button onClick={() => setShowSdmxModal(true)} disabled={importing} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            {importing ? 'Import in corso…' : 'ISTAT (SDMX)'}
          </button>
          <button onClick={() => setShowZipModal(true)} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            Da file ZIP
          </button>
        </div>
      </div>

      <div style={{ margin: '12px 0 20px' }}>
        <input
          type="text"
          placeholder="Cerca per codice o descrizione…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
      </div>

      {importMessage && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--color-bg-offset)', borderRadius: 8, color: 'var(--color-text-secondary)' }}>{importMessage}</div>
      )}

      <div style={{ background: 'var(--color-bg-card)', borderRadius: 8, boxShadow: '0 6px 18px var(--color-shadow)', overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Caricamento…</div>}
        {!loading && results.length === 0 && (
          <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Nessun risultato</div>
        )}

        <div>
          {results.map(r => {
            const level = getLevel(r.code)
            const indent = level * 24
            return (
              <div key={r.code} style={{
                padding: '10px 14px',
                paddingLeft: 14 + indent,
                borderBottom: '1px solid #f3f4f6',
                display: 'flex',
                gap: 12,
                alignItems: 'center'
              }}>
                <div style={{ width: 160, fontWeight: level <= 1 ? 700 : 500, fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace' }}>
                  {r.code}
                </div>
                <div style={{ color: 'var(--color-text-muted)', flex: 1 }}>{r.description}</div>
                <div style={{
                  fontSize: 11,
                  color: level <= 1 ? 'var(--color-text-secondary)' : 'var(--color-text-light)',
                  background: level <= 1 ? 'var(--color-border-lighter)' : 'transparent',
                  padding: level <= 1 ? '2px 6px' : 0,
                  borderRadius: 4,
                  whiteSpace: 'nowrap'
                }}>
                  {LEVEL_LABELS[level]}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6' }}>
          <div>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} style={{ padding: '6px 10px', marginRight: 8 }}>
              Precedente
            </button>
            <button onClick={() => setOffset(offset + limit)} disabled={!hasMore} style={{ padding: '6px 10px' }}>
              Successiva
            </button>
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 13, alignSelf: 'center' }}>Mostrati {results.length} voci</div>
        </div>
      </div>

      {lastImport && (
        <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--color-text-light)', fontSize: 13 }}>
          Ultima importazione: {lastImport}
        </div>
      )}

      {showSdmxModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setShowSdmxModal(false)} style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)' }} />
          <div style={{ position: 'relative', background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, maxWidth: 480, width: '90%', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 12px' }}>Import da ISTAT (SDMX)</h3>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              L'importazione dal servizio SDMX di ISTAT potrebbe richiedere molto tempo
              o non funzionare a causa di limitazioni di rete.
            </p>
            <p style={{ margin: '10px 0 0', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              I dati ATECO attualmente presenti <strong>non verranno modificati</strong>
              fino al completamento con successo dell'operazione.
            </p>
            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSdmxModal(false)} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: 'var(--color-bg-card)', cursor: 'pointer' }}>
                Annulla
              </button>
              <button onClick={confirmImport} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer' }}>
                Procedi
              </button>
            </div>
          </div>
        </div>
      )}

      {showZipModal && <ImportZipModal onClose={() => setShowZipModal(false)} onImported={() => { fetchList(query, offset); fetchCacheStatus(); fetchLastImport() }} />}
    </div>
  )
}

function ImportZipModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  const handleUpload = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const resp = await fetch('/api/v1/ateco/import-zip', { method: 'POST', body: formData })
      const data = await resp.json()
      if (resp.ok) {
        setResult(`Importati ${data.imported} elementi da "${data.source}"`)
        onImported()
      } else {
        setError(data.detail || 'Errore importazione')
      }
    } catch (e: any) {
      setError(e.message || 'Errore durante upload')
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
        background: 'var(--color-bg-card)', borderRadius: 12, padding: 28, minWidth: 420,
        maxWidth: 500, boxShadow: '0 4px 24px var(--color-shadow-heavy)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Importa file ZIP ATECO</h3>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 12 }}>
            Scarica il file ZIP{' '}
            <a
              href="https://www.istat.it/classificazione/versioni-precedenti-ateco/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
            >
              dal Portale ISTAT
            </a>
            .
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Seleziona il file ZIP scaricato.</p>
        </div>
        <input type="file" accept=".zip" onChange={e => setFile(e.target.files?.[0] || null)} style={{ marginBottom: 16 }} />
        {file && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
        {error && <div style={{ padding: '8px 12px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}
        {result && <div style={{ padding: '8px 12px', background: 'var(--color-bg-success)', color: 'var(--color-text-success)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{result}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14 }}>Chiudi</button>
          <button onClick={handleUpload} disabled={!file || loading} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: !file || loading ? 'var(--color-text-light)' : 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: !file || loading ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>{loading ? 'Importazione...' : 'Importa ZIP'}</button>
        </div>
      </div>
    </div>
  )
}
