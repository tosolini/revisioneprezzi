import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, CalcResult, CaseDetail, IndexSeries } from '../api/client'
import FieldRenderer from '../components/FieldRenderer'
import CpvSearchModal from '../components/CpvSearchModal'
import ReportView from '../components/ReportView'
import ReportV2View from '../components/ReportV2View'
import IndexWeightsEditor from '../components/IndexWeightsEditor'
import WizardTimeline from '../components/WizardTimeline'

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
// Etichetta in una parola per ogni step (timeline).
const STEP_TIMELINE_LABELS: Record<string, string> = {
  apertura_pratica: 'Pratica',
  inquadramento_contratto: 'Contratto',
  classificazione_cpv: 'CPV',
  selezione_indice: 'Indici',
  parametri_temporali: 'Periodi',
  calcolo: 'Calcolo',
  report_finale: 'Report',
}
const MONTH_NAMES_IT = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

const fmtEvMonth = (ym: string): string =>
  `${MONTH_NAMES_IT[parseInt(ym.slice(5, 7), 10)] || ''} ${ym.slice(0, 4)}`

const fmtEvMonths = (months: string[]): string =>
  months.length > 8
    ? months.slice(0, 6).map(fmtEvMonth).join(', ') + ` … e altri ${months.length - 6} mesi`
    : months.map(fmtEvMonth).join(', ')

interface SecondaryCpv {
  code: string
  description: string
  weight: number
}

interface MappingAssocV1 {
  index_type: string
  classification: string
  ateco_code: string
  description: string
  series_id: string | null
  available: boolean
}

