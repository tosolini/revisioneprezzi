import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, CalcResult, CaseDetail, IndexSeries } from '../api/client'
import FieldRenderer from '../components/FieldRenderer'
import CpvSearchModal from '../components/CpvSearchModal'
import ReportView from '../components/ReportView'
import ReportV2View from '../components/ReportV2View'

interface StepField {
  key: string
  label: string
  type: string
  required?: boolean
  options?: { value: string; label: string }[]
  warnings?: { condition: boolean; message: string }[]
  required_if?: { field: string; value: string; operator?: string }
}

interface StepConfig {
  step: number
  key: string
  title: string
  description: string
  fields: StepField[]
  auto_evaluate?: boolean
  evaluation_service?: string
}

interface SecondaryCpv {
  code: string
  description: string
  weight: number
}

export default function CaseWizard() {
  const { id, step: stepParam } = useParams()
  const navigate = useNavigate()
  const step = parseInt(stepParam || '1')

  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [stepConfig, setStepConfig] = useState<StepConfig | null>(null)
  const [allSteps, setAllSteps] = useState<StepConfig[]>([])
  const totalSteps = allSteps.length || 8
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [cpvModalOpen, setCpvModalOpen] = useState(false)
  const [secondaryCpvModalOpen, setSecondaryCpvModalOpen] = useState(false)
  const [secondaryCpvs, setSecondaryCpvs] = useState<SecondaryCpv[]>([])

  const [cpvIndices, setCpvIndices] = useState<IndexSeries[]>([])
  const [cpvDescription, setCpvDescription] = useState('')
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [calcError, setCalcError] = useState('')
  const [reportContent, setReportContent] = useState('')
  const [reportData, setReportData] = useState<any>(null)
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const style = document.createElement('style')
    style.id = '__print_style'
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #print-area, #print-area * { visibility: visible !important; }
        #print-area { position: absolute; left: 0; top: 0; width: 100%; }
        #root > div > nav { display: none !important; }
        button, .no-print { display: none !important; }
        @page { margin: 15mm; }
      }
    `
    document.head.appendChild(style)
    window.print()
    setTimeout(() => {
      const s = document.getElementById('__print_style')
      if (s) s.remove()
    }, 1000)
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError('')
    // Clear step-specific transient state on navigation
    setCpvIndices([])
    setCalcResult(null)
    setCalcError('')
    setReportContent('')
    setReportData(null)
    setWarnings([])
    // Fetch step 2 answers once for all steps (used for amount prefill in step 3)
    const step2Promise = api.wizard.get(id, 2).then(arr => {
      const map: Record<string, string> = {}
      arr.forEach(a => { map[a.field_key] = a.field_value || '' })
      return map
    }).catch((): Record<string, string> => ({}))

    Promise.all([
      api.cases.get(id),
      fetch('/api/v1/wizard/config').then(r => r.json()),
      api.wizard.get(id, step).then(arr => {
        const map: Record<string, string> = {}
        arr.forEach(a => { map[a.field_key] = a.field_value || '' })
        return map
      }).catch((): Record<string, string> => ({})),
      // Fetch CPV from step 3 for classification at steps 4+
      api.wizard.get(id, 3).then(arr => {
        const map: Record<string, string> = {}
        arr.forEach(a => { map[a.field_key] = a.field_value || '' })
        return map
      }).catch((): Record<string, string> => ({})),
      // Fetch family from step 4 for index selection at step 5+
      api.wizard.get(id, 4).then(arr => {
        const map: Record<string, string> = {}
        arr.forEach(a => { map[a.field_key] = a.field_value || '' })
        return map
      }).catch((): Record<string, string> => ({})),
      step2Promise,
    ]).then(([c, config, saved, step3Saved, step4Saved, step2Saved]) => {
      setCaseData(c)
      setAllSteps(config.steps || [])
      setSavedAnswers(saved)
      setAnswers({ ...saved })

      // Prefill ente from user settings if not already saved
      if (step === 1 && !saved['ente']) {
        const deviceId = localStorage.getItem('device_id')
        if (deviceId) {
          fetch(`/api/v1/settings?device_id=${encodeURIComponent(deviceId)}`)
            .then(r => r.json())
            .then(data => {
              const prefilled = data.preferences?.prefilled_ente
              if (prefilled) {
                setAnswers(prev => ({ ...prev, ente: prefilled }))
              }
            })
            .catch(() => {})
        }
      }

      const sc = (config.steps || []).find((s: StepConfig) => s.step === step)
      setStepConfig(sc || null)

      // Use step3Saved for CPV lookups at later steps
      const cpv = saved['cpv_primary'] || step3Saved['cpv_primary']
      if (cpv) {
        fetch(`/api/v1/cpv/${encodeURIComponent(cpv)}`)
          .then(r => r.json())
          .then(data => { if (data.description) setCpvDescription(data.description) })
          .catch(() => {})
      }

      // Prefill cpv_total_amount from step 2 if not already set
      if (!saved['cpv_total_amount'] && !step3Saved['cpv_total_amount']) {
        const fromStep2 = step2Saved['amount_subject_to_revision'] || step2Saved['contract_amount_total'] || ''
        if (fromStep2) {
          setAnswers(prev => ({ ...prev, cpv_total_amount: fromStep2 }))
        }
      }

      // Parse secondary CPVs from saved answers
      const secCodes = (saved['cpv_secondary'] || step3Saved['cpv_secondary'] || '').split(',').map(s => s.trim()).filter(Boolean)
      const secWeights = (saved['cpv_secondary_weights'] || step3Saved['cpv_secondary_weights'] || '').split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
      const parsed: SecondaryCpv[] = []
      for (let i = 0; i < secCodes.length; i++) {
        parsed.push({ code: secCodes[i], description: '', weight: secWeights[i] || 0 })
      }
      // Fetch descriptions for secondary CPVs
      if (parsed.length > 0) {
        fetch(`/api/v1/cpv/search?q=${encodeURIComponent(parsed[0].code)}`).then(r => r.json()).then((data: any) => {
          if (data.results) {
            const map = new Map<string, string>((data.results as any[]).map((r: any) => [r.code, r.description]))
            setSecondaryCpvs(prev => prev.map(s => ({ ...s, description: map.get(s.code) || s.description })))
          }
        }).catch(() => {})
      }
      setSecondaryCpvs(parsed)

      if (sc?.auto_evaluate && sc.evaluation_service === 'index_selection') {
        const cpv = saved['cpv_primary'] || step3Saved['cpv_primary']
        if (cpv) loadIndicesForCpv(cpv, saved['contract_type'] || step3Saved['contract_type'] || step2Saved['contract_type'])
      }
    }).catch(e => setError(e.message))
      .finally(() => {
        setLoading(false)
        // Step 6: auto-calculate
        if (step === 6) {
          Promise.all([
            api.wizard.get(id, 4).catch(() => []),
            api.wizard.get(id, 5).catch(() => []),
          ]).then(([step4, step5]) => {
            const s4: Record<string, string> = {}
            step4.forEach((a: any) => { s4[a.field_key] = a.field_value || '' })
            const s5: Record<string, string> = {}
            step5.forEach((a: any) => { s5[a.field_key] = a.field_value || '' })
            const seriesId = s4['selected_index_series_id']
            const basePeriod = s5['base_period']
            const compPeriod = s5['comparison_period']
            const amount = parseFloat(s5['amount_subject_to_revision'] || '0')
            if (seriesId && basePeriod && compPeriod && amount > 0) {
              setCalcError('')
              api.calculate({
                case_id: id, series_id: seriesId,
                base_period: basePeriod.includes('-') && basePeriod.length <= 7 ? `${basePeriod}-01` : basePeriod,
                comparison_period: compPeriod.includes('-') && compPeriod.length <= 7 ? `${compPeriod}-01` : compPeriod,
                amount,
              }).then(setCalcResult).catch((err: any) => {
                setCalcError(err?.message || 'Errore nel calcolo')
              })
            }
          })
        }
        // Step 7: auto-generate report with v2 endpoint
        if (step === 7) {
          // Load report v2 with structured sections
          fetch(`/api/v1/report/v2/cases/${id}`)
            .then(r => r.json())
            .then(reportData => {
              // Enrich report with calculation result if available
              if (calcResult) {
                const calcSection = reportData.sections?.find((s: any) => s.title === 'Risultato Calcolo')
                if (calcSection) {
                  // Calculate if threshold is exceeded
                  const threshold = calcResult.threshold_percent || 0
                  const variation = calcResult.variation_percent || 0
                  const thresholdExceeded = Math.abs(variation) > threshold
                  
                  calcSection.data = {
                    variation_percent: calcResult.variation_percent,
                    threshold_exceeded: thresholdExceeded,
                    revision_amount: calcResult.revision_amount || 0,
                    revision_type: (calcResult.revision_amount || 0) > 0 ? 'aumento' : (calcResult.revision_amount || 0) < 0 ? 'decurtazione' : null,
                    formula_steps: calcResult.steps || []
                  }
                }
              }
              setReportData(reportData)
            })
            .catch((err: any) => {
              console.error('Error loading report v2:', err)
              // Fallback to old report method
              api.report(id)
                .then(r => setReportContent(r.report))
                .catch((err: any) => setError(err?.message || 'Errore generazione report'))
            })
        }
      })
  }, [id, step])

  const loadIndicesForCpv = useCallback(async (cpv: string, contractType?: string) => {
    if (!cpv) return
    try {
      const r = await api.indices.forCpv(cpv, contractType)
      setCpvIndices(r.candidates)
      setWarnings(r.warnings)
      setStepConfig(prev => {
        if (!prev) return prev
        return {
          ...prev,
          fields: prev.fields.map(f =>
            f.key === 'selected_index_series_id'
              ? { ...f, options: r.candidates.map((s: any) => ({ value: s.id, label: s.name })) }
              : f
          ),
        }
      })
      if (!r.requires_human_intervention && r.candidates.length > 0) {
        setAnswers(prev => {
          if (prev.selected_index_series_id && r.candidates.some((s: any) => s.id === prev.selected_index_series_id)) {
            return prev
          }
          return { ...prev, selected_index_series_id: r.candidates[0].id }
        })
      }
    } catch { /* ignore */ }
  }, [])

  const handleFieldChange = (key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }))

    if (key === 'cpv_primary') {
      setCpvDescription('')
      if (value) {
        fetch(`/api/v1/cpv/${encodeURIComponent(value)}`)
          .then(r => r.json())
          .then(data => { if (data.description) setCpvDescription(data.description) })
          .catch(() => {})
      }
    }
    if (key === 'selected_index_series_id' && step === 4 && value) {
      setCpvIndices(prev => prev)
      setWarnings([])
    }
  }

  const saveStep = async () => {
    if (!id || !stepConfig) return
    setSaving(true)
    setError('')
    try {
      const allAnswers = { ...answers }
      if (secondaryCpvs.length > 0) {
        allAnswers['cpv_secondary'] = secondaryCpvs.map(s => s.code).join(',')
        allAnswers['cpv_secondary_weights'] = secondaryCpvs.map(s => s.weight).join(',')
      }
      const answersArr = stepConfig.fields
        .filter(f => allAnswers[f.key] !== undefined)
        .map(f => ({ step, field_key: f.key, field_value: String(allAnswers[f.key] ?? '') }))
      for (const s of secondaryCpvs) {
        answersArr.push({ step, field_key: 'cpv_secondary', field_value: s.code })
      }
      if (secondaryCpvs.length > 0) {
        answersArr.push({ step, field_key: 'cpv_secondary_weights', field_value: secondaryCpvs.map(s => s.weight).join(',') })
      }
      await api.wizard.save(id, step, answersArr)
      setSavedAnswers({ ...allAnswers })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    await saveStep()
    if (error) return
    if (step >= totalSteps) {
      if (id) await api.cases.update(id, { status: 'completed' as string }).catch(() => {})
      navigate(`/cases`)
    } else {
      navigate(`/cases/${id}/wizard/${step + 1}`)
    }
  }

  const goPrev = () => {
    if (step > 1) navigate(`/cases/${id}/wizard/${step - 1}`)
    else navigate(`/cases/${id}`)
  }

  const goStep = (s: number) => {
    navigate(`/cases/${id}/wizard/${s}`)
  }

  if (loading) {
    return <div style={{ color: '#6b7280', padding: 24 }}>Caricamento step...</div>
  }

  if (!stepConfig) {
    return <div style={{ color: '#c0392b', padding: 24 }}>Configurazione step non trovata.</div>
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Step indicator */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        justifyContent: 'center',
      }}>
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map(s => (
          <button
            key={s}
            onClick={() => goStep(s)}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none',
              background: s === step ? '#1a1a2e' : s < step ? '#d1fae5' : '#e5e7eb',
              color: s === step ? '#fff' : s < step ? '#065f46' : '#9ca3af',
              fontWeight: 700, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Step title + description */}
      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{stepConfig.title}</h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>{stepConfig.description}</p>
      </div>

      {/* Warnings */}
      {warnings.map((w, i) => (
        <div key={i} style={{
          padding: '12px 16px', background: '#fef3c7', color: '#92400e',
          borderRadius: 8, marginBottom: 16, fontSize: 14,
        }}>
          ⚠ {w}
        </div>
      ))}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', background: '#fde8e8', color: '#c0392b',
          borderRadius: 8, marginBottom: 16, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Indices for CPV — only on step 4 */}
      {cpvIndices.length > 0 && step === 4 && (
        <div style={{
          background: '#f0fdf4', padding: 16, borderRadius: 8, marginBottom: 16,
          border: '1px solid #bbf7d0',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Indici ISTAT disponibili per il CPV inserito
          </div>
          {cpvIndices.map(s => (
            <div key={s.id} style={{
              padding: '8px 0', fontSize: 13, borderBottom: '1px solid #e5e7eb',
            }}>
              <strong>{s.name}</strong>
              <span style={{ color: '#6b7280', marginLeft: 8 }}>({s.id})</span>
              {s.frequency && <span style={{ color: '#9ca3af', marginLeft: 4 }}>— {s.frequency}</span>}
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            Seleziona l'indice desiderato dal menu a tendina qui sotto.
          </div>
        </div>
      )}

      {/* Form fields */}
      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        {stepConfig.fields.length === 0 && stepConfig.auto_evaluate && (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: 24 }}>
            Questo step viene elaborato automaticamente dal sistema.
          </div>
        )}

        {stepConfig.fields
          .filter(f => {
            if (f.key === 'cpv_secondary' || f.key === 'cpv_secondary_weights') return false
            if (step === 3 && (f.key === 'cpv_total_amount')) return false
            if (!f.required_if) return true
            const dep = answers[f.required_if.field]
            if (f.required_if.operator === '>') {
              return parseFloat(dep || '0') > parseFloat(f.required_if.value)
            }
            return dep === f.required_if.value
          })
          .map(field => {
            if (field.key === 'cpv_primary') {
              return (
                <div key={field.key} style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                    {field.label}
                    {field.required && <span style={{ color: '#c0392b' }}> *</span>}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={answers['cpv_primary'] || ''}
                      onChange={e => handleFieldChange('cpv_primary', e.target.value)}
                      placeholder="es. 90910000-9"
                      style={{
                        flex: 1, padding: '10px 14px', fontSize: 14, fontFamily: 'monospace',
                        border: '1px solid #d1d5db', borderRadius: 8, outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setCpvModalOpen(true)}
                      style={{
                        padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: '#1a1a2e', color: '#fff', cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                    >
                      Cerca CPV
                    </button>
                  </div>
                  {cpvDescription && (
                    <div style={{
                      marginTop: 6, fontSize: 13, color: '#6b7280', fontStyle: 'italic',
                      padding: '6px 10px', background: '#f9fafb', borderRadius: 6,
                      borderLeft: '3px solid #1a1a2e',
                    }}>
                      {cpvDescription}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <FieldRenderer
                key={field.key}
                field={field}
                value={answers[field.key] !== undefined ? String(answers[field.key]) : ''}
                onChange={handleFieldChange}
              />
            )
          })}

        {/* Step 3: CPV total amount + secondary CPVs */}
        {stepConfig.step === 3 && (
          <div>
            {/* Total amount */}
            <div style={{
              padding: 16, background: '#f0fdf4', borderRadius: 8, marginBottom: 16,
              border: '1px solid #bbf7d0',
            }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                Importo complessivo CPV (€) <span style={{ color: '#c0392b' }}>*</span>
              </label>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                Precaricato dall'importo assoggettabile a revisione (step 2). Modificabile.
              </div>
              <input
                type="number"
                step="0.01"
                min={0}
                value={answers['cpv_total_amount'] || ''}
                onChange={e => handleFieldChange('cpv_total_amount', e.target.value)}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 16, fontWeight: 700,
                  fontFamily: 'monospace', border: '1px solid #86efac', borderRadius: 8,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* CPV distribution */}
            {(answers['cpv_primary'] || secondaryCpvs.length > 0) && (() => {
              const total = parseFloat(answers['cpv_total_amount'] || '0')
              const totalSec = secondaryCpvs.reduce((s, c) => s + c.weight, 0)
              const primaryWeight = Math.max(0, 100 - totalSec)
              const primaryAmount = total * (primaryWeight / 100)

              return (
                <div style={{
                  padding: 16, background: '#f9fafb', borderRadius: 8, marginBottom: 16,
                  border: '1px solid #e5e7eb',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 12 }}>
                    Distribuzione importo per CPV
                  </div>

                  {/* Primary CPV */}
                  {answers['cpv_primary'] && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                      borderBottom: secondaryCpvs.length > 0 ? '1px solid #e5e7eb' : 'none',
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#1a1a2e', minWidth: 110 }}>
                        {answers['cpv_primary']}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: '#6b7280' }}>
                        {cpvDescription || 'CPV principale'}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', minWidth: 50, textAlign: 'right' }}>
                        {primaryWeight.toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 110, textAlign: 'right', color: '#166534' }}>
                        € {total > 0 ? primaryAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </span>
                    </div>
                  )}

                  {/* Secondary CPVs */}
                  {secondaryCpvs.map((sec, i) => {
                    const secAmount = total * (sec.weight / 100)
                    return (
                      <div key={sec.code} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                        borderBottom: i < secondaryCpvs.length - 1 ? '1px solid #e5e7eb' : 'none',
                      }}>
                        <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#1a1a2e', minWidth: 110 }}>
                          {sec.code}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sec.description || '—'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 110, justifyContent: 'flex-end' }}>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={sec.weight}
                            onChange={e => {
                              const val = parseFloat(e.target.value) || 0
                              const clamped = Math.min(100, Math.max(0, val))
                              setSecondaryCpvs(prev => prev.map((s, j) => j === i ? { ...s, weight: clamped } : s))
                            }}
                            style={{
                              width: 55, padding: '4px 6px', fontSize: 13, textAlign: 'center',
                              border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'monospace',
                            }}
                          />
                          <span style={{ fontSize: 13, color: '#6b7280' }}>%</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 110, textAlign: 'right', color: '#166534' }}>
                          € {total > 0 ? secAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSecondaryCpvs(prev => prev.filter((_, j) => j !== i))}
                          style={{
                            padding: '4px 8px', borderRadius: 4, border: 'none',
                            background: '#fee2e2', color: '#c0392b', cursor: 'pointer', fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}

                  {/* Add secondary button */}
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => setSecondaryCpvModalOpen(true)}
                      style={{
                        padding: '6px 14px', borderRadius: 6, border: '1px dashed #d1d5db',
                        background: 'transparent', color: '#374151', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, width: '100%',
                      }}
                    >
                      + Aggiungi CPV secondario
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Weight warning */}
            {(() => {
              const totalSec = secondaryCpvs.reduce((s, c) => s + c.weight, 0)
              if (totalSec > 100) {
                return (
                  <div style={{
                    padding: '8px 12px', background: '#fef2f2', color: '#c0392b',
                    borderRadius: 8, fontSize: 13, border: '1px solid #fecaca', marginBottom: 16,
                  }}>
                    Errore: la somma dei pesi secondari ({totalSec}%) supera il 100%.
                    Riduci i valori per non superare il totale.
                  </div>
                )
              }
              if (secondaryCpvs.length > 0 && totalSec < 100) {
                return (
                  <div style={{
                    padding: '8px 12px', background: '#fefce8', color: '#854d0e',
                    borderRadius: 8, fontSize: 13, border: '1px solid #fef08a', marginBottom: 16,
                  }}>
                    CPV principale: {Math.max(0, 100 - totalSec).toFixed(0)}% · CPV secondari: {totalSec.toFixed(0)}% · Il restante {100 - totalSec}% sar&agrave; attribuito al CPV principale.
                  </div>
                )
              }
              if (secondaryCpvs.length > 0 && totalSec === 100) {
                return (
                  <div style={{
                    padding: '8px 12px', background: '#f0fdf4', color: '#166534',
                    borderRadius: 8, fontSize: 13, border: '1px solid #bbf7d0', marginBottom: 16,
                  }}>
                    Distribuzione corretta: 100% dei pesi assegnato ai CPV secondari.
                  </div>
                )
              }
              return null
            })()}
          </div>
        )}

        {/* Step 6: auto-calculation result */}
        {stepConfig.evaluation_service === 'calculation' && (
          <div>
            {!calcResult && !calcError && (
              <div style={{ color: '#6b7280', textAlign: 'center', padding: 24 }}>
                Calcolo in corso...
              </div>
            )}
            {calcError && (
              <div style={{
                background: '#fef2f2', padding: 16, borderRadius: 8, marginBottom: 16,
                border: '1px solid #fecaca',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: '#991b1b' }}>
                  Errore calcolo
                </div>
                <div style={{ fontSize: 13, color: '#b91c1c', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{calcError}</div>
              </div>
            )}
            {calcResult && (
              <div style={{
                background: '#f0fdf4', padding: 16, borderRadius: 8, marginBottom: 16,
                border: '1px solid #bbf7d0',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
                  Riepilogo calcolo
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><strong>Variazione:</strong> {calcResult.variation_percent?.toFixed(2)}%</div>
                  <div><strong>Soglia:</strong> {calcResult.threshold_percent?.toFixed(2)}%</div>
                  <div><strong>Eccedenza:</strong> {calcResult.excess_percent?.toFixed(2)}%</div>
                  <div><strong>Importo revisione:</strong> € {calcResult.revision_amount?.toFixed(2)}</div>
                </div>
                {calcResult.steps && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Passaggi:</div>
                    {calcResult.steps.map((s, i) => (
                      <div key={i} style={{
                        padding: '6px 8px', marginBottom: 4, background: '#fff',
                        borderRadius: 4, fontSize: 12, border: '1px solid #e5e7eb',
                      }}>
                        <strong>{s.description}</strong>
                        <div style={{ color: '#6b7280' }}>{s.formula} = {s.result}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 7: structured report v2 */}
        {step === 7 && (
          <div id="print-area" ref={printRef}>
            {reportData ? (
              <ReportV2View reportData={reportData} />
            ) : reportContent ? (
              <ReportView report={reportContent} calcResult={calcResult} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                <p>Caricamento report...</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', gap: 12,
      }}>
        <button onClick={goPrev} style={navBtnStyle}>
          ← {step === 1 ? 'Torna alla dashboard' : 'Step precedente'}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          {step === 7 && (
            <button onClick={handlePrint} className="no-print" style={{
              padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db',
              background: '#f9fafb', color: '#374151', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
            }}>
              Stampa / PDF
            </button>
          )}
          <button onClick={goNext} style={{ ...navBtnStyle, background: '#1a1a2e', color: '#fff' }}>
            {saving ? 'Salvataggio...' : step >= totalSteps ? 'Completa' : 'Salva e continua →'}
          </button>
        </div>
      </div>

      <CpvSearchModal
        open={cpvModalOpen}
        onClose={() => setCpvModalOpen(false)}
        onSelect={(code, _desc) => {
          handleFieldChange('cpv_primary', code)
          setCpvModalOpen(false)
        }}
      />

      <CpvSearchModal
        open={secondaryCpvModalOpen}
        onClose={() => setSecondaryCpvModalOpen(false)}
        onSelect={(code, desc) => {
          setSecondaryCpvs(prev => {
            if (prev.some(s => s.code === code)) return prev
            const remaining = 100 - prev.reduce((s, c) => s + c.weight, 0)
            const weight = prev.length === 0 ? Math.min(remaining, 100) : 0
            return [...prev, { code, description: desc, weight }]
          })
          setSecondaryCpvModalOpen(false)
        }}
      />
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db',
  background: '#fff', color: '#374151', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}
