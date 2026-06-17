import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, CaseDetail as CaseDetailType } from '../api/client'
import { formatDate, statusLabel } from '../components/utils'

export default function CaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState<CaseDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.cases.get(id)
      .then(setC)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ color: '#6b7280' }}>Caricamento...</div>
  if (error) return <div style={{ color: '#c0392b' }}>{error}</div>
  if (!c) return <div style={{ color: '#6b7280' }}>Pratica non trovata</div>

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <button
        onClick={() => navigate('/')}
        style={{ ...btnStyle, background: 'none', border: 'none', color: '#1a1a2e', padding: 0, marginBottom: 16 }}
      >
        ← Torna alla dashboard
      </button>

      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{c.title}</h1>
          <span style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: c.status === 'completed' ? '#d1fae5' : c.status === 'draft' ? '#fef3c7' : '#dbeafe',
            color: c.status === 'completed' ? '#065f46' : c.status === 'draft' ? '#92400e' : '#1e40af',
          }}>
            {statusLabel(c.status)}
          </span>
        </div>

        <table style={{ width: '100%', fontSize: 14 }}>
          <tbody>
            {[
              ['ID', c.id],
              ['Creato da', c.created_by || '—'],
              ['Creato il', formatDate(c.created_at)],
              ['Ultimo aggiornamento', formatDate(c.updated_at)],
              ['Step corrente', String(c.current_step)],
              ['Note', c.notes || '—'],
            ].map(([label, val]) => (
              <tr key={label}>
                <td style={{ padding: '6px 12px 6px 0', color: '#6b7280', fontWeight: 600, width: 180 }}>
                  {label}
                </td>
                <td style={{ padding: '6px 0' }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => navigate(`/cases/${id}/wizard/${c.current_step || 1}`)}
          style={{ ...btnStyle, background: '#1a1a2e', color: '#fff' }}
        >
          Continua wizard →
        </button>
        <button
          onClick={() => navigate(`/cases/${id}/report`)}
          style={{ ...btnStyle, background: '#fff', color: '#374151', border: '1px solid #d1d5db' }}
        >
          Vedi report
        </button>
        <button
          onClick={() => { if (confirm('Eliminare questa pratica?')) api.cases.delete(id!).then(() => navigate('/')) }}
          style={{ ...btnStyle, background: '#fff', color: '#c0392b', border: '1px solid #f5c6cb' }}
        >
          Elimina
        </button>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
  fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
}
