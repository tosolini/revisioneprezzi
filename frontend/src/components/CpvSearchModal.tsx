import { useState, useRef, useEffect } from 'react'

interface CpvHit {
  code: string
  description: string
}

interface CpvSearchModalProps {
  open: boolean
  onClose: () => void
  onSelect: (code: string, description: string) => void
}

export default function CpvSearchModal({ open, onClose, onSelect }: CpvSearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CpvHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (!query.trim()) {
      setResults([])
      return
    }
    timeoutRef.current = setTimeout(() => {
      setLoading(true)
      fetch(`/api/v1/cpv/search?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.json())
        .then(data => setResults(data.results || []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 250)
  }, [query])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 12, width: 640, maxWidth: '90vw',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>
            Cerca codice CPV
          </h2>
          <input
            ref={inputRef}
            type="text"
            placeholder="Cerca per codice o descrizione…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%', marginTop: 12, padding: '10px 14px', fontSize: 14,
              border: '1px solid #d1d5db', borderRadius: 8, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8, minHeight: 200 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              Ricerca in corso…
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              Nessun risultato
            </div>
          )}
          {results.map(hit => (
            <button
              key={hit.code}
              onClick={() => onSelect(hit.code, hit.description)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontFamily: 'inherit',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontWeight: 700, color: '#1a1a2e', fontSize: 14 }}>
                {hit.code}
              </span>
              <span style={{ color: '#6b7280', marginLeft: 12 }}>{hit.description}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 6, border: '1px solid #d1d5db',
              background: '#fff', color: '#374151', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
