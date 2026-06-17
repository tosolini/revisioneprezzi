import { useCallback } from 'react'

interface FieldConfig {
  key: string
  label: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
}

interface Props {
  field: FieldConfig
  value: string
  onChange: (key: string, value: string) => void
  error?: string
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
    border: error ? '1px solid #e74c3c' : '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: '#fff',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 4, fontSize: 13,
    fontWeight: 600, color: '#374151',
  }
  const errorStyle: React.CSSProperties = {
    color: '#e74c3c', fontSize: 12, marginTop: 2,
  }

  switch (field.type) {
    case 'text':
    case 'month':
      return (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor={id} style={labelStyle}>
            {field.label}{field.required && ' *'}
          </label>
          <input
            id={id} type={field.type === 'month' ? 'month' : 'text'}
            value={value} onChange={handleChange}
            style={inputStyle}
          />
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
                  borderRadius: 6, border: '1px solid #d1d5db',
                  background: boolVal === (opt.val === 'true') ? '#1a1a2e' : '#fff',
                  color: boolVal === (opt.val === 'true') ? '#fff' : '#374151',
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
