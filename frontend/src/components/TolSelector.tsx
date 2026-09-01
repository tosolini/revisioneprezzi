import { useEffect, useState } from 'react'

interface TolOption {
  code: string
  sequence: number
  short_description: string
  is_specialized: boolean
}

interface TolSelection {
  code: string
  weight: number
}

interface TolSelectorProps {
  value: TolSelection[]
  onChange: (selections: TolSelection[]) => void
  multiSelect?: boolean
  disabled?: boolean
}

export default function TolSelector({
  value,
  onChange,
  multiSelect = false,
  disabled = false,
}: TolSelectorProps) {
  const [tols, setTols] = useState<TolOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedTol, setExpandedTol] = useState<string | null>(null)
  const [tolDetails, setTolDetails] = useState<Record<string, Record<string, unknown>>>({})

  useEffect(() => {
    setLoading(true)
    fetch('/api/v1/tol/list')
      .then(r => {
        if (!r.ok) throw new Error('Errore caricamento TOL')
        return r.json() as Promise<unknown>
      })
      .then(body => {
        const list = Array.isArray(body) ? (body as TolOption[]) : []
        setTols(list)
        setError('')
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleToggleTol = (code: string) => {
    if (disabled) return
    const exists = value.find(s => s.code === code)
    if (exists) {
      const remaining = value.filter(s => s.code !== code)
      if (remaining.length === 0) {
        onChange([])
      } else {
        const n = remaining.length
        const w = Math.floor(100 / n)
        const rem = 100 - w * n
        const adjusted = remaining.map((s, i) => ({ ...s, weight: w + (i === 0 ? rem : 0) }))
        onChange(adjusted)
      }
    } else {
      if (!multiSelect) {
        onChange([{ code, weight: 100 }])
      } else {
        const n = value.length + 1
        const w = Math.floor(100 / n)
        const rem = 100 - w * n
        const adjusted = value.map((s, i) => ({ ...s, weight: w + (i === 0 ? rem : 0) }))
        onChange([...adjusted, { code, weight: w }])
      }
    }
  }

  const handleWeightChange = (code: string, weight: number) => {
    onChange(value.map(s => (s.code === code ? { ...s, weight } : s)))
  }

  const handleViewDetails = async (code: string) => {
    if (expandedTol === code) {
      setExpandedTol(null)
      return
    }
    setExpandedTol(code)
    if (tolDetails[code]) return
    try {
      const res = await fetch(`/api/v1/tol/${encodeURIComponent(code)}`)
      const body = (await res.json()) as Record<string, unknown>
      setTolDetails(prev => ({ ...prev, [code]: body }))
    } catch {
      // silent
    }
  }

  const totalWeight = value.reduce((sum, s) => sum + s.weight, 0)
  const isWeightValid = Math.abs(totalWeight - 100) < 0.01

  if (loading) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 13,
          border: '1px solid var(--color-border-light)',
          borderRadius: 12,
          background: 'var(--color-bg-card)',
        }}
      >
        Caricamento TOL…
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 10,
          background: 'var(--color-bg-error)',
          color: 'var(--color-text-error)',
          border: '1px solid var(--color-border-error)',
          fontSize: 13,
        }}
      >
        {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          border: '1.5px solid var(--color-border-light)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--color-bg-card)',
          boxShadow: '0 1px 3px var(--color-shadow)',
        }}
      >
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {tols.map(tol => {
            const selected = value.find(s => s.code === tol.code)
            const isExpanded = expandedTol === tol.code

            return (
              <div
                key={tol.code}
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--color-border-lighter)',
                  background: selected ? 'var(--color-bg-muted)' : 'var(--color-bg-card)',
                  transition: 'background 140ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <input
                    type={multiSelect ? 'checkbox' : 'radio'}
                    checked={!!selected}
                    onChange={() => handleToggleTol(tol.code)}
                    disabled={disabled}
                    style={{
                      marginTop: 4,
                      width: 16,
                      height: 16,
                      accentColor: 'var(--color-primary)',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: 13,
                          fontWeight: 700,
                          color: selected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                          background: selected ? 'var(--color-bg-info)' : 'var(--color-bg-muted)',
                          border: '1px solid var(--color-border-light)',
                          padding: '2px 7px',
                          borderRadius: 6,
                        }}
                      >
                        {tol.code}
                      </span>
                      {tol.is_specialized && (
                        <span
                          style={{
                            padding: '2px 7px',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            background: '#f3e8ff',
                            color: '#7c3aed',
                            border: '1px solid #e9d5ff',
                            borderRadius: 999,
                          }}
                        >
                          Specializzata
                        </span>
                      )}
                      {selected && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'var(--color-text-success)',
                            background: 'var(--color-bg-success)',
                            border: '1px solid var(--color-border-success)',
                            padding: '2px 7px',
                            borderRadius: 999,
                          }}
                        >
                          ✓ selezionata
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        margin: '6px 0 0',
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {tol.short_description}
                    </p>

                    <button
                      type="button"
                      onClick={() => void handleViewDetails(tol.code)}
                      style={{
                        marginTop: 8,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--color-primary)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textUnderlineOffset: 3,
                      }}
                    >
                      {isExpanded ? 'Nascondi declaratoria' : 'Mostra declaratoria completa'}
                    </button>

                    {isExpanded && tolDetails[tol.code] && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '12px 14px',
                          background: 'var(--color-bg-card)',
                          border: '1px solid var(--color-border-light)',
                          borderRadius: 10,
                          fontSize: 12.5,
                          lineHeight: 1.5,
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {String(tolDetails[tol.code]['full_description'] ?? '')}
                        {(() => {
                          const n = tolDetails[tol.code]['notes']
                          return typeof n === 'string' && n.trim() ? (
                            <p
                              style={{
                                margin: '8px 0 0',
                                fontSize: 11,
                                fontStyle: 'italic',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              Note: {n}
                            </p>
                          ) : null
                        })()}
                      </div>
                    )}

                    {selected && multiSelect && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                          Peso %
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={selected.weight}
                          onChange={e => handleWeightChange(tol.code, parseFloat(e.target.value) || 0)}
                          disabled={disabled}
                          style={{
                            width: 72,
                            padding: '6px 8px',
                            borderRadius: 8,
                            border: '1.5px solid var(--color-border)',
                            background: 'var(--color-bg-input)',
                            color: 'var(--color-text-primary)',
                            fontSize: 13,
                            fontFamily: 'ui-monospace, monospace',
                            textAlign: 'right',
                            outline: 'none',
                          }}
                        />
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>%</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {value.length > 0 && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 12,
            background: 'var(--color-bg-muted)',
            border: '1px solid var(--color-border-light)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            Riepilogo selezione
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {value.map(sel => (
              <div key={sel.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: 'var(--color-text-primary)' }}>{sel.code}</span>
                {multiSelect && <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>{sel.weight.toFixed(1)}%</span>}
              </div>
            ))}
          </div>

          {multiSelect && value.length > 1 && (
            <div style={{ paddingTop: 10, borderTop: '1px solid var(--color-border-light)', marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>Totale</span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: isWeightValid ? 'var(--color-text-success)' : 'var(--color-text-error)',
                    background: isWeightValid ? 'var(--color-bg-success)' : 'var(--color-bg-error)',
                    border: `1px solid ${isWeightValid ? 'var(--color-border-success)' : 'var(--color-border-error)'}`,
                    padding: '2px 8px',
                    borderRadius: 999,
                  }}
                >
                  {totalWeight.toFixed(1)}%
                </span>
              </div>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 11,
                  fontWeight: 600,
                  color: isWeightValid ? 'var(--color-text-success)' : 'var(--color-text-error)',
                }}
              >
                {isWeightValid ? '✓ Pesi corretti' : '⚠️ La somma dei pesi deve essere 100%'}
              </p>
            </div>
          )}
        </div>
      )}

      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-light)', lineHeight: 1.5 }}>
        {multiSelect
          ? 'Per lavorazioni diverse, seleziona più TOL e ripartisci i pesi — la somma deve essere 100%.'
          : 'Seleziona la TOL prevalente per questo contratto.'}
      </p>
    </div>
  )
}
