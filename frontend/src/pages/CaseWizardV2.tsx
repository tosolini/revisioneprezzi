import type { ComponentProps } from 'react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router'
import ContractTypeSelector from '../components/ContractTypeSelector'
import TolSelector from '../components/TolSelector'
import ReportV2View from '../components/ReportV2View'
import CpvSearchModal from '../components/CpvSearchModal'
import WizardTimeline from '../components/WizardTimeline'
import { asNullableString, asNumber, isRecord } from '../components/utils'
interface TolSelection {
  code: string
  weight: number
}

interface CpvSelection {
  cpv_code: string
  description?: string
  weight?: number
}

interface AtecoSelection {
  ateco_code: string
  weight: number
}

interface IndicesConfig {
  type: 'single' | 'composite'
  single_series_id?: string
  method?: 'weighted_values' | 'weighted_variations'
  components?: Record<string, number>
}

interface WeightedComponentVariation {
  series_id: string
  weight: number
  base_value: number
  comparison_value: number
  variation_percent: number
  contribution_percent?: number
  used_base_period?: string | null
  used_comparison_period?: string | null
  base_exact?: boolean
  comparison_exact?: boolean
}

interface CalcStep {
  step: number
  description: string
  formula: string
  result: string
  calculation?: string
  details?: Record<string, unknown>
}

interface CalcResultLike {
  base_value?: number
  comparison_value?: number
  variation_percent?: number
  threshold_percent?: number
  threshold_exceeded?: boolean
  excess_percent?: number
  recognition_percent?: number
  revision_amount?: number
  revision_amount_abs?: number
  revision_type?: string
  formula_detail?: string
  steps?: CalcStep[]
  is_applicable?: boolean
  weighted_component_variations?: WeightedComponentVariation[]
  is_multi_component?: boolean
  total_amount?: number
  components?: Array<{
    component_index: number
    description: string
    amount: number
    result: CalcResultLike
  }>
  overall_variation_percent?: number
  summary?: string
  normative_reference?: string
}

interface WizardData {
  contract_type: 'works' | 'services' | 'supplies' | ''
  tol_selections?: TolSelection[]
  cpv_selections: CpvSelection[]
  ateco_selections: AtecoSelection[]
  cpv_code?: string
  cpv_description?: string
  amount: number
  base_period: string
  comparison_period: string
  indices_config?: IndicesConfig
  result?: CalcResultLike | null
}

interface MappingAssoc {
  index_type: string
  classification: string
  ateco_code: string
  description: string
  series_id: string | null
  available: boolean
}

interface IndexSeriesOption {
  id: string
  name: string
  frequency?: string | null
}

type ReportViewProps = ComponentProps<typeof ReportV2View>['reportData']

interface CpvMapping {
  resolved_cpv_code: string | null
  table_class: string | null
  associations: MappingAssoc[]
  familyCandidates: IndexSeriesOption[]
  mode: 'single' | 'weighted'
  manualSingle: string | null
  weights: Record<string, number>
}

interface PeriodCoverage {
  series_id: string
  weight: number
  base: { requested: string; used: string | null; value: number | null; exact: boolean; missing_months?: string[] }
  comparison: { requested: string; used: string | null; value: number | null; exact: boolean; missing_months?: string[] }
  satisfied: boolean
  missing: boolean
}

const COV_MONTH_NAMES = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

const fmtCovMonth = (ym: string): string =>
  `${COV_MONTH_NAMES[parseInt(ym.slice(5, 7), 10)] || ''} ${ym.slice(0, 4)}`

const fmtCovMonths = (months: string[]): string =>
  months.length > 8
    ? months.slice(0, 6).map(fmtCovMonth).join(', ') + ` … e altri ${months.length - 6} mesi`
    : months.map(fmtCovMonth).join(', ')

// Mappa divisione ATECO → lettera sezione (nota Tabella D, Art. 11.2)
const IR_DIVISION_TO_SECTION: [number, number, string][] = [
  [1, 3, 'A'], [5, 9, 'B'], [10, 33, 'C'], [35, 35, 'D'], [36, 39, 'E'],
  [41, 43, 'F'], [45, 47, 'G'], [49, 53, 'H'], [55, 56, 'I'], [58, 63, 'J'],
  [64, 66, 'K'], [68, 68, 'L'], [69, 75, 'M'], [77, 82, 'N'], [84, 84, 'O'],
  [85, 85, 'P'], [86, 88, 'Q'], [90, 93, 'R'], [94, 96, 'S'], [97, 98, 'T'],
  [99, 99, 'U'],
]

function irSectionForDivision(division: number): string | null {
  for (const [lo, hi, section] of IR_DIVISION_TO_SECTION) {
    if (division >= lo && division <= hi) return section
  }
  return null
}

function normalizeAteco(code: string): string {
  // "26.3" → "263", "26" → "26", "A" → "A"
  const digits = code.replace(/[^0-9]/g, '')
  return digits || code.trim().toUpperCase()
}

