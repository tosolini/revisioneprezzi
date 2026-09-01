interface ContractTypeSelectorProps {
  value: 'works' | 'services' | 'supplies' | ''
  onChange: (type: 'works' | 'services' | 'supplies') => void
  disabled?: boolean
}

const CONTRACT_TYPES = [
  {
    value: 'works' as const,
    label: 'Lavori',
    icon: '🏗️',
    short: 'TOL',
    description: 'Opere, infrastrutture e manutenzioni',
    classification: 'Tipologie Omogenee Lavorazioni',
    meta: 'Soglia 3% · 90% riconosciuto',
  },
  {
    value: 'services' as const,
    label: 'Servizi',
    icon: '💼',
    short: 'CPV',
    description: 'Prestazioni intellettuali e operative',
    classification: 'Common Procurement Vocabulary',
    meta: 'Soglia 5% · 80% riconosciuto',
  },
  {
    value: 'supplies' as const,
    label: 'Forniture',
    icon: '📦',
    short: 'CPV',
    description: 'Beni, forniture e somministrazioni',
    classification: 'Common Procurement Vocabulary',
    meta: 'Soglia 5% · 80% riconosciuto',
  },
]

export default function ContractTypeSelector({
  value,
  onChange,
  disabled = false,
}: ContractTypeSelectorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        {CONTRACT_TYPES.map(type => {
          const selected = value === type.value
          return (
            <button
              key={type.value}
              type="button"
              onClick={() => onChange(type.value)}
              disabled={disabled}
              aria-pressed={selected}
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: '20px 18px 16px',
                borderRadius: 16,
                border: selected
                  ? '1.5px solid var(--color-primary)'
                  : '1.5px solid var(--color-border-light)',
                background: selected ? 'var(--color-bg-card)' : 'var(--color-bg-card)',
                boxShadow: selected
                  ? '0 8px 24px var(--color-shadow), 0 1px 2px var(--color-shadow)'
                  : '0 1px 3px var(--color-shadow)',
                transform: selected ? 'translateY(-1px)' : 'none',
                opacity: disabled ? 0.55 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'all 160ms ease',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                if (disabled || selected) return
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.boxShadow = '0 4px 14px var(--color-shadow)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                if (disabled || selected) return
                e.currentTarget.style.borderColor = 'var(--color-border-light)'
                e.currentTarget.style.boxShadow = '0 1px 3px var(--color-shadow)'
                e.currentTarget.style.transform = 'none'
              }}
            >
              {/* top accent */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 3,
                  background: selected ? 'var(--color-primary)' : 'transparent',
                  opacity: selected ? 1 : 0,
                  transition: 'opacity 160ms',
                }}
              />

              {/* check */}
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 14,
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontWeight: 800,
                  background: selected ? 'var(--color-primary)' : 'transparent',
                  color: selected ? 'var(--color-primary-text)' : 'transparent',
                  border: selected ? 'none' : '1.5px solid var(--color-border)',
                  transition: 'all 160ms',
                }}
                aria-hidden
              >
                ✓
              </div>

              {/* icon */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 22,
                  marginBottom: 14,
                  background: selected ? 'var(--color-primary)' : 'var(--color-bg-info)',
                  color: selected ? 'var(--color-primary-text)' : 'inherit',
                  border: selected ? 'none' : '1px solid var(--color-border-info)',
                  transition: 'all 160ms',
                }}
              >
                <span aria-hidden>{type.icon}</span>
              </div>

              <div style={{ paddingRight: 18 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 750,
                    lineHeight: 1.2,
                    color: 'var(--color-text-primary)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {type.label}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12.5,
                    lineHeight: 1.4,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {type.description}
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--color-border-lighter)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    background: selected ? 'var(--color-bg-info)' : 'var(--color-bg-muted)',
                    color: selected ? 'var(--color-text-info)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border-light)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: type.short === 'TOL' ? '#f59e0b' : 'var(--color-primary)',
                      flexShrink: 0,
                    }}
                  />
                  {type.short} · {type.classification}
                </span>
              </div>

              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: selected ? 'var(--color-text-primary)' : 'var(--color-text-light)',
                }}
              >
                {type.meta}
              </div>
            </button>
          )
        })}
      </div>

      {/* Quadro normativo */}
      {value && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 16,
            alignItems: 'center',
            padding: '14px 16px',
            borderRadius: 12,
            background: 'var(--color-bg-muted)',
            border: '1px solid var(--color-border-light)',
          }}
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                  marginBottom: 2,
                }}
              >
                Soglia attivazione
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1,
                }}
              >
                {value === 'works' ? '3%' : '5%'}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  oltre
                </span>
              </div>
            </div>
            <div
              style={{
                width: 1,
                alignSelf: 'stretch',
                background: 'var(--color-border-light)',
                display: 'block',
              }}
              aria-hidden
            />
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                  marginBottom: 2,
                }}
              >
                Quota riconosciuta
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1,
                }}
              >
                {value === 'works' ? '90%' : '80%'}
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  della variazione
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              textAlign: 'right',
              lineHeight: 1.35,
              maxWidth: 160,
            }}
          >
            D.Lgs. 36/2023
            <br />
            All. II.2-bis, Art. 3
          </div>
        </div>
      )}
    </div>
  )
}
