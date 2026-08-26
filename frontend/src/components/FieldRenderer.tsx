import { useCallback, useEffect, useState } from 'react'

interface FieldConfig {
  key: string
  label: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
  hint?: string
}

interface Props {
  field: FieldConfig
  value: string
  onChange: (key: string, value: string) => void
  error?: string
}

const MONTH_LABELS = [
  ['01', 'Gennaio'], ['02', 'Febbraio'], ['03', 'Marzo'], ['04', 'Aprile'],
  ['05', 'Maggio'], ['06', 'Giugno'], ['07', 'Luglio'], ['08', 'Agosto'],
  ['09', 'Settembre'], ['10', 'Ottobre'], ['11', 'Novembre'], ['12', 'Dicembre'],
] as const

function parseMonthValue(value: string): [string, string] {
  const [year, month] = (value || '').split('-')
  return [year || '', month || '']
}

function buildYearRange(): string[] {
  const currentYear = new Date().getFullYear()
  const years: string[] = []
  for (let y = currentYear - 15; y <= currentYear + 15; y++) {
    years.push(String(y))
  }
  return years
}

function MonthInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [seedYear, seedMonth] = parseMonthValue(value)
  const [year, setYear] = useState(seedYear)
  const [month, setMonth] = useState(seedMonth)
  const years = buildYearRange()

  useEffect(() => {
    const [y, m] = parseMonthValue(value)
    setYear(y)
    setMonth(m)
  }, [value])

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)',
    borderRadius: 6, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
    background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
    colorScheme: 'dark',
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select
        id={`${id}-month`}
        value={month}
        style={{ ...selectStyle, width: 160 }}
        onChange={e => {
          const m = e.target.value
          setMonth(m)
          if (year && m) onChange(`${year}-${m}`)
        }}
      >
        <option value="">Mese</option>
        {MONTH_LABELS.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <select
        id={`${id}-year`}
        value={year}
        style={{ ...selectStyle, width: 120 }}
        onChange={e => {
          const y = e.target.value
          setYear(y)
          if (y && month) onChange(`${y}-${month}`)
        }}
      >
        <option value="">Anno</option>
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  )
}

export default function FieldRenderer({ field, value, onChange, error }: Props) {
  const id = `field-${field.key}`

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      onChange(field.key, e.target.value)
    },
    [field.key, onChange]
  )

  const handleBoolean = useCallback(
    (val: string) => {
      onChange(field.key, val)
    },
    [field.key, onChange]
  )

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: error ? '1px solid var(--color-border-error)' : '1px solid var(--color-border)',
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    colorScheme: 'dark' as any,
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 4, fontSize: 13,
    fontWeight: 600, color: 'var(--color-text-secondary)',
  }
  const errorStyle: React.CSSProperties = {
    color: 'var(--color-text-error)', fontSize: 12, marginTop: 2,
  }
  const hintStyle: React.CSSProperties = {
    color: 'var(--color-text-muted)', fontSize: 12, marginTop: 4, lineHeight: 1.5,
  }

  switch (field.type) {
    case 'month':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <MonthInput id={id} value={value} onChange={v => onChange(field.key, v)} />
          {field.hint && <div style={hintStyle}>{field.hint}</div>}
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    case 'text':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <input
            id={id} type="text"
            value={value} onChange={handleChange}
            style={inputStyle}
          />
          {field.hint && <div style={hintStyle}>{field.hint}</div>}
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    case 'select':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <select id={id} value={value} onChange={handleChange} style={inputStyle}>
            <option value="">— Seleziona —</option>
            {(field.options || []).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    case 'boolean': {
      const boolVal = value === 'true' ? true : value === 'false' ? false : null
      return (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{field.label}{field.required && ' *'}</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              { val: 'true', label: 'Sì' },
              { val: 'false', label: 'No' },
            ].map(opt => (
              <button
                key={opt.val}
                type="button"
                onClick={() => handleBoolean(opt.val)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6, border: '1px solid var(--color-border)',
                  background: boolVal === (opt.val === 'true') ? 'var(--color-primary)' : 'var(--color-bg-card)',
                  color: boolVal === (opt.val === 'true') ? '#fff' : 'var(--color-text-secondary)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 14,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )
    }

    case 'textarea':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <textarea
            id={id} value={value} onChange={handleChange}
            rows={4} style={{ ...inputStyle, resize: 'vertical' }}
          />
          {field.hint && <div style={hintStyle}>{field.hint}</div>}
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    case 'date':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <input
            id={id} type="date" value={value} onChange={handleChange}
            style={inputStyle}
          />
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    case 'integer':
    case 'decimal':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <input
            id={id} type="number" step={field.type === 'decimal' ? '0.01' : '1'}
            value={value} onChange={handleChange}
            style={inputStyle}
          />
          {error && <div style={errorStyle}>{error}</div>}
        </div>
      )

    default:
      return (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{field.label} (type: {field.type})</label>
          <input value={value} onChange={handleChange} style={inputStyle} />
        </div>
      )
  }
}
