import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, ReportResponse } from '../api/client'
import ReportV2View, { ReportData } from '../components/ReportV2View'
import { cycleStatusLabel } from '../components/utils'
import { printArea } from '../utils/printReport'

export default function ReportView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null)
  const [planData, setPlanData] = useState<any>(null)
  const [cycles, setCycles] = useState<any[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState<string>('')
  const [cycleAmount, setCycleAmount] = useState<number>(0)
  const [cycleBusy, setCycleBusy] = useState(false)
  const [approveModalOpen, setApproveModalOpen] = useState(false)
  const [approveName, setApproveName] = useState('')
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [reopenMotivation, setReopenMotivation] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfState, setPdfState] = useState<{ status: 'idle' | 'loading' | 'error'; message?: string }>({ status: 'idle' })
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    printArea('print-area-report')
  }

  const handlePdfDownload = async () => {
    if (!reportData) return
    setPdfState({ status: 'loading' })
    try {
      const { downloadReportPdf } = await import('../utils/reportPdf')
      await downloadReportPdf(reportData as unknown as ReportData, `report-revisione-${id || 'pratica'}.pdf`)
      setPdfState({ status: 'idle' })
    } catch (e: unknown) {
      setPdfState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const loadCycles = async () => {
    if (!id) return
    try {
      const pr = await fetch(`/api/v1/cases/${id}/revision-plan`)
      const pj = await pr.json()
      setPlanData(pj.plan || null)
      const cr = await fetch(`/api/v1/cases/${id}/cycles`)
      const cj = await cr.json()
      const list = cj.cycles || []
      setCycles(list)
      // importo base della pratica (per pre-compilare i cicli non ancora valorizzati)
      let baseAmount = 0
      try {
        const wr = await fetch(`/api/v1/cases/${id}/wizard-v2`)
        if (wr.ok) {
          const wj = await wr.json()
          const st = (wj && wj.state) || {}
          baseAmount = Number(st.amount) || 0
        }
      } catch { /* ignore */ }
      if (list.length > 0 && !selectedCycleId) {
        const firstOpen = list.find((c: any) => c.status !== 'approved') || list[0]
        setSelectedCycleId(firstOpen.id)
        setCycleAmount(firstOpen.amount != null ? firstOpen.amount : baseAmount)
      }
      // aggiorna l'importo del ciclo selezionato se non valorizzato
      const sel = list.find((c: any) => c.id === selectedCycleId)
      if (sel && sel.amount == null && baseAmount > 0) setCycleAmount(baseAmount)
    } catch (e) {
      console.warn('Caricamento cicli fallito', e)
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      // Prova prima il report visuale V2 (passo 5/7 ben strutturato per amministrativi)
      try {
        const res = await fetch(`/api/v1/report/v2/cases/${id}`)
        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>
          if (data && Array.isArray((data as { sections?: unknown[] }).sections)) {
            if (!cancelled) {
              setReportData(data)
              setLoading(false)
            }
            return
          }
        }
      } catch {
        // ignora, fallback a markdown
      }
      // Fallback: report markdown classico (V1)
      try {
        const md = await api.report(id)
        if (!cancelled) setReport(md)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    void loadCycles()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <div style={{ color: 'var(--color-text-muted)', padding: 24 }}>Generazione report...</div>
  if (error) return <div style={{ color: 'var(--color-text-error)', padding: 24 }}>{error}</div>

  const hasVisual = !!reportData

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {hasVisual ? (
        <div id="print-area-report" ref={printRef}>
          <ReportV2View reportData={reportData as unknown as ReportData} />
        </div>
      ) : (
        <div
          id="print-area-report"
          ref={printRef}
          style={{
            background: 'var(--color-bg-card)', padding: 32, borderRadius: 12,
            boxShadow: '0 1px 3px var(--color-shadow)', fontFamily: 'monospace',
            fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
            overflow: 'auto', maxHeight: '80vh',
          }}
        >
          {report?.report || 'Nessun report generato.'}
        </div>
      )}

      {!hasVisual && report && (
        <p style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-light)', textAlign: 'center' }} className="no-print">
          Report testuale — per il riepilogo visuale completa il wizard fino al passo finale (5 o 7) e usa Stampa.
        </p>
      )}

      {planData && cycles.length > 0 && (
        <div className="no-print" style={{ marginTop: 24, padding: '14px 16px', borderRadius: 10, border: '1px solid var(--color-border-light)', background: 'var(--color-bg-muted)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Cicli di revisione ({planData.frequency})</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <select
              value={selectedCycleId}
              onChange={async e => {
                const c = cycles.find((x: any) => x.id === e.target.value)
                setSelectedCycleId(e.target.value)
                setCycleAmount(c?.amount != null ? c.amount : cycleAmount)
                try {
                  const rr = await fetch(`/api/v1/report/v2/cases/${id}?cycle=${e.target.value}`)
                  if (rr.ok) setReportData(await rr.json())
                } catch { /* ignore */ }
              }}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)' }}
            >
              {cycles.map((c: any) => (
                <option key={c.id} value={c.id}>#{c.sequence_no} — {c.comparison_period?.slice(0,7)} ({cycleStatusLabel(c.status)})</option>
              ))}
            </select>
            {(() => {
              const c = cycles.find((x: any) => x.id === selectedCycleId)
              if (!c) return null
              return (
                <>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Stato: <strong>{cycleStatusLabel(c.status)}</strong></span>
                  {c.status !== 'approved' && (
                    <>
                      <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Importo periodo €</label>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={cycleAmount || ''}
                        onChange={e => setCycleAmount(parseFloat(e.target.value) || 0)}
                        style={{ width: 120, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)' }}
                      />
                      <button
                        disabled={cycleBusy}
                        onClick={async () => {
                          setCycleBusy(true)
                          try {
                            const res = await fetch(`/api/v1/cases/${id}/cycles/${selectedCycleId}/calculate`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ amount: cycleAmount }),
                            })
                            const j = await res.json()
                            if (!res.ok) throw new Error(j.detail || 'Errore calcolo')
                            await loadCycles()
                            const rr = await fetch(`/api/v1/report/v2/cases/${id}?cycle=${selectedCycleId}`)
                            if (rr.ok) setReportData(await rr.json())
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Errore')
                          } finally {
                            setCycleBusy(false)
                          }
                        }}
                        style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-primary-text)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, opacity: cycleBusy ? 0.6 : 1 }}
                      >Calcola</button>
                    </>
                  )}
                  {c.status === 'calculated' && (
                    <button
                      disabled={cycleBusy}
                      onClick={() => { setApproveName(''); setApproveModalOpen(true) }}
                      style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--color-bg-success)', color: 'var(--color-text-success)', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >Approva</button>
                  )}
                  {c.status === 'approved' && (
                    <button
                      disabled={cycleBusy}
                      onClick={() => { setReopenMotivation(''); setReopenModalOpen(true) }}
                      style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                    >Riapri</button>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      <div
        className="no-print"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 0 0',
          marginTop: 24,
          borderTop: '1px solid var(--color-border-lighter)',
        }}
      >
        <button
          onClick={() => navigate(`/cases/${id}`)}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--color-bg-card)',
            color: 'var(--color-text-secondary)',
            border: '1.5px solid var(--color-border)',
            cursor: 'pointer',
            transition: 'all 140ms',
          }}
        >
          ← Torna alla pratica
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handlePrint}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              background: 'var(--color-bg-card)',
              color: 'var(--color-text-secondary)',
              border: '1.5px solid var(--color-border)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span aria-hidden>🖨️</span> Stampa
          </button>
          {hasVisual && (
            <button
              onClick={() => void handlePdfDownload()}
              disabled={pdfState.status === 'loading'}
              title="Scarica il report in PDF"
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-secondary)',
                border: '1.5px dashed var(--color-border)',
                cursor: pdfState.status === 'loading' ? 'not-allowed' : 'pointer',
                opacity: pdfState.status === 'loading' ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span aria-hidden>📄</span> {pdfState.status === 'loading' ? 'Generazione…' : 'Scarica PDF'}
            </button>
          )}
          {pdfState.status === 'error' && (
            <span style={{ fontSize: 12, color: 'var(--color-text-error)', maxWidth: 320 }}>PDF non generato: {pdfState.message || 'errore'}</span>
          )}
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              background: 'var(--color-primary)',
              color: 'var(--color-primary-text)',
              border: '1.5px solid var(--color-primary)',
              cursor: 'pointer',
              boxShadow: '0 4px 12px var(--color-shadow)',
            }}
          >
            Dashboard
          </button>
        </div>
      </div>

      {approveModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, width: 360, boxShadow: '0 4px 20px var(--color-shadow)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Approva ciclo</h3>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Approvato da</label>
            <input
              autoFocus
              value={approveName}
              onChange={e => setApproveName(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setApproveModalOpen(false)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer' }}>Annulla</button>
              <button
                disabled={!approveName.trim() || cycleBusy}
                onClick={async () => {
                  setCycleBusy(true)
                  try {
                    await fetch(`/api/v1/cases/${id}/cycles/${selectedCycleId}/approve`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ approved_by: approveName.trim() }),
                    })
                    setApproveModalOpen(false)
                    await loadCycles()
                  } catch (e) { setError(e instanceof Error ? e.message : 'Errore') }
                  finally { setCycleBusy(false) }
                }}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--color-bg-success)', color: 'var(--color-text-success)', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: (!approveName.trim() || cycleBusy) ? 0.6 : 1 }}
              >Approva</button>
            </div>
          </div>
        </div>
      )}

      {reopenModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, width: 400, boxShadow: '0 4px 20px var(--color-shadow)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Riapri ciclo</h3>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Motivazione</label>
            <textarea
              autoFocus
              value={reopenMotivation}
              onChange={e => setReopenMotivation(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setReopenModalOpen(false)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', cursor: 'pointer' }}>Annulla</button>
              <button
                disabled={!reopenMotivation.trim() || cycleBusy}
                onClick={async () => {
                  setCycleBusy(true)
                  try {
                    await fetch(`/api/v1/cases/${id}/cycles/${selectedCycleId}/reopen`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ motivation: reopenMotivation.trim() }),
                    })
                    setReopenModalOpen(false)
                    await loadCycles()
                  } catch (e) { setError(e instanceof Error ? e.message : 'Errore') }
                  finally { setCycleBusy(false) }
                }}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 600, opacity: (!reopenMotivation.trim() || cycleBusy) ? 0.6 : 1 }}
              >Riapri</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
