import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, CaseDetail as CaseDetailType } from '../api/client'
import { formatDate, isV2Draft, parseWizardVersion, statusLabel } from '../components/utils'
import NotesEditor, { RichNotes, isEmptyHtml } from '../components/NotesEditor'
import type { WizardVersionInfo } from '../components/utils'

export default function CaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState<CaseDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [v2Info, setV2Info] = useState<WizardVersionInfo | null>(null)
  const [lotto, setLotto] = useState<string | null>(null)
  const [operatore, setOperatore] = useState<string | null>(null)
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaDraft, setMetaDraft] = useState({ title: '', created_by: '', cig: '', cup: '', stazione_appaltante: '', lotto: '', operatore_economico: '', notes: '' })
  const [metaSaving, setMetaSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    api.cases.get(id)
      .then(setC)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(() => {
    if (!id) return
    api.wizard.practiceMeta.get(id)
      .then(m => {
        setLotto(m.lotto)
        setOperatore(m.operatore_economico)
      })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!id || !c) return
    fetch(`/api/v1/cases/${id}/wizard-v2`)
      .then(res => {
        if (!res.ok) throw new Error('no v2')
        return res.json()
      })
      .then(body => {
        setV2Info(parseWizardVersion(body))
      })
      .catch(() => setV2Info(null))
  }, [id, c])

  if (loading) return <div style={{ color: 'var(--color-text-muted)' }}>Caricamento...</div>
  if (error) return <div style={{ color: 'var(--color-text-error)' }}>{error}</div>
  if (!c) return <div style={{ color: 'var(--color-text-muted)' }}>Pratica non trovata</div>

  const isFresh = c.current_step === 0 || c.current_step === 1
  const continuedInV2 = v2Info != null && isV2Draft(v2Info)
  const enterWizard = async (version: 'v1' | 'v2' | 'unified') => {
    if (!id) return
    try {
      await api.wizard.setVersion(id, version)
    } catch {
      // ignora: la navigazione resta valida comunque
    }
    if (version === 'v1') navigate(`/cases/${id}/wizard/${c?.current_step || 1}`)
    else navigate(`/cases/${id}/wizard-v2`)
  }
  const saveMeta = async () => {
    if (!id) return
    const title = metaDraft.title.trim()
    if (!title) {
      setError('Il titolo è obbligatorio')
      return
    }
    setMetaSaving(true)
    try {
      const updated = await api.cases.update(id, {
        title,
        created_by: metaDraft.created_by.trim() || null,
        cig: metaDraft.cig.trim() || null,
        cup: metaDraft.cup.trim() || null,
        stazione_appaltante: metaDraft.stazione_appaltante.trim() || null,
        notes: !isEmptyHtml(metaDraft.notes) ? metaDraft.notes : null,
      })
      const m = await api.wizard.practiceMeta.save(id, {
        lotto: metaDraft.lotto.trim() || null,
        operatore_economico: metaDraft.operatore_economico.trim() || null,
      })
      setC(updated)
      setLotto(m.lotto)
      setOperatore(m.operatore_economico)
      setEditingMeta(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMetaSaving(false)
    }
  }
  const isDraft = c.status === 'draft'

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <button
        onClick={() => navigate('/')}
        style={{ ...btnStyle, background: 'none', border: 'none', color: 'var(--color-primary)', padding: 0, marginBottom: 16 }}
      >
        ← Torna alla dashboard
      </button>

      <div style={{
        background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px var(--color-shadow)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{c.title}</h1>
          <span style={{
            padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: c.status === 'completed' ? 'var(--color-bg-success)' : c.status === 'draft' ? 'var(--color-bg-warning)' : 'var(--color-bg-info)',
            color: c.status === 'completed' ? 'var(--color-text-success)' : c.status === 'draft' ? 'var(--color-text-warning)' : 'var(--color-text-info)',
          }}>
            {statusLabel(c.status)}
          </span>
        </div>

        <table style={{ width: '100%', fontSize: 14 }}>
          <tbody>
            {[
              ['ID', c.id],
              ['CIG', c.cig || '—'],
              ['CUP', c.cup || '—'],
              ['Stazione appaltante', c.stazione_appaltante || '—'],
              ['Lotto', lotto || '—'],
              ['Operatore economico', operatore || '—'],
              ['Creato da', c.created_by || '—'],
              ['Creato il', formatDate(c.created_at)],
              ['Ultimo aggiornamento', formatDate(c.updated_at)],
              ['Step corrente', String(c.current_step)],
            ].map(([label, val]) => (
              <tr key={label}>
                <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-muted)', fontWeight: 600, width: 180 }}>
                  {label}
                </td>
                <td style={{ padding: '6px 0' }}>{val}</td>
              </tr>
            ))}
            {c.notes && !isEmptyHtml(c.notes) && (
              <tr>
                <td style={{ padding: '6px 12px 6px 0', color: 'var(--color-text-muted)', fontWeight: 600, width: 180 }}>
                  Note
                </td>
                <td style={{ padding: '6px 0', fontSize: 14 }}><RichNotes html={c.notes} /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
        {isDraft && editingMeta && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, padding: 16, borderRadius: 12, background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)' }}>
            {([
              ['Titolo *', 'title'],
              ['Creato da', 'created_by'],
              ['CIG', 'cig'],
              ['CUP', 'cup'],
              ['Stazione appaltante', 'stazione_appaltante'],
              ['Lotto / Contratto', 'lotto'],
              ['Operatore economico', 'operatore_economico'],
            ] as Array<[string, keyof typeof metaDraft]>).map(([label, key]) => (
              <div key={key}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  {label}
                </label>
                <input
                  value={metaDraft[key]}
                  onChange={e => setMetaDraft(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)' }}
                />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                Note
              </label>
              <NotesEditor value={metaDraft.notes} onChange={v => setMetaDraft(prev => ({ ...prev, notes: v }))} placeholder="Note (opzionale)" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => void saveMeta()}
                disabled={metaSaving}
                style={{ ...btnStyle, background: 'var(--color-primary)', color: 'var(--color-bg-card)' }}
              >
                {metaSaving ? 'Salvataggio…' : 'Salva dati pratica'}
              </button>
              <button
                onClick={() => setEditingMeta(false)}
                style={{ ...btnStyle, background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                Annulla
              </button>
            </div>
          </div>
        )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {isDraft && !editingMeta && (
          <button
            onClick={() => {
              setMetaDraft({
                title: c.title || '',
                created_by: c.created_by || '',
                cig: c.cig || '',
                cup: c.cup || '',
                stazione_appaltante: c.stazione_appaltante || '',
                lotto: lotto || '',
                operatore_economico: operatore || '',
                notes: c.notes || '',
              })
              setEditingMeta(true)
            }}
            style={{ ...btnStyle, background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          >
            Modifica dati pratica
          </button>
        )}
        {isDraft && (
          <>
            {isFresh ? (
              <button
                onClick={() => void enterWizard('unified')}
                style={{ ...btnStyle, background: 'var(--color-primary)', color: 'var(--color-bg-card)' }}
              >
                Continua Procedura
              </button>
            ) : continuedInV2 ? (
              <button
                onClick={() => navigate(`/cases/${id}/wizard-v2`)}
                style={{ ...btnStyle, background: 'var(--color-primary)', color: 'var(--color-bg-card)' }}
              >
                Continua percorso rapido →
              </button>
            ) : (
              <button
                onClick={() => navigate(`/cases/${id}/wizard/${c.current_step || 1}`)}
                style={{ ...btnStyle, background: 'var(--color-primary)', color: 'var(--color-bg-card)' }}
              >
                Continua wizard →
              </button>
            )}
          </>
        )}
        {c.status === 'completed' && (
          <button
            onClick={() => navigate(`/cases/${id}/report`)}
            style={{ ...btnStyle, background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          >
            Vedi report
          </button>
        )}
        <button
          onClick={() => { if (confirm('Eliminare questa pratica?')) api.cases.delete(id!).then(() => navigate('/')) }}
          style={{ ...btnStyle, background: 'var(--color-bg-card)', color: 'var(--color-text-error)', border: '1px solid var(--color-border-error)' }}
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
