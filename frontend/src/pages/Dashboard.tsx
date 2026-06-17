import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, CaseItem } from '../api/client'
import { formatDate, statusLabel } from '../components/utils'

export default function Dashboard() {
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [totalSteps, setTotalSteps] = useState(8)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()

  const load = async (q?: string) => {
    try {
      setLoading(true)
      const [list, config] = await Promise.all([
        q ? api.cases.search(q) : api.cases.list(),
        fetch('/api/v1/wizard/config').then(r => r.json()).catch(() => ({ steps: [] })),
      ])
      setCases(list)
      if (config.steps?.length) setTotalSteps(config.steps.length)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      load(searchQuery.trim() || undefined)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const create = async () => {
    if (!title.trim()) return
    try {
      const c = await api.cases.create({ title, created_by: createdBy || undefined, notes: notes || undefined })
      setShowCreate(false)
      setTitle('')
      setCreatedBy('')
      setNotes('')
      navigate(`/cases/${c.id}/wizard/1`)
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Pratiche</h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            padding: '10px 20px', background: '#1a1a2e', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Nuova pratica
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fde8e8', color: '#c0392b', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{
        position: 'relative', marginBottom: 20,
      }}>
        <svg style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: '#9ca3af', pointerEvents: 'none',
        }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          placeholder="Cerca per testo, CIG, operatore economico..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%', padding: '12px 12px 12px 40px', border: '1px solid #d1d5db',
            borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none', background: '#fff',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
              fontSize: 16, padding: '4px 8px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {showCreate && (
        <div style={{
          background: '#fff', padding: 24, borderRadius: 12, marginBottom: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 0 }}>Nuova pratica</h2>
          <input
            placeholder="Titolo pratica *"
            value={title} onChange={e => setTitle(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Creato da (opzionale)"
            value={createdBy} onChange={e => setCreatedBy(e.target.value)}
            style={inputStyle}
          />
          <textarea
            placeholder="Note (opzionale)"
            value={notes} onChange={e => setNotes(e.target.value)}
            rows={3} style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={create} style={btnStyle}>
              Crea e apri
            </button>
            <button
              onClick={() => setShowCreate(false)}
              style={{ ...btnStyle, background: '#f3f4f6', color: '#374151' }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#6b7280' }}>Caricamento...</div>
      ) : cases.length === 0 ? (
        <div style={{
          background: '#fff', padding: 48, borderRadius: 12, textAlign: 'center',
          color: '#9ca3af',
        }}>
          Nessuna pratica. Creane una nuova per iniziare.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map(c => (
            <div
              key={c.id}
              onClick={() => navigate(c.current_step > 0 ? `/cases/${c.id}/wizard/${c.current_step}` : `/cases/${c.id}`)}
              style={{
                background: '#fff', padding: '16px 20px', borderRadius: 10,
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'box-shadow 0.15s',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {c.created_by && `${c.created_by} · `}{formatDate(c.created_at)}
                </div>
              </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    background: c.status === 'completed' ? '#d1fae5' : c.status === 'draft' ? '#fef3c7' : '#dbeafe',
                    color: c.status === 'completed' ? '#065f46' : c.status === 'draft' ? '#92400e' : '#1e40af',
                  }}>
                    {statusLabel(c.status)}
                  </span>
                  <span style={{ fontSize: 13, color: '#9ca3af' }}>
                    Step {c.current_step}/{totalSteps}
                  </span>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (window.confirm(`Eliminare la pratica "${c.title}"?`)) {
                        api.cases.delete(c.id).then(() => load(searchQuery.trim() || undefined))
                      }
                    }}
                    title="Elimina pratica"
                    style={{
                      padding: '4px 8px', border: 'none', borderRadius: 6,
                      background: 'transparent', color: '#9ca3af', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#c0392b'; e.currentTarget.style.background = '#fef2f2' }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.background = 'transparent' }}
                  >
                    Elimina
                  </button>
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 12px', marginBottom: 8,
  border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14,
  fontFamily: 'inherit', boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  padding: '10px 20px', background: '#1a1a2e', color: '#fff',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
}
