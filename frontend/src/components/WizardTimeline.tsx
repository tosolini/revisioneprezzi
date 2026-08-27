import { useId } from 'react'

interface WizardTimelineProps {
  steps: string[]
  currentStep: number
  onStepClick?: (step: number) => void
  showCounter?: boolean
}

/**
 * Indicatore di avanzamento a timeline orizzontale: nodi collegati da una
 * linea di progresso, con etichetta in una parola per ogni step.
 */
export default function WizardTimeline({
  steps,
  currentStep,
  onStepClick,
  showCounter = true,
}: WizardTimelineProps) {
  const pulseId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const clickable = onStepClick !== undefined

  return (
    <div style={{
      // top: altezza nav sticky (56px) + respiro
      position: 'sticky', top: 72, zIndex: 30,
      background: 'var(--color-bg-card)',
      padding: '12px 16px 8px',
      borderRadius: 12,
      borderBottom: '1px solid var(--color-border-light)',
      marginBottom: 24,
    }}>
      <style>{`
        @keyframes tlPulse${pulseId} {
          0%, 100% { box-shadow: 0 0 0 0 rgba(30, 64, 175, 0.30); }
          50% { box-shadow: 0 0 0 7px rgba(30, 64, 175, 0.10); }
        }
      `}</style>
      <ol
        aria-label="Avanzamento della pratica"
        style={{
          display: 'flex', listStyle: 'none', margin: 0, padding: 0,
        }}
      >
        {steps.map((label, idx) => {
          const n = idx + 1
          const completed = n < currentStep
          const active = n === currentStep
          const node = (
            <span
              aria-current={active ? 'step' : undefined}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                background: completed
                  ? 'var(--color-primary)'
                  : active ? 'var(--color-text-info)' : 'transparent',
                color: completed || active ? '#fff' : 'var(--color-text-muted)',
                border: completed || active ? 'none' : '1.5px solid var(--color-border)',
                boxShadow: active ? '0 0 0 4px var(--color-border-info)' : 'none',
                animation: active ? `tlPulse${pulseId} 2.4s ease-in-out infinite` : 'none',
                transition: 'transform 0.15s ease',
              }}
            >
              {completed ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5"></path>
                </svg>
              ) : n}
            </span>
          )
          return (
            <li
              key={n}
              style={{
                flex: idx < steps.length - 1 ? 1 : '0 0 auto',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                minWidth: 0,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {clickable ? (
                  <button
                    type="button"
                    onClick={() => onStepClick(n)}
                    aria-label={`Vai allo step ${n}: ${label}`}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      lineHeight: 0, borderRadius: '50%',
                    }}
                  >
                    {node}
                  </button>
                ) : node}
                {idx < steps.length - 1 && (
                  <span
                    role="presentation"
                    style={{
                      flex: 1, height: 2, borderRadius: 2, margin: '0 8px',
                      background: completed
                        ? 'linear-gradient(90deg, var(--color-primary), var(--color-text-info))'
                        : 'var(--color-border-light)',
                    }}
                  />
                )}
              </span>
              <span
                style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                  whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontWeight: active ? 700 : 500,
                  color: active
                    ? 'var(--color-text-info)'
                    : completed ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                }}
              >
                {label}
              </span>
            </li>
          )
        })}
      </ol>
      {showCounter && (
        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 10, color: 'var(--color-text-muted)' }}>
          Step {currentStep} di {steps.length}
        </p>
      )}
    </div>
  )
}