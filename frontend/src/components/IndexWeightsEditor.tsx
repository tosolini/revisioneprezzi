import { useEffect, useState } from 'react'

interface IndexWeightsSeries {
  id: string
  label: string
}

interface IndexWeightsEditorProps {
  series: IndexWeightsSeries[]
  value: string
  onChange: (json: string) => void
}

function parseValue(raw: string, series: IndexWeightsSeries[]): Record<string, string> {
  const out: Record<string, string> = {}
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw || '')
  } catch {
    parsed = null
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const s of series) {
      const v = (parsed as Record<string, unknown>)[s.id]
      if (typeof v === 'number') out[s.id] = String(v)
    }
  }
  for (const s of series) {
    if (!(s.id in out)) out[s.id] = ''
  }
  return out
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 4, fontSize: 13,
  fontWeight: 600, color: 'var(--color-text-secondary)',
}

export default function IndexWeightsEditor({ series, value, onChange }: IndexWeightsEditorProps) {
  const [inputs, setInputs] = useState<Record<string, string>>(() => parseValue(value, series))

  useEffect(() => {
    setInputs(parseValue(value, series))
  }, [value, series])

  const weights = series.map(s => ({ id: s.id, weight: parseFloat(inputs[s.id] ?? '') || 0 }))
  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  const valid = Math.abs(total - 100) <= 0.01

  const emit = (next: Record<string, string>) => {
    setInputs(next)
    const json: Record<string, number> = {}
    for (const s of series) {
      json[s.id] = parseFloat(next[s.id] ?? '') || 0
    }
    onChange(JSON.stringify(json))
  }

  const balanceEqual = () => {
    const next: Record<string, string> = {}
    series.forEach((s, i) => {
      const share = i === series.length - 1
        ? 100 - (Math.floor((100 / series.length) * 100) / 100) * (series.length - 1)
        : Math.floor((100 / series.length) * 100) / 100
      next[s.id] = share.toFixed(2)
    })
    emit(next)
  }

  if (series.length === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>
        Pesi % indici
        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>
          {' '}— somma deve essere 100%
        </span>
      </label>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Peso percentuale di ciascun indice nella media ponderata delle variazioni
        (Tabella D punto 7: Vt = Σ wi/100 × Vt(i)).
      </div>

      {weights.map(w => (
        <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div style={{ flex: 1, fontSize: 13 }}>
            <span>{series.find(s => s.id === w.id)?.label || w.id}</span>
            <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontFamily: 'monospace', fontSize: 12 }}>
              ({w.id})
            </span>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={inputs[w.id] ?? ''}
            onChange={e => emit({ ...inputs, [w.id]: e.target.value })}
            style={{
              width: 76, padding: '4px 6px', borderRadius: 4, fontSize: 13,
              textAlign: 'right', border: '1px solid var(--color-border)',
              background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
              fontFamily: 'monospace',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: valid ? 'var(--color-text-success)' : 'var(--color-text-warning)' }}>
          Totale: {total.toFixed(2)}% {valid ? '✓' : '— deve essere 100.00%'}
        </span>
        <button
          type="button"
          onClick={balanceEqual}
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
          }}
        >
          Riparti equamente
        </button>
      </div>
    </div>
  )
}
