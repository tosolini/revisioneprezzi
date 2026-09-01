import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, CaseItem } from '../api/client'
import { formatDate, statusLabel } from '../components/utils'

type ExtractFields = Record<string, unknown>

function cleanImporto(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const s = v.trim().replace(/[€\s]/g, '')
    // Italian format: 1.234.567,89 -> 1234567.89
    // If contains comma, remove dots then replace comma with dot
    if (s.includes(',')) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
    }
    return parseFloat(s.replace(/,/g, '')) || 0
  }
  return 0
}

function mapNatura(natura: unknown): string {
  if (typeof natura !== 'string') return ''
  const n = natura.toLowerCase().trim()
  if (n === 'servizio' || n === 'servizi' || n === 'service') return 'services'
  if (n === 'fornitura' || n === 'forniture' || n === 'supply' || n === 'supplies') return 'supplies'
  if (n === 'lavori' || n === 'works') return 'works'
  return ''
}

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
  const [wizardV2Info, setWizardV2Info] = useState<Record<string, { isV2: boolean; v2Step: number }>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [deletingDrafts, setDeletingDrafts] = useState(false)
  const navigate = useNavigate()

  // --- V2 entry state ---
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [creating, setCreating] = useState(false)
  const [extractLoading, setExtractLoading] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [extractPreview, setExtractPreview] = useState<ExtractFields | null>(null)
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null)
  const [showExtractPreview, setShowExtractPreview] = useState(false)
  const [showPathChoice, setShowPathChoice] = useState(false)
  const [pathChoice, setPathChoice] = useState<'rapido' | 'completo'>('rapido')
  const load = async (q?: string) => {
    try {
      setLoading(true)
      const [list, config] = await Promise.all([
        q ? api.cases.search(q) : api.cases.list(),
        fetch('/api/v1/wizard/config').then(r => r.json()).catch(() => ({ steps: [] })),
      ])
      setCases(list)
      if (config.steps?.length) setTotalSteps(config.steps.length)
      // Determina per ogni pratica se usa il wizard rapido (5) o completo (7):
      // se lo stato V2 contiene dati (contract_type/cpv/tol/result o step>1) → 5 passi.
      const infos: Record<string, { isV2: boolean; v2Step: number }> = {}
      const draftIds = list.filter(c => c.status !== 'completed').map(c => c.id)
      await Promise.all(
        draftIds.map(async id => {
          try {
            const res = await fetch(`/api/v1/cases/${id}/wizard-v2`)
            if (!res.ok) return
            const body = (await res.json()) as { state?: Record<string, unknown> }
            const s = body.state as Record<string, unknown> | undefined
            if (!s) return
            const step = typeof s['current_step'] === 'number' ? (s['current_step'] as number) : 1
            const hasContract = typeof s['contract_type'] === 'string' && (s['contract_type'] as string) !== ''
            const hasCpv = Array.isArray(s['cpv_selections']) && (s['cpv_selections'] as unknown[]).length > 0
            const hasTol = Array.isArray(s['tol_selections']) && (s['tol_selections'] as unknown[]).length > 0
            const hasAteco = Array.isArray(s['ateco_selections']) && (s['ateco_selections'] as unknown[]).length > 0
            const hasAmount = typeof s['amount'] === 'number' && (s['amount'] as number) > 0
            const hasResult = s['result'] != null
            const isV2 = hasContract || hasCpv || hasTol || hasAteco || hasAmount || hasResult || step > 1
            infos[id] = { isV2, v2Step: step }
          } catch {
            // ignora, considera V1
          }
        })
      )
      setWizardV2Info(infos)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
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

  const draftsCount = cases.filter(c => c.status === 'draft').length

  const deleteDrafts = async () => {
    if (draftsCount === 0) return
    const ok = window.confirm(
      `Eliminare definitivamente ${draftsCount} pratiche in bozza?\n\nQuesta azione non è reversibile.`
    )
    if (!ok) return
    setDeletingDrafts(true)
    try {
      const res = await api.cases.deleteDrafts()
      await load(searchQuery.trim() || undefined)
      if (res.deleted > 0) setError('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingDrafts(false)
    }
  }

  const resetCreateForm = () => {
    setTitle('')
    setCreatedBy('')
    setNotes('')
    setUploadFile(null)
    setExtractError('')
    setExtractPreview(null)
    setExtractLoading(false)
    setShowExtractPreview(false)
    setShowPathChoice(false)
    setCreatedCaseId(null)
    setPathChoice('rapido')
    setCreating(false)
  }

  const closeCreateModal = () => {
    if (creating || extractLoading) return
    setShowCreate(false)
    resetCreateForm()
  }

  const create = async () => {
    if (!title.trim() || creating || extractLoading) return
    setCreating(true)
    setError('')
    setExtractError('')
    try {
      const c = await api.cases.create({ title, created_by: createdBy || undefined, notes: notes || undefined })
      setCreatedCaseId(c.id)
      // clear form inputs now but keep modal context for branching
      setTitle('')
      setCreatedBy('')
      setNotes('')

      if (uploadFile) {
        setExtractLoading(true)
        try {
          const form = new FormData()
          form.append('file', uploadFile)
          const resp = await fetch(`/api/v1/cases/${c.id}/extract`, {
            method: 'POST',
            body: form,
          })
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({})) as Record<string, unknown>
            const detail = typeof body['detail'] === 'string' ? body['detail'] : `Errore estrazione (${resp.status})`
            throw new Error(detail)
          }
          const data = await resp.json() as { fields?: ExtractFields; applied?: unknown }
          const fields = (data.fields || {}) as ExtractFields
          const hasUseful =
            fields['cpv_primary'] != null && String(fields['cpv_primary']).trim() !== '' ||
            fields['cpv'] != null && String(fields['cpv']).trim() !== '' ||
            fields['importo_complessivo'] != null && String(fields['importo_complessivo']).trim() !== '' ||
            fields['cig'] != null && String(fields['cig']).trim() !== ''
          if (hasUseful) {
            setExtractPreview(fields)
            setShowExtractPreview(true)
            setShowCreate(false)
          } else {
            // nessun dato utile -> fallback selettore manuale
            setExtractPreview(null)
            setExtractError('Non siamo riusciti a estrarre dati utili — prosegui con il percorso che preferisci.')
            const natura = String(fields['natura'] ?? '').toLowerCase()
            setPathChoice(natura.includes('lavor') ? 'completo' : 'rapido')
            setShowPathChoice(true)
            setShowCreate(false)
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('413') || msg.toLowerCase().includes('troppo grande')) {
            setExtractError('File troppo grande (limite 20 MB). Prosegui scegliendo il percorso manualmente.')
          } else {
            setExtractError(msg + ' — prosegui con il percorso completo o rapido.')
          }
          // decide default path
          setPathChoice('rapido')
          setShowPathChoice(true)
          setShowCreate(false)
        } finally {
          setExtractLoading(false)
        }
      } else {
        // nessun file -> selettore esplicito
        setPathChoice('rapido')
        setShowPathChoice(true)
        setShowCreate(false)
      }
      await load(searchQuery.trim() || undefined)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
      setExtractLoading(false)
    }
  }

  const acceptExtract = async () => {
    if (!createdCaseId || !extractPreview) return
    try {
      const cpv = (extractPreview['cpv_primary'] ?? extractPreview['cpv'] ?? extractPreview['cpv_code'] ?? '') as string
      const cpvStr = typeof cpv === 'string' ? cpv.trim() : String(cpv).trim()
      const amount = cleanImporto(extractPreview['importo_complessivo'])
      const contractType = mapNatura(extractPreview['natura'])
      const payload: Record<string, unknown> = {
        current_step: 1,
        contract_type: contractType || '',
        cpv_code: cpvStr || null,
        cpv_description: (extractPreview['oggetto'] as string) || null,
        cpv_selections: cpvStr ? [{ cpv_code: cpvStr, description: (extractPreview['oggetto'] as string) || undefined }] : [],
        ateco_selections: [],
        amount: amount || 0,
        base_period: null,
        comparison_period: null,
        indices_config: null,
        result: null,
      }
      // keep tol empty
      payload['tol_selections'] = []
      const res = await fetch(`/api/v1/cases/${createdCaseId}/wizard-v2`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.text()
        setError(`Salvataggio wizard-v2 fallito (${res.status}): ${body.slice(0, 300)}`)
        return
      }
      const id = createdCaseId
      resetCreateForm()
      navigate(`/cases/${id}/wizard-v2`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const confirmPathChoice = () => {
    if (!createdCaseId) return
    const id = createdCaseId
    const choice = pathChoice
    resetCreateForm()
    if (choice === 'rapido') navigate(`/cases/${id}/wizard-v2`)
    else navigate(`/cases/${id}/wizard/1`)
  }

  const continueWizard = async (caseId: string, currentStep: number) => {
    if (currentStep <= 1) {
      // for draft/just started, the card click falls back to detail where user can choose;
      // but if triggered programmatically, default to V2? We route to detail to let choose.
      navigate(`/cases/${caseId}`)
      return
    }
    try {
      const res = await fetch(`/api/v1/cases/${caseId}/wizard-v2`)
      if (res.ok) {
        const body = await res.json() as Record<string, unknown>
        const state = body['state'] as Record<string, unknown> | undefined
        const step = state?.['current_step']
        if (typeof step === 'number' && step > 1) {
          navigate(`/cases/${caseId}/wizard-v2`)
          return
        }
      }
    } catch {
      // ignore, fallback to V1
    }
    navigate(`/cases/${caseId}/wizard/${currentStep}`)
  }

  const formatPreviewValue = (v: unknown): string => {
    if (v == null || v === '') return '— non trovato'
    if (typeof v === 'number') {
      // importo: format as euro
      return `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    return String(v)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>Pratiche</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {draftsCount > 0 && (
            <button
              onClick={deleteDrafts}
              disabled={deletingDrafts}
              style={{
                padding: '10px 20px', background: 'var(--color-bg-card)', color: 'var(--color-text-error)',
                border: '1px solid var(--color-border-error)', borderRadius: 8, fontSize: 14, fontWeight: 600,
                cursor: deletingDrafts ? 'wait' : 'pointer',
              }}
            >
              {deletingDrafts ? 'Eliminazione...' : `Elimina bozze (${draftsCount})`}
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            style={{
              padding: '10px 20px', background: 'var(--color-primary)', color: 'var(--color-primary-text)',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Nuova pratica
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'var(--color-bg-error)', color: 'var(--color-text-error)', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{
        position: 'relative', marginBottom: 20,
      }}>
        <svg style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--color-text-light)', pointerEvents: 'none',
        }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          placeholder="Cerca per testo, CIG, operatore economico..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            width: '100%', padding: '12px 12px 12px 40px', border: '1px solid var(--color-border)',
            borderRadius: 8, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
            outline: 'none', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-light)',
              fontSize: 16, padding: '4px 8px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {showCreate && (
        <div style={{
          background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 24,
          boxShadow: '0 1px 3px var(--color-shadow)',
          border: '1px solid var(--color-border)',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 0, color: 'var(--color-text-primary)' }}>Nuova pratica</h2>
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

          {/* Upload facoltativo */}
          <div style={{
            marginTop: 16, marginBottom: 8, padding: 16, borderRadius: 10,
            border: '1px dashed var(--color-border)', background: 'var(--color-bg-hover)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
              Hai un documento del contratto? <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(facoltativo)</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Carica determina, bando o contratto — estraiamo CIG, importo, durata, CPV per te. Nessun dato viene salvato senza la tua conferma.
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 8,
              cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)',
            }}>
              <span style={{ fontSize: 18 }}>📄</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {uploadFile ? uploadFile.name : 'Carica PDF o DOCX (max 20 MB)'}
              </span>
              <span style={{
                padding: '6px 12px', background: 'var(--color-primary)', color: 'var(--color-primary-text)',
                borderRadius: 6, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
              }}>
                {uploadFile ? 'Cambia file' : 'Sfoglia'}
              </span>
              <input
                type="file"
                accept=".pdf,.docx"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0] || null
                  if (f && f.size > 20 * 1024 * 1024) {
                    setExtractError('File troppo grande (limite 20 MB).')
                    setUploadFile(null)
                    e.target.value = ''
                    return
                  }
                  setExtractError('')
                  setUploadFile(f)
                }}
              />
            </label>
            {uploadFile && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1 }}>
                  {(uploadFile.size / 1024 / 1024).toFixed(2)} MB — verrà analizzato alla creazione
                </span>
                <button
                  onClick={() => setUploadFile(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-text-error)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >
                  Rimuovi
                </button>
              </div>
            )}
            {extractError && showCreate && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-error)' }}>{extractError}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <button
              onClick={create}
              disabled={creating || extractLoading || !title.trim()}
              style={{
                ...btnStyle,
                opacity: (creating || extractLoading || !title.trim()) ? 0.6 : 1,
                cursor: (creating || extractLoading) ? 'wait' : 'pointer',
              }}
            >
              {extractLoading ? 'Analizzo documento…' : creating ? 'Creo pratica…' : uploadFile ? 'Crea e analizza' : 'Crea e apri'}
            </button>
            <button
              onClick={closeCreateModal}
              disabled={creating || extractLoading}
              style={{ ...btnStyle, background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)', opacity: (creating || extractLoading) ? 0.5 : 1 }}
            >
              Annulla
            </button>
            {extractLoading && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>Estrazione in corso…</span>}
          </div>
        </div>
      )}

      {/* Modal preview dati trovati */}
      {showExtractPreview && extractPreview && createdCaseId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }}>
          <div style={{
            background: 'var(--color-bg-card)', borderRadius: 12, padding: 24, maxWidth: 560, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, color: 'var(--color-text-primary)' }}>Dati trovati nel documento</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 16, lineHeight: 1.4 }}>
              Abbiamo estratto questi campi. Conferma prima di salvare — puoi sempre correggere nei passi successivi.
            </p>
            <div style={{
              display: 'grid', gap: 8, fontSize: 13, background: 'var(--color-bg-hover)', padding: 16, borderRadius: 8,
              border: '1px solid var(--color-border)', marginBottom: 16,
            }}>
              {([
                ['Ente', extractPreview['ente']],
                ['CIG', extractPreview['cig']],
                ['Importo', (() => {
                  const v = extractPreview['importo_complessivo']
                  if (v == null || v === '') return '— non trovato'
                  if (typeof v === 'number') return `€ ${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  return formatPreviewValue(v)
                })()],
                ['Durata', (() => {
                  const v = extractPreview['durata_mesi']
                  if (v == null || v === '') return '— non trovato'
                  return `${String(v)} mesi`
                })()],
                ['CPV', (() => {
                  const v = extractPreview['cpv_primary'] ?? extractPreview['cpv']
                  if (v == null || v === '') return '— non trovato'
                  return String(v)
                })()],
                ['Oggetto', extractPreview['oggetto'] ?? extractPreview['object_description']],
              ] as Array<[string, unknown]>).map(([label, val]) => (
                <div key={label} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ width: 90, color: 'var(--color-text-muted)', fontWeight: 600, flexShrink: 0 }}>{label}:</span>
                  <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>{formatPreviewValue(val)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={acceptExtract}
                style={{ ...btnStyle, width: '100%', background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}
              >
                ✅ Usa questi dati — avvia percorso rapido (5 passi)
              </button>
              <button
                onClick={() => {
                  const id = createdCaseId
                  resetCreateForm()
                  navigate(`/cases/${id}/wizard/1`)
                }}
                style={{ ...btnStyle, width: '100%', background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                ↗️ No, preferisco il percorso completo (7 passi)
              </button>
              <button
                onClick={() => {
                  // chiude preview senza navigare — pratica resta in bozza
                  setShowExtractPreview(false)
                  setExtractPreview(null)
                  setCreatedCaseId(null)
                  setUploadFile(null)
                }}
                style={{ ...btnStyle, width: '100%', background: 'none', color: 'var(--color-text-muted)', border: 'none' }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal scelta percorso quando nessun file o extract vuoto/fallito */}
      {showPathChoice && createdCaseId && !showExtractPreview && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
        }}>
          <div style={{
            background: 'var(--color-bg-card)', borderRadius: 12, padding: 24, maxWidth: 520, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, color: 'var(--color-text-primary)' }}>Scegli il percorso</h2>
            {extractError && (
              <div style={{ marginBottom: 12, padding: 10, background: 'var(--color-bg-warning)', color: 'var(--color-text-warning)', borderRadius: 8, fontSize: 13 }}>
                {extractError}
              </div>
            )}
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.4 }}>
              Due modi per arrivare al calcolo. Scegli quello più adatto a questa pratica.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              <label style={{
                display: 'flex', gap: 12, padding: 14, borderRadius: 10,
                border: pathChoice === 'rapido' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: pathChoice === 'rapido' ? 'var(--color-bg-hover)' : 'var(--color-bg-card)',
                cursor: 'pointer',
              }}>
                <input
                  type="radio"
                  name="pathChoice"
                  checked={pathChoice === 'rapido'}
                  onChange={() => setPathChoice('rapido')}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
                    Consigliato: Percorso rapido — 5 passi
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Ideale per servizi e forniture standard. CPV, importo e periodi in pochi passaggi.
                  </div>
                </div>
              </label>
              <label style={{
                display: 'flex', gap: 12, padding: 14, borderRadius: 10,
                border: pathChoice === 'completo' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: pathChoice === 'completo' ? 'var(--color-bg-hover)' : 'var(--color-bg-card)',
                cursor: 'pointer',
              }}>
                <input
                  type="radio"
                  name="pathChoice"
                  checked={pathChoice === 'completo'}
                  onChange={() => setPathChoice('completo')}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
                    Percorso completo — 7 passi
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Per casi complessi o lavori: classificazione fine, TOL e indici compositi.
                  </div>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmPathChoice} style={{ ...btnStyle, flex: 1 }}>
                Crea e apri
              </button>
              <button
                onClick={() => {
                  setShowPathChoice(false)
                  setCreatedCaseId(null)
                }}
                style={{ ...btnStyle, background: 'var(--color-bg-hover)', color: 'var(--color-text-secondary)' }}
              >
                Annulla
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-light)', textAlign: 'center' }}>
              La pratica è già salvata in bozza — la ritrovi in elenco anche se annulli.
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--color-text-muted)' }}>Caricamento...</div>
      ) : cases.length === 0 ? (
        <div style={{
          background: 'var(--color-bg-card)', padding: 48, borderRadius: 12, textAlign: 'center',
          color: 'var(--color-text-light)',
        }}>
          Nessuna pratica. Creane una nuova per iniziare.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map(c => {
            const info = wizardV2Info[c.id]
            const isV2 = info?.isV2 ?? false
            const displayTotal = isV2 ? 5 : totalSteps
            const displayCurrent = isV2 ? (info?.v2Step ?? c.current_step) : c.current_step
            const isDraft = c.status === 'draft'
            return (
            <div
              key={c.id}
              onClick={() => {
                // Pratiche completate (o già al passo finale) → report visuale finale
                if (!isDraft || displayCurrent >= displayTotal) {
                  navigate(`/cases/${c.id}/report`)
                  return
                }
                if (displayCurrent > 1) {
                  if (isV2) navigate(`/cases/${c.id}/wizard-v2`)
                  else void continueWizard(c.id, c.current_step)
                } else {
                  navigate(`/cases/${c.id}`)
                }
              }}
              style={{
                background: 'var(--color-bg-card)', padding: '16px 20px', borderRadius: 10,
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', boxShadow: '0 1px 2px var(--color-shadow)',
                transition: 'box-shadow 0.15s', gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text-primary)' }}>{c.title}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {c.created_by && `${c.created_by} · `}{formatDate(c.created_at)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: c.status === 'completed' ? 'var(--color-bg-success)' : c.status === 'draft' ? 'var(--color-bg-warning)' : 'var(--color-bg-info)',
                  color: c.status === 'completed' ? 'var(--color-text-success)' : c.status === 'draft' ? 'var(--color-text-warning)' : 'var(--color-text-info)',
                }}>
                  {statusLabel(c.status)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-text-light)' }}>
                  Step {displayCurrent}/{displayTotal}
                </span>
                {isDraft ? (
                  displayCurrent <= 1 ? (
                  <>
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/cases/${c.id}/wizard-v2`) }}
                      title="Percorso rapido (5 passi)"
                      style={{
                        padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: 'var(--color-primary)', color: 'var(--color-primary-text)', border: 'none', cursor: 'pointer',
                      }}
                    >
                      Rapido (5 passi)
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); navigate(`/cases/${c.id}/wizard/1`) }}
                      title="Percorso completo (7 passi)"
                      style={{
                        padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer',
                      }}
                    >
                      Completo (7 passi)
                    </button>
                  </>
                  ) : (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (isV2) navigate(`/cases/${c.id}/wizard-v2`)
                      else void continueWizard(c.id, c.current_step)
                    }}
                    style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer',
                    }}
                  >
                    Continua wizard →
                  </button>
                  )
                ) : null}
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
                    background: 'transparent', color: 'var(--color-text-light)', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-error)'; e.currentTarget.style.background = 'var(--color-bg-error)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-light)'; e.currentTarget.style.background = 'transparent' }}
                >
                  Elimina
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 12px', marginBottom: 8,
  border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14,
  fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
}

const btnStyle: React.CSSProperties = {
  padding: '10px 20px', background: 'var(--color-primary)', color: 'var(--color-primary-text)',
  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
}
