import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ReportResponse } from '../api/client'
import { formatDate } from '../components/utils'

export default function ReportView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!id) return
    api.report(id)
      .then(setReport)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleCopy = () => {
    if (report) {
      navigator.clipboard.writeText(report.report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', padding: 24 }}>Generazione report...</div>
  if (error) return <div style={{ color: 'var(--color-text-error)', padding: 24 }}>{error}</div>

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={() => navigate(`/cases/${id}`)}
          style={{ ...btnStyle, background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0 }}
        >
          ← Torna alla pratica
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleCopy} style={btnStyle}>
            {copied ? 'Copiato!' : 'Copia'}
          </button>
          <button
            onClick={() => {
              const blob = new Blob([report?.report || ''], { type: 'text/markdown' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `report-${id}.md`
              a.click()
              URL.revokeObjectURL(url)
            }}
            style={{ ...btnStyle, ...navBtnStyle }}
          >
            Scarica .md
          </button>
          <button
            onClick={() => window.print()}
            style={navBtnStyle}
          >
            Stampa
          </button>
        </div>
      </div>

      <div style={{
        background: 'var(--color-bg-card)', padding: 32, borderRadius: 12,
        boxShadow: '0 1px 3px var(--color-shadow)', fontFamily: 'monospace',
        fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
        overflow: 'auto', maxHeight: '80vh',
      }}>
        {report?.report || 'Nessun report generato.'}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border)',
  background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
}

const navBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, border: 'none',
  background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer',
  fontSize: 13, fontWeight: 600,
}
