import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, ReportResponse } from '../api/client'
import ReportV2View, { ReportData } from '../components/ReportV2View'
import { printArea } from '../utils/printReport'

export default function ReportView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [reportData, setReportData] = useState<Record<string, unknown> | null>(null)
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
    </div>
  )
}
