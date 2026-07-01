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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        background: 'var(--color-overlay)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-card)', borderRadius: 12, width: 640, maxWidth: '90vw',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px var(--color-shadow-heavy)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-primary)' }}>
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
              border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none',
              boxSizing: 'border-box', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
            }}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8, minHeight: 200 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)', fontSize: 13 }}>
              Ricerca in corso…
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)', fontSize: 13 }}>
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
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-border-lighter)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontWeight: 700, color: 'var(--color-primary)', fontSize: 14 }}>
                {hit.code}
              </span>
              <span style={{ color: 'var(--color-text-muted)', marginLeft: 12 }}>{hit.description}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--color-border)', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', cursor: 'pointer',
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