interface ResolvedCpv {
  description: string
  series: IndexSeries[]
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
  const [tabellaDAssociations, setTabellaDAssociations] = useState<MappingAssocV1[]>([])
  const [multiCpvResolved, setMultiCpvResolved] = useState<Record<string, ResolvedCpv>>({})
  const [cpvDescription, setCpvDescription] = useState('')
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [calcError, setCalcError] = useState('')
  const [reportContent, setReportContent] = useState('')
  const [reportData, setReportData] = useState<any>(null)
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)
  // Copia automatica step 2: debounce per avere la cifra completa prima di copiare;
  // il follow si interrompe appena l'utente tocca manualmente il campo destinazione.
  const amountCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const amountManualEdited = useRef(false)

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
    return () => {
      if (amountCopyTimer.current) clearTimeout(amountCopyTimer.current)
    }
  }, [])

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
  const persistCalculation = async (result: unknown) => {
    if (!id) return
    try {
      await fetch(`/api/v1/report/v2/cases/${id}/calculation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      })
    } catch {
      // la persistenza è best-effort: non blocca la navigazione
    }
  }

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

      // Step 5: riporta data base (stipula), confronto (avvio esecuzione) e
      // importo assoggettabile dallo step 2, solo se lo step 5 è ancora vuoto.
      // I campi restano modificabili.
      if (step === 5) {
        const prefill: Record<string, string> = {}
        const stip = step2Saved['stipulation_date']
        const exec = step2Saved['execution_start_date']
        if (!saved['base_period'] && stip && stip.length >= 7) {
          prefill['base_period'] = stip.substring(0, 7)
        }
        if (!saved['comparison_period'] && exec && exec.length >= 7) {
          prefill['comparison_period'] = exec.substring(0, 7)
        }
        if (!saved['amount_subject_to_revision']) {
          const amount = step2Saved['amount_subject_to_revision'] || ''
          if (amount) prefill['amount_subject_to_revision'] = amount
        }
        if (Object.keys(prefill).length > 0) {
          setAnswers(prev => ({ ...prev, ...prefill }))
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
        const secCodesResolve = (saved['cpv_secondary'] || step3Saved['cpv_secondary'] || '')
          .split(',').map((s: string) => s.trim()).filter(Boolean)
        const ct = saved['contract_type'] || step3Saved['contract_type'] || step2Saved['contract_type']
        if (cpv) resolveIndexForCpv(cpv, ct, secCodesResolve.length > 0 ? secCodesResolve : undefined)
      }
    }).catch(e => setError(e.message))
      .finally(() => {
        setLoading(false)
        // Step 6: auto-calculate (V2: Tabella D, media ponderata variazioni)
        if (step === 6) {
          Promise.all([
            api.wizard.get(id, 3).catch(() => []),
            api.wizard.get(id, 4).catch(() => []),
            api.wizard.get(id, 5).catch(() => []),
          ]).then(async ([step3, step4, step5]) => {
            const s3: Record<string, string> = {}
            step3.forEach((a: any) => { s3[a.field_key] = a.field_value || '' })
            const s4: Record<string, string> = {}
            step4.forEach((a: any) => { s4[a.field_key] = a.field_value || '' })
            const s5: Record<string, string> = {}
            step5.forEach((a: any) => { s5[a.field_key] = a.field_value || '' })
            const basePeriod = s5['base_period']
            const compPeriod = s5['comparison_period']
            const amount = parseFloat(s5['amount_subject_to_revision'] || '0')
            const contractType = s3['contract_type'] || s4['contract_type'] || 'services'
            const cpvPrimary = s3['cpv_primary'] || ''
            const secCodes = (s3['cpv_secondary'] || '').split(',').map((s: string) => s.trim()).filter(Boolean)
            const secWeights = (s3['cpv_secondary_weights'] || '').split(',').map((s: string) => parseFloat(s.trim())).filter((n: number) => !isNaN(n))
            const bPeriod = basePeriod && basePeriod.includes('-') && basePeriod.length <= 7 ? `${basePeriod}-01` : basePeriod
            const cPeriod = compPeriod && compPeriod.includes('-') && compPeriod.length <= 7 ? `${compPeriod}-01` : compPeriod

            if (!cpvPrimary || !bPeriod || !cPeriod || amount <= 0) return
            setCalcError('')

            try {
              const ct = contractType === 'supply' ? 'supplies' : contractType === 'service' ? 'services' : contractType
              if (secCodes.length === 0) {
                // 1 CPV: config da step 4 (single o composite weighted_variations)
                const weightsRaw = s4['index_weights'] && s4['index_weights'].trim() ? s4['index_weights'] : ''
                let indicesConfig: { type: string; single_series_id?: string; method?: string; components?: Record<string, number> }
                if (weightsRaw) {
                  const parsed = JSON.parse(weightsRaw)
                  const total = Object.values(parsed).reduce((s: number, v: unknown) => s + (typeof v === 'number' ? v : 0), 0)
                  if (Math.abs(total - 100) > 0.01) throw new Error(`I pesi indici devono sommarsi a 100% (attuale: ${total.toFixed(2)}%)`)
                  indicesConfig = { type: 'composite', method: 'weighted_variations', components: parsed }
                } else if (s4['selected_index_series_id']) {
                  indicesConfig = { type: 'single', single_series_id: s4['selected_index_series_id'] }
                } else {
                  setCalcError('Nessun indice selezionato allo step 4')
                  return
                }
                const res = await fetch('/api/v1/calculation/v2/calculate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contract_type: ct, amount, base_period: bPeriod, comparison_period: cPeriod,
                    indices_config: indicesConfig,
                  }),
                })
                const body = await res.json()
                if (!res.ok) throw new Error(body.detail || 'Errore nel calcolo')
                setCalcResult(body)
                await persistCalculation(body)
              } else {
                // Multi-CPV (Art. 13): componenti con importo ripartito dai pesi CPV
                const secTotal = secWeights.reduce((s: number, w: number) => s + w, 0)
                const primaryWeight = Math.max(0, 100 - secTotal)
                const components: Array<{ amount: number; indices_config: any; description: string }> = []
                const buildConfig = async (cpv: string): Promise<any> => {
                  const mapping = await fetchCpvMapping(cpv)
                  if (mapping && mapping.table_class) {
                    const assocs = mapping.associations.filter(a => a.series_id)
                    if (assocs.length === 1) {
                      return { type: 'single', single_series_id: assocs[0].series_id }
                    }
                    if (mapping.table_class === 'D3' || assocs.length > 1) {
                      const componentsCfg: Record<string, number> = {}
                      const share = parseFloat((100 / assocs.length).toFixed(2))
                      assocs.forEach(a => { componentsCfg[a.series_id as string] = share })
                      return { type: 'composite', method: 'weighted_variations', components: componentsCfg }
                    }
                  }
                  const r = await api.indices.forCpv(cpv, contractType)
                  if (r.candidates.length > 0) return { type: 'single', single_series_id: r.candidates[0].id }
                  throw new Error(`Nessun indice risolto per ${cpv}`)
                }
                const primaryCfg = await buildConfig(cpvPrimary)
                components.push({ amount: amount * (primaryWeight / 100), indices_config: primaryCfg, description: cpvPrimary })
                for (let i = 0; i < secCodes.length; i++) {
                  const cfg = await buildConfig(secCodes[i])
                  components.push({ amount: amount * ((secWeights[i] || 0) / 100), indices_config: cfg, description: secCodes[i] })
                }
                const res = await fetch('/api/v1/calculation/v2/calculate/multi-component', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contract_type: ct, base_period: bPeriod, comparison_period: cPeriod, components,
                  }),
                })
                const body = await res.json()
                if (!res.ok) throw new Error(body.detail || 'Errore nel calcolo')
                setCalcResult(body)
                await persistCalculation(body)
              }
            } catch (err: any) {
              setCalcError(err?.message || 'Errore nel calcolo')
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

  const fetchCpvMapping = useCallback(async (cpv: string): Promise<{
    table_class: string | null
    associations: MappingAssocV1[]
  } | null> => {
    try {
      const res = await fetch('/api/v1/classify/cpv-index-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpv_code: cpv }),
      })
      if (!res.ok) return null
      const data = await res.json()
      const assocs: MappingAssocV1[] = (data.associations || []).map((a: any) => ({
        index_type: a.index_type,
        classification: a.classification,
        ateco_code: a.ateco_code,
        description: a.description,
        series_id: a.series_id ?? null,
        available: a.available,
      }))
      return { table_class: data.table_class || null, associations: assocs }
    } catch {
      return null
    }
  }, [])

  const mapAssocsToSeries = (assocs: MappingAssocV1[]): IndexSeries[] =>
    assocs
      .filter(a => a.series_id)
      .map(a => ({
        id: a.series_id as string,
        name: `${a.index_type} [${a.ateco_code}] ${a.description}`,
        source: 'Tabella D',
        normative_category: null,
        classification_ref: null,
        frequency: null,
      }))

  const resolveIndexForCpv = useCallback(async (cpv: string, contractType?: string, secondaryCodes?: string[]) => {
    if (!cpv) return
    const mapping = await fetchCpvMapping(cpv)

    // Multi-CPV: riepilogo per CPV (senza select unica)
    if (secondaryCodes && secondaryCodes.length > 0) {
      const codes = [cpv, ...secondaryCodes]
      const resolved: Record<string, ResolvedCpv> = {}
      for (const code of codes) {
        const m = await fetchCpvMapping(code)
        let series: IndexSeries[] = []
        if (m && m.table_class) {
          series = mapAssocsToSeries(m.associations)
        } else {
          const r = await api.indices.forCpv(code, contractType)
          series = r.candidates
        }
        resolved[code] = { description: '', series }
      }
      setMultiCpvResolved(resolved)
      return
    }

    // Single CPV: Tabella D → select + index_weights prefill
    if (mapping && mapping.table_class) {
      const series = mapAssocsToSeries(mapping.associations)
      setCpvIndices(series)
      setTabellaDAssociations(mapping.associations)
      setWarnings(mapping.associations.some(a => !a.available)
        ? ['Alcune serie associate non hanno dati disponibili (verificare l\'import SDMX/seed).']
        : [])
      setStepConfig(prev => {
        if (!prev) return prev
        return {
          ...prev,
          fields: prev.fields.map(f =>
            f.key === 'selected_index_series_id'
              ? { ...f, options: series.map(s => ({ value: s.id, label: s.name })) }
              : f
          ),
        }
      })
      const firstId = series[0]?.id
      if (firstId) {
        setAnswers(prev => ({ ...prev, selected_index_series_id: firstId }))
      }
      // D.2/D.3: prefill index_weights con pesi uguali 100/n
      if (mapping.table_class === 'D2' || mapping.table_class === 'D3') {
        const n = series.length
        if (n > 0) {
          const weights: Record<string, number> = {}
          series.forEach(s => { weights[s.id] = parseFloat((100 / n).toFixed(2)) })
          setAnswers(prev => ({ ...prev, index_weights: JSON.stringify(weights) }))
        }
      } else {
        setAnswers(prev => {
          const next = { ...prev }
          delete next.index_weights
          return next
        })
      }
      return
    }

    // CPV fuori Tabella D: candidati famiglia (Art. 11.4)
    const r = await api.indices.forCpv(cpv, contractType)
    setCpvIndices(r.candidates)
    setTabellaDAssociations([])
    setWarnings([...r.warnings, 'CPV non elencato in Tabella D: selezionare manualmente un indice (Art. 11.4).'])
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
    if (r.candidates.length > 0) {
      setAnswers(prev => {
        if (prev.selected_index_series_id && r.candidates.some((s: any) => s.id === prev.selected_index_series_id)) {
          return prev
        }
        return { ...prev, selected_index_series_id: r.candidates[0].id }
      })
    }
  }, [fetchCpvMapping])

  const handleFieldChange = (key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }))

    // Step 2: copia automatica da "Importo complessivo contrattuale" a
    // "Importo assoggettabile a revisione". Debounced (600ms) così la copia
    // avviene sulla cifra completa, non sulla prima cifra digitata. Il follow
    // continua finché l'utente non modifica manualmente il campo destinazione.
    if (step === 2 && key === 'contract_amount_total' && !amountManualEdited.current) {
      if (amountCopyTimer.current) clearTimeout(amountCopyTimer.current)
      amountCopyTimer.current = setTimeout(() => {
        setAnswers(prev => {
          if (amountManualEdited.current) return prev
          return { ...prev, amount_subject_to_revision: value }
        })
      }, 600)
    }
    // Il tocco manuale del destinatario ferma il follow (e lo riattiva se svuotato).
    if (step === 2 && key === 'amount_subject_to_revision') {
      amountManualEdited.current = value !== ''
    }

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

  const overrideActive = answers['index_override'] === 'true'
  const weightEditorActive = cpvIndices.length > 1 || !!answers['index_weights']

  // Forzatura Art. 11.5: indice singolo fuori dalla ponderazione Tabella D.
  const confirmOverride = () => {
    setAnswers(prev => {
      const next: Record<string, string> = { ...prev, index_override: 'true' }
      delete next.index_weights
      if (!next.selected_index_series_id && cpvIndices.length > 0) {
        next.selected_index_series_id = cpvIndices[0].id
      }
      return next
    })
    setOverrideModalOpen(false)
  }

  const revertOverride = () => {
    setAnswers(prev => {
      const next = { ...prev }
      delete next.index_override
      delete next.override_reason
      const n = cpvIndices.length
      if (n > 0) {
        const weights: Record<string, number> = {}
        cpvIndices.forEach(s => { weights[s.id] = parseFloat((100 / n).toFixed(2)) })
        next.index_weights = JSON.stringify(weights)
      } else {
        delete next.index_weights
      }
      return next
    })
  }

  // Blocco step 5: il periodo base deve precedere (o coincidere con) il confronto.
  const validateStep = (): string => {
    if (step === 5) {
      const base = (answers['base_period'] || '').trim()
      const comp = (answers['comparison_period'] || '').trim()
      if (base && comp && base > comp) {
        return 'Il periodo base (data aggiudicazione) deve essere antecedente o uguale al periodo di confronto (data rilevazione): con l\'ordine inverso la variazione risulterebbe col segno invertito. Correggi i periodi prima di continuare.'
      }
      return ''
    }
    // Blocco allo step 4: i pesi indici devono sommare a 100 prima di avanzare.
    if (step !== 4) return ''
    if (overrideActive) {
      if (!answers['selected_index_series_id']) {
        return 'Selezionare un indice dalla tendina (forzatura Art. 11.5).'
      }
      if (!(answers['override_reason'] || '').trim()) {
        return 'Indicare la motivazione della forzatura nel campo "Motivazione scelta" (Art. 11.5).'
      }
      return ''
    }
    const weightsActive = weightEditorActive
    if (!weightsActive) return ''
    const raw = (answers['index_weights'] || '').trim()
    if (!raw) return 'Inserire i pesi percentuali degli indici (somma 100%) prima di continuare.'
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return 'Pesi indici non validi: controllare i valori inseriti.'
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'Pesi indici non validi: controllare i valori inseriti.'
    }
    let total = 0
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (typeof value !== 'number' || isNaN(value)) {
        return 'Pesi indici non validi: controllare i valori inseriti.'
      }
      total += value
    }
    if (Math.abs(total - 100) > 0.01) {
      return `I pesi indici devono sommarsi a 100% (attuale: ${total.toFixed(2)}%).`
    }
    return ''
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
      } else {
        // Rimozione di tutti i CPV secondari: azzera i campi legacy, altrimenti
        // i valori stantii già salvati verrebbero rispediti al backend e
        // l'assegnazione CPV duplicata ricreata a ogni salvataggio.
        allAnswers['cpv_secondary'] = ''
        allAnswers['cpv_secondary_weights'] = ''
      }
      const answersArr = stepConfig.fields
        .filter(f => allAnswers[f.key] !== undefined)
        .map(f => ({ step, field_key: f.key, field_value: String(allAnswers[f.key] ?? '') }))
      if (answers['index_override'] === 'true') {
        answersArr.push({ step, field_key: 'index_override', field_value: 'true' })
      }
      await api.wizard.save(id, step, answersArr)
      setSavedAnswers({ ...allAnswers })
      return true
    } catch (e: any) {
      setError(e.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    const validationMsg = validateStep()
    if (validationMsg) {
      setError(validationMsg)
      return
    }
    const saved = await saveStep()
    if (!saved) return
    if (step >= totalSteps) {
      if (id) await api.cases.update(id, { status: 'completed' as string }).catch(() => {})
      navigate(`/`)
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
    return <div style={{ color: 'var(--color-text-muted)', padding: 24 }}>Caricamento step...</div>
  }

  if (!stepConfig) {
    return <div style={{ color: 'var(--color-text-error)', padding: 24 }}>Configurazione step non trovata.</div>
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Timeline avanzamento */}
      <WizardTimeline
        steps={allSteps.map(sc => STEP_TIMELINE_LABELS[sc.key] || sc.title.split(' ')[0])}
        currentStep={step}
        onStepClick={goStep}
        showCounter={false}
      />

      {/* Step title + description */}
      <div style={{
        background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px var(--color-shadow)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{stepConfig.title}</h2>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>{stepConfig.description}</p>
      </div>

      {/* Warnings */}
      {warnings.map((w, i) => (
        <div key={i} style={{
          padding: '12px 16px', background: 'var(--color-bg-warning)', color: 'var(--color-text-warning)',
          borderRadius: 8, marginBottom: 16, fontSize: 14,
        }}>
          ⚠ {w}
        </div>
      ))}

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px 16px', background: 'var(--color-bg-error)', color: 'var(--color-text-error)',
          borderRadius: 8, marginBottom: 16, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Indices for CPV — only on step 4 */}
      {step === 4 && Object.keys(multiCpvResolved).length > 0 && (
        <div style={{
          background: 'var(--color-threshold-ok-bg)', padding: 16, borderRadius: 8, marginBottom: 16,
          border: '1px solid var(--color-border-success)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Riepilogo associato per CPV (Art. 13 — multi-CPV)
          </div>
          {Object.entries(multiCpvResolved).map(([code, rc]) => {
            const sec = secondaryCpvs.find(s => s.code === code)
            const label = sec?.description || (code === (answers['cpv_primary'] || '') ? cpvDescription : '')
            return (
              <div key={code} style={{ padding: '8px 0', fontSize: 13, borderBottom: '1px solid var(--color-border-light)' }}>
                <strong style={{ fontFamily: 'monospace' }}>{code}</strong>
                {label && <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>{label}</span>}
                {rc.series.length > 0
                  ? <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
                      {rc.series.map(s => <div key={s.id}>• {s.name} <span style={{ color: 'var(--color-text-light)' }}>({s.id})</span></div>)}
                    </div>
                  : <div style={{ marginTop: 4, color: 'var(--color-text-warning)' }}>Nessun indice associato</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Associazione Tabella D — single CPV, only on step 4 */}
      {cpvIndices.length > 0 && step === 4 && Object.keys(multiCpvResolved).length === 0 && (
        <div style={{
          background: 'var(--color-threshold-ok-bg)', padding: 16, borderRadius: 8, marginBottom: 16,
          border: '1px solid var(--color-border-success)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Associazione Tabella D per il CPV inserito
          </div>
          {cpvIndices.map(s => (
            <div key={s.id} style={{
              padding: '8px 0', fontSize: 13, borderBottom: '1px solid var(--color-border-light)',
            }}>
              <strong>{s.name}</strong>
              <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>({s.id})</span>
              {s.frequency && <span style={{ color: 'var(--color-text-light)', marginLeft: 4 }}>— {s.frequency}</span>}
            </div>
          ))}
          {tabellaDAssociations.length > 0 && tabellaDAssociations.some(a => !a.available) && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-warning)' }}>
              Attenzione: alcune serie associate non hanno dati disponibili.
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            Per D.1 (e per i CPV fuori Tabella D) l'indice è scelto dal menu a tendina; per D.2 ponderata e D.3 i pesi percentuali si impostano qui sotto (somma 100%).
          </div>
        </div>
      )}


      {/* Form fields */}

      <div style={{
        background: 'var(--color-bg-card)', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px var(--color-shadow)',
      }}>
        {stepConfig.fields.length === 0 && stepConfig.auto_evaluate && (
          <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
            Questo step viene elaborato automaticamente dal sistema.
          </div>
        )}

        {stepConfig.fields
          .filter(f => {
            if (f.key === 'cpv_secondary' || f.key === 'cpv_secondary_weights') return false
            if (step === 3 && (f.key === 'cpv_total_amount')) return false
            // Multi-CPV: senza select unica (riepilogo per CPV sopra); index_weights solo per 1 CPV ponderato
            if (step === 4 && Object.keys(multiCpvResolved).length > 0 &&
                (f.key === 'selected_index_series_id' || f.key === 'index_weights')) return false
            // D.2 ponderata / D.3: la selezione avviene con l'editor dei pesi, la tendina è residua
            // (in forzatura Art. 11.5 la tendina torna a essere il controllo)
            if (step === 4 && !overrideActive &&
                (cpvIndices.length > 1 || !!answers['index_weights']) &&
                f.key === 'selected_index_series_id') return false
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
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    {field.label}
                    {field.required && <span style={{ color: 'var(--color-text-error)' }}> *</span>}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={answers['cpv_primary'] || ''}
                      onChange={e => handleFieldChange('cpv_primary', e.target.value)}
                      placeholder="es. 90910000-9"
                      style={{
                        flex: 1, padding: '10px 14px', fontSize: 14, fontFamily: 'monospace',
                        border: '1px solid var(--color-border)', borderRadius: 8, outline: 'none',
                        background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setCpvModalOpen(true)}
                      style={{
                        padding: '10px 16px', borderRadius: 8, border: 'none',
                        background: 'var(--color-primary)', color: 'var(--color-bg-card)', cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                    >
                      Cerca CPV
                    </button>
                  </div>
                  {cpvDescription && (
                    <div style={{
                      marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic',
                      padding: '6px 10px', background: 'var(--color-bg-offset)', borderRadius: 6,
                      borderLeft: '3px solid var(--color-primary)',
                    }}>
                      {cpvDescription}
                    </div>
                  )}
                </div>
              )
            }
            if (field.key === 'index_weights') {
              const useEditor = weightEditorActive && !overrideActive
              if (!useEditor) return null
              return (
                <IndexWeightsEditor
                  key={field.key}
                  series={cpvIndices.map(s => ({ id: s.id, label: s.name }))}
                  value={answers['index_weights'] || ''}
                  onChange={json => handleFieldChange('index_weights', json)}
                />
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

        {/* Forzatura Art. 11.5 — solo step 4, editor pesi attivo (D.2 ponderata / D.3) */}
        {step === 4 && stepConfig.step === 4 && weightEditorActive && !overrideActive && (
          <div style={{ marginTop: 4, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setOverrideModalOpen(true)}
              style={{
                padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: '1px solid var(--color-border-warning)', background: 'var(--color-bg-warning)',
                color: 'var(--color-text-warning)', cursor: 'pointer',
              }}
            >
              Forza indice singolo (Art. 11.5)
            </button>
          </div>
        )}

        {step === 4 && overrideActive && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              padding: '10px 12px', background: 'var(--color-bg-warning)',
              color: 'var(--color-text-warning)', borderRadius: 8, fontSize: 13, marginBottom: 8,
              border: '1px solid var(--color-border-warning)',
            }}>
              Forzatura attiva: indice singolo fuori dalla ponderazione prevista dalla Tabella D.
              Indicare la motivazione nel campo "Motivazione scelta". (Art. 11.5)
            </div>
            <button
              type="button"
              onClick={revertOverride}
              style={{
                padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: '1px solid var(--color-border)', background: 'var(--color-bg-card)',
                color: 'var(--color-text-secondary)', cursor: 'pointer',
              }}
            >
              Torna alla ponderazione (Tabella D)
            </button>
          </div>
        )}

        {/* Step 3: CPV total amount + secondary CPVs */}
        {stepConfig.step === 3 && (
          <div>
            {/* Total amount */}
            <div style={{
              padding: 16, background: 'var(--color-threshold-ok-bg)', borderRadius: 8, marginBottom: 16,
              border: '1px solid var(--color-border-success)',
            }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                Importo complessivo CPV (€) <span style={{ color: 'var(--color-text-error)' }}>*</span>
              </label>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
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
                  fontFamily: 'monospace', border: '1px solid var(--color-border-success)', borderRadius: 8,
                  outline: 'none', boxSizing: 'border-box',
                  background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
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
                  padding: 16, background: 'var(--color-bg-offset)', borderRadius: 8, marginBottom: 16,
                  border: '1px solid var(--color-border-light)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                    Distribuzione importo per CPV
                  </div>

                  {/* Primary CPV */}
                  {answers['cpv_primary'] && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                      borderBottom: secondaryCpvs.length > 0 ? '1px solid #e5e7eb' : 'none',
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: 'var(--color-primary)', minWidth: 110 }}>
                        {answers['cpv_primary']}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {cpvDescription || 'CPV principale'}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', minWidth: 50, textAlign: 'right' }}>
                        {primaryWeight.toFixed(0)}%
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 110, textAlign: 'right', color: 'var(--color-text-success)' }}>
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
                        <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: 'var(--color-primary)', minWidth: 110 }}>
                          {sec.code}
                        </span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                              border: '1px solid var(--color-border)', borderRadius: 6, fontFamily: 'monospace',
                              background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                            }}
                          />
                          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>%</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', minWidth: 110, textAlign: 'right', color: 'var(--color-text-success)' }}>
                          € {total > 0 ? secAmount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSecondaryCpvs(prev => prev.filter((_, j) => j !== i))}
                          style={{
                            padding: '4px 8px', borderRadius: 4, border: 'none',
                            background: 'var(--color-bg-error)', color: 'var(--color-text-error)', cursor: 'pointer', fontSize: 12,
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
                        padding: '6px 14px', borderRadius: 6, border: '1px dashed var(--color-border)',
                        background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer',
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
                    padding: '8px 12px', background: 'var(--color-threshold-exceeded-bg)', color: 'var(--color-text-error)',
                    borderRadius: 8, fontSize: 13, border: '1px solid var(--color-border-error)', marginBottom: 16,
                  }}>
                    Errore: la somma dei pesi secondari ({totalSec}%) supera il 100%.
                    Riduci i valori per non superare il totale.
                  </div>
                )
              }
              if (secondaryCpvs.length > 0 && totalSec < 100) {
                return (
                  <div style={{
                    padding: '8px 12px', background: 'var(--color-bg-warning)', color: 'var(--color-text-warning)',
                    borderRadius: 8, fontSize: 13, border: '1px solid var(--color-border-warning)', marginBottom: 16,
                  }}>
                    CPV principale: {Math.max(0, 100 - totalSec).toFixed(0)}% · CPV secondari: {totalSec.toFixed(0)}% · Il restante {100 - totalSec}% sar&agrave; attribuito al CPV principale.
                  </div>
                )
              }
              if (secondaryCpvs.length > 0 && totalSec === 100) {
                return (
                  <div style={{
                    padding: '8px 12px', background: 'var(--color-threshold-ok-bg)', color: 'var(--color-text-success)',
                    borderRadius: 8, fontSize: 13, border: '1px solid var(--color-border-success)', marginBottom: 16,
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
              <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
                Calcolo in corso...
              </div>
            )}
            {calcError && (
              <div style={{
                background: 'var(--color-threshold-exceeded-bg)', padding: 16, borderRadius: 8, marginBottom: 16,
                border: '1px solid var(--color-border-error)',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--color-text-error)' }}>
                  Errore calcolo
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-error)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{calcError}</div>
              </div>
            )}
            {calcResult && (
              <div style={{
                background: 'var(--color-threshold-ok-bg)', padding: 16, borderRadius: 8, marginBottom: 16,
                border: '1px solid var(--color-border-success)',
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
                    padding: '6px 8px', marginBottom: 4, background: 'var(--color-bg-card)',
                    borderRadius: 4, fontSize: 12, border: '1px solid var(--color-border-light)',
                  }}>
                    <strong>{s.description}</strong>
                    <div style={{ color: 'var(--color-text-muted)' }}>{s.formula} = {s.result}</div>
                  </div>
                ))}
                  </div>
                )}
                {(() => {
                  const ev = calcResult.period_evidence
                  if (!ev) return null
                  const comps = calcResult.weighted_component_variations || []
                  const isComposite = comps.length > 0
                  // Con più serie ogni componente può avere un periodo usato
                  // diverso: le righe per componente sono la verità; l'aggregato
                  // è mostrato solo per la serie singola.
                  const issues = isComposite ? [] : [ev.base, ev.comparison].filter(p => !p.exact)
                  const compIssues = comps.filter(c => !c.base_exact || !c.comparison_exact)
                  if (issues.length === 0 && compIssues.length === 0) return null
                  return (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--color-bg-warning)', borderRadius: 8, border: '1px solid var(--color-border-warning)', fontSize: 12, lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--color-text-warning)' }}>
                        ⚠ Copertura periodi: mesi non registrati
                      </div>
                      {issues.map(p => (
                        <div key={p.requested} style={{ color: 'var(--color-text-warning)' }}>
                          {p === ev.base ? 'Periodo base' : 'Periodo di confronto'} ({fmtEvMonth(p.requested.slice(0, 7))}):
                          il calcolo non ha registrato {p.missing_months.length > 0 ? fmtEvMonths(p.missing_months) : 'il mese richiesto'};
                          è partito dall'osservazione di {p.used ? fmtEvMonth(p.used.slice(0, 7)) : '—'}.
                        </div>
                      ))}
                      {compIssues.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          {compIssues.map(c => {
                            const bits: string[] = []
                            if (!c.base_exact) {
                              bits.push(`base ${ev.base.requested}: non registrato${c.missing_base_months?.length ? ` (${fmtEvMonths(c.missing_base_months)})` : ''} → usata ${c.used_base_period ? fmtEvMonth(c.used_base_period.slice(0, 7)) : '—'}`)
                            }
                            if (!c.comparison_exact) {
                              bits.push(`confronto ${ev.comparison.requested}: non registrato${c.missing_comparison_months?.length ? ` (${fmtEvMonths(c.missing_comparison_months)})` : ''} → usata ${c.used_comparison_period ? fmtEvMonth(c.used_comparison_period.slice(0, 7)) : '—'}`)
                            }
                            return (
                              <div key={c.series_id} style={{ color: 'var(--color-text-warning)' }}>
                                <span style={{ fontFamily: 'monospace' }}>{c.series_id}</span> — {bits.join(' · ')}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}
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
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
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
              padding: '10px 20px', borderRadius: 8, border: '1px solid var(--color-border)',
              background: 'var(--color-bg-offset)', color: 'var(--color-text-secondary)', cursor: 'pointer',
              fontSize: 14, fontWeight: 600,
            }}>
              Stampa / PDF
            </button>
          )}
          <button onClick={goNext} style={{ ...navBtnStyle, background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
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

      {/* Modal conferma forzatura Art. 11.5 */}
      {overrideModalOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'var(--color-overlay)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setOverrideModalOpen(false)}
        >
          <div
            style={{
              background: 'var(--color-bg-card)', borderRadius: 12, width: 560, maxWidth: '90vw',
              padding: 24, boxShadow: '0 8px 32px var(--color-shadow-heavy)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: 'var(--color-text-warning)' }}>
              Forzatura selezione indice (Art. 11.5)
            </h3>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
              Si sta scegliendo un <strong>indice singolo</strong> al posto del sistema di ponderazione
              previsto dalla Tabella D dell'Allegato II.2-bis. L'Art. 11.5 consente questa scelta solo
              se motivata nei documenti di gara: verrà richiesta la motivazione nel campo
              "Motivazione scelta" prima di proseguire.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setOverrideModalOpen(false)}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={confirmOverride}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: 'var(--color-bg-warning)', color: 'var(--color-text-warning)',
                  cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}
              >
                Procedi con forzatura
              </button>
            </div>
          </div>
        </div>
      )}

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
  padding: '10px 20px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}
