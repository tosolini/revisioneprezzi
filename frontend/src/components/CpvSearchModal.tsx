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
          background: 'var(--color-bg-card)', borderRadius: 16, width: 640, maxWidth: '90vw',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px var(--color-shadow-heavy)', border: '1px solid var(--color-border-light)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--color-border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', display: 'grid', placeItems: 'center', fontSize: 14 }}>🔍</div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.01em' }}>
              Cerca codice CPV
            </h2>
          </div>
          <p style={{ margin: '6px 0 0 42px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>Cerca per codice (es. 45230000) o per descrizione (es. lavori stradali).</p>
          <input
            ref={inputRef}
            type="text"
            placeholder="Cerca per codice o descrizione…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%', marginTop: 14, padding: '10px 14px', fontSize: 14,
              border: '1.5px solid var(--color-border)', borderRadius: 10, outline: 'none',
              boxSizing: 'border-box', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
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
          {!query.trim() && !loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-light)', fontSize: 12.5, lineHeight: 1.5 }}>
              Digita almeno 2 caratteri per cercare nel vocabolario CPV.
            </div>
          )}
          {results.map(hit => (
            <button
              key={hit.code}
              onClick={() => onSelect(hit.code, hit.description)}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '11px 14px',
                border: '1px solid transparent', background: 'transparent', borderRadius: 10, cursor: 'pointer',
                fontSize: 13, fontFamily: 'inherit', transition: 'all 120ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-muted)'; e.currentTarget.style.borderColor = 'var(--color-border-light)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
            >
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: 'var(--color-primary)', fontSize: 13, background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>
                {hit.code}
              </span>
              <span style={{ color: 'var(--color-text-secondary)', lineHeight: 1.4, paddingTop: 2 }}>{hit.description}</span>
            </button>
          ))}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--color-border-light)', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 10, border: '1.5px solid var(--color-border)',
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