export default function CaseWizardV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [data, setData] = useState<WizardData>({
    contract_type: '',
    cpv_selections: [],
    ateco_selections: [],
    amount: 0,
    base_period: '',
    comparison_period: ''
  })
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState('')
  const [reportData, setReportData] = useState<ReportViewProps | null>(null)
  const [mappings, setMappings] = useState<Record<string, CpvMapping>>({})
  const [mappingLoading, setMappingLoading] = useState(false)
  const [periodCoverage, setPeriodCoverage] = useState<Record<string, PeriodCoverage> | null>(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [cpvModalOpen, setCpvModalOpen] = useState(false)
  const [atecoSuggestions, setAtecoSuggestions] = useState<{ code: string; description: string }[]>([])
  const [atecoInputs, setAtecoInputs] = useState<Record<string, string>>({})
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])

  const totalSteps = 5

  // Carica dati esistenti se presente un case_id
  useEffect(() => {
    if (!id) return
    setInitialLoading(true)
    fetch(`/api/v1/cases/${id}/wizard-v2`)
      .then(res => {
        if (!res.ok) throw new Error('Errore caricamento wizard')
        return res.json()
      })
      .then(body => {
        if (!isRecord(body)) throw new Error('Errore caricamento wizard')
        const s = isRecord(body['state']) ? body['state'] : {}
        const rawSelections = Array.isArray(s['cpv_selections']) ? s['cpv_selections'] : []
        const cpvSelections: CpvSelection[] = rawSelections.length > 0
          ? rawSelections
              .filter(isRecord)
              .map(x => ({
                cpv_code: String(x['cpv_code'] ?? ''),
                description: typeof x['description'] === 'string' ? x['description'] : undefined,
                weight: asNumber(x['weight']),
              }))
              .filter(x => x.cpv_code.length > 0)
          : (typeof s['cpv_code'] === 'string'
              ? [{ cpv_code: s['cpv_code'], description: typeof s['cpv_description'] === 'string' ? s['cpv_description'] : undefined }]
              : [])
        const rawAteco = Array.isArray(s['ateco_selections']) ? s['ateco_selections'] : []
        const atecoSelections: AtecoSelection[] = rawAteco
          .filter(isRecord)
          .map(x => ({ ateco_code: String(x['ateco_code'] ?? ''), weight: asNumber(x['weight']) ?? 0 }))
          .filter(x => x.ateco_code.length > 0)
        setData({
          contract_type: s['contract_type'] === 'works' || s['contract_type'] === 'supplies' || s['contract_type'] === 'services'
            ? s['contract_type']
            : '',
          tol_selections: Array.isArray(s['tol_selections'])
            ? s['tol_selections'].filter(isRecord).map(x => ({
                code: String(x['code'] ?? ''),
                weight: asNumber(x['weight']) ?? 0,
              }))
            : [],
          cpv_selections: cpvSelections,
          ateco_selections: atecoSelections,
          cpv_code: cpvSelections[0]?.cpv_code || '',
          cpv_description: cpvSelections[0]?.description || '',
          amount: asNumber(s['amount']) ?? 0,
          base_period: typeof s['base_period'] === 'string' ? s['base_period'] : '',
          comparison_period: typeof s['comparison_period'] === 'string' ? s['comparison_period'] : '',
          indices_config: isRecord(s['indices_config']) ? s['indices_config'] as unknown as IndicesConfig : undefined,
          result: isRecord(s['result']) ? s['result'] as unknown as CalcResultLike : null,
        })
        setCurrentStep(asNumber(s['current_step']) ?? 1)
        setInitialLoading(false)
        const savedStep = asNumber(s['current_step']) ?? 1
        if (savedStep >= 5) {
          const savedResult = isRecord(s['result']) ? s['result'] : undefined
          void loadReport(savedResult)
        }
      })
      .catch(err => {
        console.error('Errore caricamento wizard:', err)
        setError('Impossibile caricare i dati della pratica')
        setInitialLoading(false)
      })
  }, [id])

  const saveWizardState = useCallback(async (nextStep?: number) => {
    if (!id) return
    const primary = data.cpv_selections[0]
    try {
      await fetch(`/api/v1/cases/${id}/wizard-v2`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_step: nextStep ?? currentStep,
          contract_type: data.contract_type,
          tol_selections: data.tol_selections || [],
          cpv_code: primary?.cpv_code || data.cpv_code || null,
          cpv_description: primary?.description || data.cpv_description || null,
          cpv_selections: data.cpv_selections,
          ateco_selections: data.ateco_selections,
          amount: data.amount,
          base_period: data.base_period || null,
          comparison_period: data.comparison_period || null,
          indices_config: data.indices_config || null,
          result: data.result || null,
        })
      })
    } catch (err) {
      console.error('Errore salvataggio wizard:', err)
    }
  }, [id, currentStep, data])

  const setDataField = <K extends keyof WizardData>(field: K, value: WizardData[K]) => {
    setData(prev => ({ ...prev, [field]: value }))
  }

  // ----- Step 2: gestione CPV e ATECO -----
  // Invalida stato derivato (step 4) quando cambia la classificazione
  const invalidateDerivedForClassificationChange = () => {
    setMappings({})
    setPeriodCoverage(null)
    setReportData(null)
    setData(prev => {
      if (prev.indices_config || prev.result) {
        return { ...prev, indices_config: undefined, result: null }
      }
      return prev
    })
  }

  const addCpv = (code: string, description: string) => {
    setData(prev => {
      if (prev.cpv_selections.some(sel => sel.cpv_code === code)) return prev
      const list = [...prev.cpv_selections, { cpv_code: code, description, weight: undefined }]
      return { ...prev, cpv_selections: list, cpv_code: list[0].cpv_code, cpv_description: list[0].description, indices_config: undefined, result: null }
    })
    invalidateDerivedForClassificationChange()
    setCpvModalOpen(false)
  }

  const removeCpv = (atIndex: number) => {
    setData(prev => {
      const list = prev.cpv_selections.filter((_, i) => i !== atIndex)
      return {
        ...prev,
        cpv_selections: list,
        cpv_code: list[0]?.cpv_code || '',
        cpv_description: list[0]?.description || '',
        indices_config: undefined,
        result: null,
      }
    })
    invalidateDerivedForClassificationChange()
  }

  const updateCpvWeight = (atIndex: number, weight: number | undefined) => {
    setData(prev => {
      const list = prev.cpv_selections.map((sel, i) => i === atIndex ? { ...sel, weight } : sel)
      return { ...prev, cpv_selections: list, result: null }
    })
    setReportData(null)
  }

  const onAtecoInput = (atIndex: number, value: string) => {
    setAtecoInputs(prev => ({ ...prev, [String(atIndex)]: value }))
    setData(prev => {
      const list = prev.ateco_selections.map((sel, i) => i === atIndex ? { ...sel, ateco_code: value } : sel)
      return { ...prev, ateco_selections: list, result: null }
    })
    if (!value.trim()) {
      setAtecoSuggestions([])
      return
    }
    fetch(`/api/v1/ateco/search?q=${encodeURIComponent(value.trim())}`)
      .then(res => res.json())
      .then(body => setAtecoSuggestions(isRecord(body) && Array.isArray(body['results']) ? body['results'].filter(isRecord).map(r => ({
        code: String(r['code'] ?? ''),
        description: String(r['description'] ?? ''),
      })) : []))
      .catch(() => setAtecoSuggestions([]))
    // ATECO influisce sui pesi in step 4 (Tabella D punto 7): invalida mapping
    invalidateDerivedForClassificationChange()
  }

  const pickAteco = (atIndex: number, code: string, description: string) => {
    setData(prev => {
      const list = prev.ateco_selections.map((sel, i) => i === atIndex ? { ...sel, ateco_code: code } : sel)
      return { ...prev, ateco_selections: list, result: null }
    })
    setAtecoInputs(prev => ({ ...prev, [String(atIndex)]: `${code} — ${description}` }))
    setAtecoSuggestions([])
    invalidateDerivedForClassificationChange()
  }

  const addAteco = () => {
    setData(prev => ({
      ...prev,
      ateco_selections: [...prev.ateco_selections, { ateco_code: '', weight: 0 }],
      result: null,
    }))
    invalidateDerivedForClassificationChange()
  }

  const removeAteco = (atIndex: number) => {
    setData(prev => ({
      ...prev,
      ateco_selections: prev.ateco_selections.filter((_, i) => i !== atIndex),
      result: null,
    }))
    invalidateDerivedForClassificationChange()
  }

  const updateAtecoWeight = (atIndex: number, weight: number) => {
    setData(prev => {
      const list = prev.ateco_selections.map((sel, i) => i === atIndex ? { ...sel, weight } : sel)
      return { ...prev, ateco_selections: list, result: null }
    })
    invalidateDerivedForClassificationChange()
  }

  // ----- Step 4: mapping Tabella D -----
  const buildWeights = (assocs: MappingAssoc[], atecoSelections: AtecoSelection[]): Record<string, number> => {
    if (atecoSelections.length > 0) {
      const weights: Record<string, number> = {}
      const usedIds: Record<number, true> = {}
      for (const at of atecoSelections) {
        const norm = normalizeAteco(at.ateco_code)
        if (!norm) continue
        let matchedIdx: number | null = null
        for (let i = 0; i < assocs.length; i++) {
          if (usedIds[i]) continue
          const a = assocs[i]
          const aCode = a.ateco_code.trim()
          const sectionMatch =
            a.index_type === 'IR' &&
            /^[A-Z]$/.test(aCode) &&
            irSectionForDivision(parseInt(norm.slice(0, 2), 10)) === aCode
          if (aCode === norm || (norm.length > 0 && aCode.startsWith(norm)) || sectionMatch) {
            matchedIdx = i
            break
          }
        }
        if (matchedIdx !== null && assocs[matchedIdx].series_id) {
          usedIds[matchedIdx] = true
          const seriesId = assocs[matchedIdx].series_id as string
          weights[seriesId] = (weights[seriesId] ?? 0) + at.weight
        }
      }
      if (Object.keys(weights).length > 0) return weights
    }
    // Default: se è presente l'indice IR (retribuzioni — servizi ad alta
    // intensità di manodopera) gli si attribuisce il 90%, valore di
    // riferimento dell'incidenza manodopera (Allegato II.2-bis punto 13),
    // ripartendo il 10% residuo equamente sulle altre associazioni usabili.
    // Altrimenti pesi uguali.
    const usable = assocs.filter(a => a.series_id)
    const weights: Record<string, number> = {}
    if (usable.length > 0) {
      const ir = usable.find(a => a.index_type === 'IR')
      if (ir) {
        const irSeries = ir.series_id as string
        weights[irSeries] = 90
        const others = usable.filter(a => (a.series_id as string) !== irSeries)
        if (others.length > 0) {
          const share = 10 / others.length
          others.forEach(a => { weights[a.series_id as string] = share })
        }
      } else {
        const share = 100 / usable.length
        usable.forEach(a => {
          weights[a.series_id as string] = share
        })
      }
    }
    return weights
  }

  const fetchMappings = useCallback(async (cpvSelections: CpvSelection[], atecoSelections: AtecoSelection[]) => {
    // Mostra subito lo stato di caricamento e pulisce la copertura periodo stantia
    setMappingLoading(true)
    setPeriodCoverage(null)
    const next: Record<string, CpvMapping> = {}
    await Promise.all(cpvSelections.map(async sel => {
      try {
        const res = await fetch('/api/v1/classify/cpv-index-mapping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cpv_code: sel.cpv_code }),
        })
        if (!res.ok) return
        const body: unknown = await res.json()
        if (!isRecord(body)) return
        const rawAssocs = Array.isArray(body['associations']) ? body['associations'] : []
        const assocs: MappingAssoc[] = rawAssocs.filter(isRecord).map(a => ({
          index_type: String(a['index_type'] ?? ''),
          classification: String(a['classification'] ?? ''),
          ateco_code: String(a['ateco_code'] ?? ''),
          description: String(a['description'] ?? ''),
          series_id: asNullableString(a['series_id']),
          available: a['available'] === true,
        }))
        const tableClass = asNullableString(body['table_class'])
        const usableSeries = assocs.filter(a => a.series_id).map(a => a.series_id as string)
        next[sel.cpv_code] = {
          resolved_cpv_code: asNullableString(body['resolved_cpv_code']),
          table_class: tableClass,
          associations: assocs,
          familyCandidates: [],
          mode: tableClass === 'D2' ? 'single' : 'weighted',
          manualSingle: tableClass === 'D1' ? (usableSeries[0] ?? null) : null,
          weights: buildWeights(assocs, atecoSelections),
        }
      } catch {
        return
      }
    }))
    setMappings(next)
    setMappingLoading(false)
  }, [])

  useEffect(() => {
    if (currentStep === 4) {
      // Ricarica mapping quando si entra nello step 4 o quando cambia la classificazione mentre si è nello step 4
      fetchMappings(data.cpv_selections, data.ateco_selections)
    }
  }, [currentStep, data.cpv_selections, data.ateco_selections, fetchMappings])

  // Copertura periodi: mostra chiaramente se i periodi richiesti esistono
  // nelle serie selezionate o vengono soddisfatti per fallback.
  useEffect(() => {
    if (currentStep !== 4) return
    if (!data.base_period || !data.comparison_period) {
      setPeriodCoverage(null)
      return
    }
    const series: Record<string, number> = {}
    for (const sel of data.cpv_selections) {
      const m = mappings[sel.cpv_code]
      if (!m) continue
      for (const a of m.associations) {
        if (a.series_id && !(a.series_id in series)) {
          series[a.series_id] = m.weights[a.series_id] ?? 0
        }
      }
    }
    const ids = Object.keys(series)
    if (ids.length === 0) {
      setPeriodCoverage(null)
      return
    }
    setCoverageLoading(true)
    fetch('/api/v1/calculation/v2/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        components: series,
        base_period: data.base_period,
        comparison_period: data.comparison_period,
      }),
    })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (isRecord(body) && Array.isArray(body['series'])) {
          const map: Record<string, PeriodCoverage> = {}
          for (const c of body['series']) {
            if (isRecord(c) && typeof c['series_id'] === 'string') {
              map[c['series_id']] = c as unknown as PeriodCoverage
            }
          }
          setPeriodCoverage(map)
        } else {
          setPeriodCoverage(null)
        }
      })
      .catch(() => setPeriodCoverage(null))
      .finally(() => setCoverageLoading(false))
  }, [currentStep, mappings, data.base_period, data.comparison_period, data.cpv_selections])
  const setMode = (cpv: string, mode: 'single' | 'weighted') => {
    setMappings(prev => {
      const m = prev[cpv]
      return m ? { ...prev, [cpv]: { ...m, mode } } : prev
    })
  }

  const setManualSingle = (cpv: string, seriesId: string | null) => {
    setMappings(prev => {
      const m = prev[cpv]
      return m ? { ...prev, [cpv]: { ...m, manualSingle: seriesId } } : prev
    })
  }

  const setWeight = (cpv: string, seriesId: string, weight: number) => {
    setMappings(prev => {
      const m = prev[cpv]
      return m ? { ...prev, [cpv]: { ...m, weights: { ...m.weights, [seriesId]: weight } } } : prev
    })
  }

  const loadFamilyCandidates = async (cpv: string) => {
    try {
      const res = await fetch('/api/v1/classify/indices-for-cpv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpv_primary: cpv, contract_type: data.contract_type }),
      })
      if (!res.ok) return
      const body: unknown = await res.json()
      if (!isRecord(body)) return
      const candidates = Array.isArray(body['candidates']) ? body['candidates'] : []
      const parsed: IndexSeriesOption[] = candidates.filter(isRecord).map(c => ({
        id: String(c['id'] ?? ''),
        name: String(c['name'] ?? c['id'] ?? ''),
        frequency: typeof c['frequency'] === 'string' ? c['frequency'] : null,
      }))
      setMappings(prev => {
        const m = prev[cpv]
        return m ? { ...prev, [cpv]: { ...m, familyCandidates: parsed } } : prev
      })
    } catch {
      return
    }
  }

  // ----- Step 4 validation -----
  const mappingIssues = (): string[] => {
    const issues: string[] = []
    for (const sel of data.cpv_selections) {
      const m = mappings[sel.cpv_code]
      if (!m) {
        issues.push(`CPV ${sel.cpv_code}: mapping non caricato`)
        continue
      }
      if (m.table_class === null) {
        if (!m.manualSingle) {
          issues.push(`CPV ${sel.cpv_code}: selezionare manualmente un indice (Art. 11.4)`)
        }
        continue
      }
      if (m.associations.length === 0) {
        issues.push(`CPV ${sel.cpv_code}: nessuna associazione disponibile`)
        continue
      }
      if (m.mode === 'single') {
        if (!m.manualSingle) {
          issues.push(`CPV ${sel.cpv_code}: selezionare l'indice`)
        }
      } else {
        const weights = Object.values(m.weights)
        if (weights.length === 0) {
          issues.push(`CPV ${sel.cpv_code}: nessun indice con peso`)
          continue
        }
        const total = weights.reduce((sum, v) => sum + v, 0)
        if (Math.abs(total - 100) > 0.01) {
          issues.push(`CPV ${sel.cpv_code}: i pesi devono sommarsi a 100% (attuale: ${total.toFixed(2)}%)`)
        }
      }

      // Copertura periodi: serie senza alcuna osservazione definitiva nei
      // periodi richiesti → il calcolo fallirebbe.
      if (periodCoverage) {
        for (const a of m.associations) {
          if (!a.series_id) continue
          const cov = periodCoverage[a.series_id]
          if (cov && cov.missing) {
            issues.push(`CPV ${sel.cpv_code}: ${a.series_id} senza dati nei periodi richiesti (base ${data.base_period || '?'} → confronto ${data.comparison_period || '?'})`)
          }
        }
      }
    }
    return issues
  }

  const buildIndicesConfig = (sel: CpvSelection): IndicesConfig | null => {
    const mapping = mappings[sel.cpv_code]
    if (!mapping) return null
    if (mapping.table_class === null || mapping.mode === 'single') {
      return mapping.manualSingle ? { type: 'single', single_series_id: mapping.manualSingle } : null
    }
    return { type: 'composite', method: 'weighted_variations', components: { ...mapping.weights } }
  }

  // ----- Step 5: calcolo -----
  const executeCalculation = async () => {
    setLoading(true)
    setError('')

    // Conserva l'indices_config effettivamente usato per il calcolo (non quello stantio in data)
    let calcIndicesConfig: IndicesConfig | null = null
    let calcComponents: Array<{ amount: number; indices_config: IndicesConfig; description: string }> | null = null

    try {
      let response: Response
      if (data.contract_type === 'works' && data.tol_selections && data.tol_selections.length > 0) {
        // Flusso TOL invariato (composite weighted_values, default)
        const resolved = await resolveTolSeriesIds(data.tol_selections)
        let indicesConfig: IndicesConfig
        if (resolved.length > 1) {
          const components: Record<string, number> = {}
          resolved.forEach(r => { components[r.seriesId] = r.weight })
          indicesConfig = { type: 'composite', components }
        } else {
          indicesConfig = { type: 'single', single_series_id: resolved[0].seriesId }
        }
        calcIndicesConfig = indicesConfig
        response = await fetch('/api/v1/calculation/v2/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contract_type: data.contract_type,
            amount: data.amount,
            base_period: data.base_period,
            comparison_period: data.comparison_period,
            indices_config: indicesConfig,
          }),
        })
      } else if (data.cpv_selections.length > 0) {
        const issues = mappingIssues()
        if (issues.length > 0) {
          throw new Error(issues.join('\n'))
        }
        if (data.cpv_selections.length === 1) {
          const sel = data.cpv_selections[0]
          const indicesConfig = buildIndicesConfig(sel)
          if (!indicesConfig) throw new Error('Impossibile determinare gli indici ISTAT per il CPV selezionato')
          calcIndicesConfig = indicesConfig
          response = await fetch('/api/v1/calculation/v2/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contract_type: data.contract_type,
              amount: data.amount,
              base_period: data.base_period,
              comparison_period: data.comparison_period,
              indices_config: indicesConfig,
            }),
          })
        } else {
          // Multi-CPV (Art. 13): componente per CPV con importo ripartito dai pesi
          const components: Array<{ amount: number; indices_config: IndicesConfig; description: string }> = []
          for (const sel of data.cpv_selections) {
            const indicesConfig = buildIndicesConfig(sel)
            if (!indicesConfig) throw new Error(`Impossibile determinare gli indici per ${sel.cpv_code}`)
            const weight = sel.weight ?? 100 / data.cpv_selections.length
            components.push({
              amount: data.amount * (weight / 100),
              indices_config: indicesConfig,
              description: sel.description || sel.cpv_code,
            })
          }
          calcComponents = components
          // Per persistenza wizard, salva il primo componente come rappresentativo (wizard state è single)
          calcIndicesConfig = components[0]?.indices_config ?? null
          response = await fetch('/api/v1/calculation/v2/calculate/multi-component', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contract_type: data.contract_type,
              base_period: data.base_period,
              comparison_period: data.comparison_period,
              components,
            }),
          })
        }
      } else {
        throw new Error('Impossibile determinare gli indici: nessuna classificazione selezionata')
      }

      if (!response.ok) {
        const body: unknown = await response.json()
        const detail = isRecord(body) && typeof body['detail'] === 'string' ? body['detail'] : 'Errore calcolo'
        throw new Error(detail)
      }

      const result = await response.json()
      setDataField('result', isRecord(result) ? result as unknown as CalcResultLike : { is_multi_component: true })
      // Aggiorna anche indices_config nello stato locale per evitare staleness al prossimo giro
      if (calcIndicesConfig) {
        setData(prev => ({ ...prev, indices_config: calcIndicesConfig!, result: isRecord(result) ? result as unknown as CalcResultLike : { is_multi_component: true } }))
      }

      // Persistenza (usa l'indices_config effettivamente calcolato, non quello stantio)
      if (id) {
        await fetch(`/api/v1/cases/${id}/wizard-v2`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_step: 5,
            contract_type: data.contract_type,
            tol_selections: data.tol_selections || [],
            cpv_code: data.cpv_selections[0]?.cpv_code || null,
            cpv_description: data.cpv_selections[0]?.description || null,
            cpv_selections: data.cpv_selections,
            ateco_selections: data.ateco_selections,
            amount: data.amount,
            base_period: data.base_period || null,
            comparison_period: data.comparison_period || null,
            indices_config: calcIndicesConfig,
            result,
          })
        })
      }
      // Carica il report completo (result esplicito: evita closure stantia)
      await loadReport(result)

      setCurrentStep(5)

    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Errore durante il calcolo')
    } finally {
      setLoading(false)
    }
  }

  const resolveTolSeriesIds = async (selections: TolSelection[]): Promise<{ code: string; weight: number; seriesId: string }[]> => {
    const results = await Promise.all(
      selections.map(async sel => {
        try {
          const res = await fetch(`/api/v1/tol/${sel.code}/indices`)
          const body: unknown = await res.json()
          const indices = Array.isArray(body) ? body.filter(isRecord) : []
          const active = indices.find(i => i['is_active'] === true)
          const seriesId = active && typeof active['series_id'] === 'string' ? active['series_id'] : `TOL_${sel.code}`
          return { code: sel.code, weight: sel.weight, seriesId }
        } catch {
          return { code: sel.code, weight: sel.weight, seriesId: `TOL_${sel.code}` }
        }
      })
    )
    return results
  }

  const loadReport = async (calcResult?: unknown) => {
    if (!id) return
    const d = dataRef.current
    try {
      const response = await fetch(`/api/v1/report/v2/cases/${id}`)
      if (!response.ok) throw new Error('Errore caricamento report')
      const body: unknown = await response.json()
      // Il backend genera il report: forma nota, cast al tipo del componente.
      if (!isRecord(body) || !Array.isArray(body['sections'])) {
        setReportData(body as unknown as ReportViewProps)  // forma nota dal backend
        return
      }
      const report = body as unknown as ReportViewProps  // forma nota dal backend
      const effective = isRecord(calcResult) ? calcResult as unknown as CalcResultLike : data.result
      const sections = report.sections.map(sec => {
        const title = sec.title || ''
        const secData = sec.data && typeof sec.data === 'object' ? sec.data : {}
        if (title === 'Importi e Date') {
          return { ...sec, data: { ...secData, contract_amount: d.amount, revisable_amount: d.amount, base_period: d.base_period, comparison_period: d.comparison_period } }
        }
        if (title === 'Indici ISTAT' && effective) {
          return (() => {
            const step1 = (effective.steps ?? []).find(s => s.step === 1)
            const d1 = step1?.details
            return { ...sec, data: { ...secData, synthetic_index_base: effective.base_value, synthetic_index_comparison: effective.comparison_value, components: effective.weighted_component_variations ?? null, component_details: d1 ? d1['component_details'] ?? null : null, calc_formula: d1 ? d1['formula'] ?? null : null, calc_math: d1 ? d1['calculation'] ?? null : null } }
          })()
        }
        if (title === 'Risultato Calcolo' && effective) {
          return { ...sec, data: { variation_percent: effective.variation_percent, threshold_exceeded: effective.threshold_exceeded, revision_amount: effective.revision_amount, revision_type: effective.revision_type, formula_steps: effective.steps || [] } }
        }
        return sec
      })
      setReportData({ ...report, sections })
    } catch (err) {
      console.error('Errore caricamento report:', err)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return data.contract_type !== ''
      case 2:
        if (data.contract_type === 'works') {
          return (data.tol_selections?.length ?? 0) > 0
        }
        return data.cpv_selections.length > 0
      case 3:
        return data.amount > 0 && data.base_period !== '' && data.comparison_period !== ''
          && data.base_period <= data.comparison_period
      case 4:
        return data.cpv_selections.length > 0 && !mappingLoading && mappingIssues().length === 0
      default:
        return true
    }
  }

  const handleNext = async () => {
    if (currentStep < 4) {
      await saveWizardState(currentStep + 1)
      setCurrentStep(prev => Math.min(prev + 1, totalSteps))
    } else if (currentStep === 4) {
      await executeCalculation()
    }
  }

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(prev => Math.max(prev - 1, 1))
  }

  // ---- Render helper step 4 ----
  const coverageNote = (seriesId: string | null) => {
    if (coverageLoading) return null
    const cov = seriesId ? periodCoverage?.[seriesId] : undefined
    if (!cov) return null
    if (cov.missing) {
      return (
        <span style={{ color: 'var(--color-text-error)', display: 'block', fontSize: 12, marginTop: 2 }}>
          Nessun dato definitivo nei periodi richiesti: il calcolo fallirebbe per questa serie.
        </span>
      )
    }
    const notes: string[] = []
    if (!cov.base.exact) {
      notes.push(`periodo base ${cov.base.requested}: non registrato${cov.base.missing_months?.length ? ` (${fmtCovMonths(cov.base.missing_months)})` : ''} — usata osservazione ${cov.base.used}`)
    }
    if (!cov.comparison.exact) {
      notes.push(`periodo confronto ${cov.comparison.requested}: non registrato${cov.comparison.missing_months?.length ? ` (${fmtCovMonths(cov.comparison.missing_months)})` : ''} — usata osservazione ${cov.comparison.used}`)
    }
    if (notes.length === 0) {
      return (
        <span style={{ color: 'var(--color-text-success)', display: 'block', fontSize: 12, marginTop: 2 }}>
          Periodi richiesti soddisfatti (osservazioni definitive).
        </span>
      )
    }
    return (
      <span style={{ color: 'var(--color-text-warning)', display: 'block', fontSize: 12, marginTop: 2 }}>
        I periodi richiesti non esistono in questa serie: {notes.join(' · ')}.
      </span>
    )
  }

  const renderWeights = (mapping: CpvMapping, sel: CpvSelection) => {
    const usable = mapping.associations.filter(a => a.series_id)
    const weights = Object.values(mapping.weights)
    const total = weights.reduce((sum, v) => sum + v, 0)
    return (
      <div>
        {sel.cpv_code === data.cpv_selections[0]?.cpv_code && data.ateco_selections.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Pesi precompilati dai codici ATECO (Art. 11.3, Tabella D punto 7).
          </div>
        )}
        {usable.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-warning)' }}>
            Nessun indice ISTAT disponibile per questa associazione.
          </div>
        )}
        {usable.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
            <span style={{ flex: 1 }}>
              <strong>{a.index_type}</strong> [{a.ateco_code}] {a.description}
              {!a.available && <span style={{ color: 'var(--color-text-warning)', marginLeft: 6 }}>— dati non disponibili</span>}
              {coverageNote(a.series_id)}
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={mapping.weights[a.series_id as string] ?? ''}
              onChange={e => setWeight(sel.cpv_code, a.series_id as string, parseFloat(e.target.value) || 0)}
              style={{
                width: 70, padding: '4px 6px', borderRadius: 4, fontSize: 13, textAlign: 'right',
                border: '1px solid var(--color-border)', background: 'var(--color-bg-input)',
                color: 'var(--color-text-primary)', fontFamily: 'monospace',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>%</span>
          </div>
        ))}
        <div style={{ fontSize: 12, marginTop: 4, color: Math.abs(total - 100) <= 0.01 ? 'var(--color-text-success)' : 'var(--color-text-warning)' }}>
          Totale pesi: {total.toFixed(2)}% {Math.abs(total - 100) <= 0.01 ? '✓' : '(deve essere 100%)'}
        </div>
      </div>
    )
  }

  const renderMappingForCpv = (sel: CpvSelection) => {
    const mapping = mappings[sel.cpv_code]
    if (mappingLoading && !mapping) {
      return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Caricamento mapping Tabella D…</div>
    }
    if (!mapping) {
      return <div style={{ fontSize: 13, color: 'var(--color-text-error)' }}>Mapping non disponibile</div>
    }

    if (mapping.table_class === null) {
      return (
        <div>
          <div style={{
            padding: '10px 12px', background: 'var(--color-bg-warning)',
            color: 'var(--color-text-warning)', borderRadius: 8, fontSize: 13, marginBottom: 10,
          }}>
            Il CPV non è elencato in Tabella D: selezione manuale dell'indice (Art. 11.4, Allegato II.2-bis).
          </div>
          <button
            type="button"
            onClick={() => loadFamilyCandidates(sel.cpv_code)}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'var(--color-bg-card)', cursor: 'pointer', fontSize: 13, marginBottom: 8,
            }}
          >
            Carica indici suggeriti
          </button>
          {mapping.familyCandidates.length > 0 && (
            <select
              value={mapping.manualSingle || ''}
              onChange={e => setManualSingle(sel.cpv_code, e.target.value || null)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-border)', background: 'var(--color-bg-input)',
                color: 'var(--color-text-primary)', fontSize: 13,
              }}
            >
              <option value="">— Seleziona indice —</option>
              {mapping.familyCandidates.map((s, i) => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          )}
        </div>
      )
    }

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
            background: 'var(--color-primary)', color: 'var(--color-primary-text)',
          }}>
            Tabella {mapping.table_class}
          </span>
          {mapping.resolved_cpv_code && mapping.resolved_cpv_code !== sel.cpv_code && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              risolto da {mapping.resolved_cpv_code} (Art. 11.2d)
            </span>
          )}
        </div>

        {mapping.table_class === 'D1' && mapping.associations.map((a, i) => (
          <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
            <input
              type="radio"
              name={`cpv-single-${sel.cpv_code}`}
              checked={mapping.manualSingle === a.series_id}
              onChange={() => setManualSingle(sel.cpv_code, a.series_id)}
            />
            <span>
              <strong>{a.index_type}</strong> [{a.ateco_code}] {a.description}
              {a.series_id && <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>({a.series_id})</span>}
              {!a.available && <span style={{ color: 'var(--color-text-warning)', marginLeft: 6 }}>— dati non disponibili</span>}
              {coverageNote(a.series_id)}
            </span>
          </label>
        ))}

        {mapping.table_class === 'D2' && (
          <div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" checked={mapping.mode === 'single'} onChange={() => setMode(sel.cpv_code, 'single')} />
                Indice singolo
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="radio" checked={mapping.mode === 'weighted'} onChange={() => setMode(sel.cpv_code, 'weighted')} />
                Ponderazione
              </label>
            </div>
            {mapping.mode === 'single' ? (
              <select
                value={mapping.manualSingle || ''}
                onChange={e => setManualSingle(sel.cpv_code, e.target.value || null)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid var(--color-border)', background: 'var(--color-bg-input)',
                  color: 'var(--color-text-primary)', fontSize: 13,
                }}
              >
                <option value="">— Seleziona indice —</option>
                {mapping.associations.filter(a => a.series_id).map((a, i) => (
                  <option key={i} value={a.series_id as string}>{a.index_type} [{a.ateco_code}] {a.description}</option>
                ))}
              </select>
            ) : renderWeights(mapping, sel)}
            {mapping.mode === 'single' && coverageNote(mapping.manualSingle)}
          </div>
        )}

        {mapping.table_class === 'D3' && renderWeights(mapping, sel)}
      </div>
    )
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-2">Tipo di Contratto</h2>
            <p className="text-gray-600 mb-6">
              Seleziona la tipologia di contratto per determinare i parametri normativi applicabili
            </p>
            <ContractTypeSelector
              value={data.contract_type}
              onChange={(type) => setDataField('contract_type', type)}
            />
          </div>
        )

      case 2:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-2">Classificazione</h2>
            <p className="text-gray-600 mb-6">
              {data.contract_type === 'works'
                ? 'Seleziona le TOL (Tipologie Omogenee Lavorazioni) applicabili al contratto'
                : 'Inserisci uno o più codici CPV e i codici ATECO presenti nel testo contrattuale'
              }
            </p>

            {data.contract_type === 'works' ? (
              <TolSelector
                value={data.tol_selections || []}
                onChange={(selections) => setDataField('tol_selections', selections)}
                multiSelect={true}
              />
            ) : (
              <div className="space-y-6">
                {/* CPV selections */}
                <div>
                  <label className="block text-sm font-medium mb-2">Codici CPV</label>
                  <div className="space-y-3">
                    {data.cpv_selections.map((sel, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={sel.cpv_code}
                            readOnly
                            placeholder="CPV selezionato"
                            className="w-full px-4 py-2 border rounded-lg bg-gray-50 font-mono"
                          />
                          {sel.description && (
                            <p className="text-xs text-gray-500 mt-1">{sel.description}</p>
                          )}
                        </div>
                        {data.cpv_selections.length > 1 && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={sel.weight ?? ''}
                              onChange={e => updateCpvWeight(i, e.target.value ? parseFloat(e.target.value) : undefined)}
                              placeholder="peso %"
                              className="w-20 px-2 py-2 border rounded-lg text-sm"
                            />
                            <span className="text-xs text-gray-500">%</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeCpv(i)}
                          className="px-3 py-2 border rounded-lg text-red-600 hover:bg-red-50 text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {data.cpv_selections.length > 1 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Pesi CPV = ripartizione dell'importo tra le prestazioni (Art. 13)
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setCpvModalOpen(true)}
                    className="mt-3 px-4 py-2 border border-dashed rounded-lg text-sm font-medium text-gray-600 w-full hover:bg-gray-50"
                  >
                    + Aggiungi CPV
                  </button>
                </div>

                {/* ATECO from contract text */}
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Codici ATECO dal testo contrattuale
                  </label>
                  <div className="space-y-3">
                    {data.ateco_selections.map((at, i) => (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={atecoInputs[String(i)] ?? at.ateco_code}
                              onChange={e => onAtecoInput(i, e.target.value)}
                              onFocus={() => {
                                if (!at.ateco_code) return
                                fetch(`/api/v1/ateco/search?q=${encodeURIComponent(at.ateco_code)}`)
                                  .then(res => res.json())
                                  .then(body => setAtecoSuggestions(isRecord(body) && Array.isArray(body['results']) ? body['results'].filter(isRecord).map(r => ({
                                    code: String(r['code'] ?? ''),
                                    description: String(r['description'] ?? ''),
                                  })) : []))
                                  .catch(() => setAtecoSuggestions([]))
                              }}
                              placeholder="es. 26.3, 95.1"
                              className="w-full px-4 py-2 border rounded-lg"
                            />
                            {atecoSuggestions.length > 0 && (
                              <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-auto">
                                {atecoSuggestions.map(s => (
                                  <button
                                    key={s.code}
                                    type="button"
                                    onClick={() => pickAteco(i, s.code, s.description)}
                                    className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                                  >
                                    <span className="font-mono font-semibold">{s.code}</span>
                                    <span className="text-gray-500 ml-2">{s.description}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={at.weight || ''}
                            onChange={e => updateAtecoWeight(i, parseFloat(e.target.value) || 0)}
                            placeholder="peso %"
                            className="w-20 px-2 py-2 border rounded-lg text-sm"
                          />
                          <span className="text-xs text-gray-500">%</span>
                          <button
                            type="button"
                            onClick={() => removeAteco(i)}
                            className="px-3 py-2 border rounded-lg text-red-600 hover:bg-red-50 text-sm"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addAteco}
                    className="mt-3 px-4 py-2 border border-dashed rounded-lg text-sm font-medium text-gray-600 w-full hover:bg-gray-50"
                  >
                    + Aggiungi codice ATECO
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Incidenza manodopera/materiali dal bando (Art. 11.3, Tabella D punto 7)
                  </p>
                </div>
              </div>
            )}
          </div>
        )

      case 3:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-2">Dati Contrattuali</h2>
            <p className="text-gray-600 mb-6">
              Inserisci l'importo assoggettabile a revisione e i periodi di riferimento
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Importo assoggettabile a revisione (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={data.amount || ''}
                  onChange={(e) => setDataField('amount', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="es. 100000.00"
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  Periodo base (mese aggiudicazione) — deve precedere il periodo di confronto
                </label>
                <input
                  type="month"
                  value={data.base_period ? data.base_period.substring(0, 7) : ''}
                  onChange={(e) => setDataField('base_period', `${e.target.value}-01`)}
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14,
                    fontFamily: 'inherit', boxSizing: 'border-box',
                    background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                    colorScheme: 'dark',
                  }}
                />
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  Il mese e anno di aggiudicazione del contratto (indice di riferimento)
                </p>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  Periodo confronto (mese rilevazione) — deve seguire il periodo base
                </label>
                <input
                  type="month"
                  value={data.comparison_period ? data.comparison_period.substring(0, 7) : ''}
                  onChange={(e) => setDataField('comparison_period', `${e.target.value}-01`)}
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14,
                    fontFamily: 'inherit', boxSizing: 'border-box',
                    background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                    colorScheme: 'dark',
                  }}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Il mese e anno di rilevazione corrente (indice da confrontare)
                </p>
                {data.base_period && data.comparison_period && data.base_period > data.comparison_period && (
                  <p style={{ fontSize: 12, color: 'var(--color-text-error)', marginTop: 4 }}>
                    Il periodo base deve precedere il periodo di confronto: con l'ordine inverso
                    la variazione risulterebbe col segno invertito. Correggi i periodi.
                  </p>
                )}
              </div>
            </div>
          </div>
        )

      case 4:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-2">Indici ISTAT</h2>
            <p className="text-gray-600 mb-6">
              Associazione CPV → indici secondo la Tabella D (Allegato II.2-bis)
            </p>

            {data.cpv_selections.length > 0 && (
              <div className="space-y-6">
                {data.cpv_selections.map((sel, i) => (
                  <div key={i} className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h3 className="font-semibold mb-2 text-sm">
                      {sel.cpv_code}
                      {sel.description && <span className="font-normal text-gray-600 ml-2">{sel.description}</span>}
                    </h3>
                    {renderMappingForCpv(sel)}
                  </div>
                ))}
              </div>
            )}

            <div className="p-6 bg-blue-50 rounded-lg border border-blue-200 mt-6">
              <h3 className="font-semibold mb-3">Riepilogo configurazione:</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-700">Tipo contratto:</span>
                  <span className="font-medium">
                    {data.contract_type === 'works' ? 'Lavori' :
                     data.contract_type === 'services' ? 'Servizi' : 'Forniture'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">Classificazione:</span>
                  <span className="font-medium">
                    {data.contract_type === 'works'
                      ? `${data.tol_selections?.length || 0} TOL selezionate`
                      : data.cpv_selections.map(s => s.cpv_code).join(', ')
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">Importo:</span>
                  <span className="font-medium">
                    € {data.amount.toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-700">Periodo:</span>
                  <span className="font-medium">
                    {data.base_period.substring(0, 7)} → {data.comparison_period.substring(0, 7)}
                  </span>
                </div>
              </div>
            </div>

            {mappingIssues().length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                {mappingIssues().map((issue, i) => (
                  <p key={i} className="text-sm text-amber-800">{issue}</p>
                ))}
              </div>
            )}

            <p className="text-sm text-gray-600 mt-4">
              Premi "Calcola" per eseguire il calcolo della revisione prezzi
            </p>
          </div>
        )

      case 5:
        return (
          <div>
            {reportData ? (
              <ReportV2View reportData={reportData} />
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">Caricamento report...</p>
              </div>
            )}
          </div>
        )

      default:
        return <div>Step non implementato</div>
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Timeline avanzamento */}
      <WizardTimeline
        steps={['Contratto', 'Classificazione', 'Importi', 'Indici', 'Report']}
        currentStep={currentStep}
      />

      {/* Error display */}
      {error && !initialLoading && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <pre className="text-red-800 text-sm whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      {/* Step content */}
      <div className="mb-8">
        {initialLoading ? (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4" />
            <p className="text-gray-500">Caricamento dati pratica...</p>
          </div>
        ) : renderStep()}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button
          onClick={handleBack}
          disabled={currentStep === 1 || loading || initialLoading}
          className="px-6 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ← Indietro
        </button>

        {currentStep < totalSteps ? (
          <button
            onClick={handleNext}
            disabled={!canProceed() || loading || initialLoading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {currentStep === 4 ? (loading ? 'Calcolo...' : 'Calcola') : 'Avanti →'}
          </button>
        ) : (
          <button
            onClick={() => navigate('/cases')}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Chiudi
          </button>
        )}
      </div>

      <CpvSearchModal
        open={cpvModalOpen}
        onClose={() => setCpvModalOpen(false)}
        onSelect={(code, desc) => addCpv(code, desc)}
      />
    </div>
  )
}
