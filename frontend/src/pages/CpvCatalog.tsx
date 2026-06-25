import { useState, useRef, useEffect } from 'react'

interface Hit { code: string; description: string }

export default function CpvCatalog() {
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
      fetch(`/api/v1/cpv?${params.toString()}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          setResults(data.results || [])
          setHasMore(Boolean(data.has_more))
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 200)
  }

  useEffect(() => {
    fetchList(query, offset)
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [offset])

  useEffect(() => {
    setOffset(0)
    fetchList(query, 0)
  }, [query])

  const [importing, setImporting] = useState(false)
  const [lastImportTs, setLastImportTs] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const modalFileRef = useRef<HTMLInputElement>(null)

  const fetchImportStatus = async () => {
    try {
      const resp = await fetch('/api/v1/cpv/import_status')
      const data = await resp.json()
      if (resp.ok && data.last_imported_at) {
        setLastImportTs(data.last_imported_at)
      }
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => { fetchImportStatus() }, [])

  const runImport = async () => {
    const file = modalFileRef.current?.files?.[0]
    if (!file) {
      alert('Seleziona un file ZIP prima di importare')
      return
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      alert('Il file deve essere un archivio ZIP')
      return
    }

    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/api/v1/cpv/import-zip', { method: 'POST', body: form })
      if (!resp.ok) {
        const text = await resp.text()
        alert('Import fallito (' + resp.status + '): ' + text.slice(0, 300))
        return
      }
      const data = await resp.json()
      if (resp.ok) {
        fetchList(query, offset)
        fetchImportStatus()
        setShowModal(false)
        alert(`Importati ${data.imported} elementi da: ${data.source}`)
        if (modalFileRef.current) modalFileRef.current.value = ''
      } else {
        alert('Import fallito: ' + JSON.stringify(data))
      }
    } catch (e) {
      alert('Errore durante import: ' + String(e))
    } finally {
      setImporting(false)
    }
  }

  const lastImportStr = lastImportTs ? new Date(lastImportTs * 1000).toLocaleString() : null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Catalogo CPV</h1>
        <div>
          <button onClick={() => setShowModal(true)} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            Importa ZIP
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

      <div style={{ background: 'var(--color-bg-card)', borderRadius: 8, boxShadow: '0 6px 18px var(--color-shadow)', overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Caricamento…</div>}
        {!loading && results.length === 0 && (
          <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Nessun risultato</div>
        )}

        <div>
          {results.map(r => (
            <div key={r.code} style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 12 }}>
              <div style={{ width: 160, fontWeight: 700 }}>{r.code}</div>
              <div style={{ color: 'var(--color-text-muted)', flex: 1 }}>{r.description}</div>
            </div>
          ))}
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

      <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--color-text-light)', fontSize: 13 }}>
        {lastImportStr ? `Ultimo import: ${lastImportStr}` : 'Nessun import precedente'}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--color-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-bg-card)', borderRadius: 12, padding: 24, minWidth: 400, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Importa catalogo CPV</h2>
            <p style={{ margin: '0 0 12px', color: 'var(--color-text-muted)', fontSize: 14 }}>
              Seleziona un file ZIP contenente il XML CPV (cpv_2008.xml)
            </p>
            <input ref={modalFileRef} type="file" accept=".zip" style={{ display: 'block', marginBottom: 16, fontSize: 13 }} />
            <div style={{ fontSize: 12, color: 'var(--color-text-light)', marginBottom: 16 }}>
              I codici CPV sono scaricabili da{' '}
              <a href="https://ted.europa.eu/it/simap/cpv" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>
                ted.europa.eu
              </a>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} disabled={importing} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--color-bg-hover)', border: 'none', cursor: 'pointer' }}>
                Annulla
              </button>
              <button onClick={runImport} disabled={importing} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-bg-card)', border: 'none', cursor: 'pointer' }}>
                {importing ? 'Import in corso…' : 'Importa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
