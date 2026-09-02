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
  saved_query?: { id: string; url: string; dataflow_id: string; key_part: string; end_period_strategy: string; start_period_strategy: string; last_run_at: string | null } | null
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

const MONTH_LABELS_V2 = [
  ['01', 'Gennaio'], ['02', 'Febbraio'], ['03', 'Marzo'], ['04', 'Aprile'],
  ['05', 'Maggio'], ['06', 'Giugno'], ['07', 'Luglio'], ['08', 'Agosto'],
  ['09', 'Settembre'], ['10', 'Ottobre'], ['11', 'Novembre'], ['12', 'Dicembre'],
] as const

function parseMonthValueV2(value: string): [string, string] {
  const s = (value || '').slice(0, 7)
  const [year, month] = s.split('-')
  return [year || '', month || '']
}

function buildYearRangeV2(): string[] {
  const cur = new Date().getFullYear()
  const years: string[] = []
  for (let y = cur - 15; y <= cur + 15; y++) years.push(String(y))
  return years
}

function MonthYearPicker({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
}) {
  const [seedYear, seedMonth] = parseMonthValueV2(value)
  const [year, setYear] = useState(seedYear)
  const [month, setMonth] = useState(seedMonth)
  const years = buildYearRangeV2()

  useEffect(() => {
    const [y, m] = parseMonthValueV2(value)
    setYear(y)
    setMonth(m)
  }, [value])

  const selectStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 12px',
    border: '1.5px solid var(--color-border)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  }

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <select
        id={id ? `${id}-month` : undefined}
        value={month}
        onChange={e => {
          const m = e.target.value
          setMonth(m)
          if (year && m) onChange(`${year}-${m}-01`)
          else onChange('')
        }}
        style={selectStyle}
        aria-label="Mese"
      >
        <option value="">Mese</option>
        {MONTH_LABELS_V2.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select
        id={id ? `${id}-year` : undefined}
        value={year}
        onChange={e => {
          const y = e.target.value
          setYear(y)
          if (y && month) onChange(`${y}-${month}-01`)
          else onChange('')
        }}
        style={selectStyle}
        aria-label="Anno"
      >
        <option value="">Anno</option>
        {years.map(y => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}
export default function CaseWizardV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    document.getElementById('__print_style_v2')?.remove()
    const style = document.createElement('style')
    style.id = '__print_style_v2'
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #print-area-v2, #print-area-v2 * { visibility: visible !important; }
        #print-area-v2 { position: absolute; left: 0; top: 0; width: 100%; }
        #root > div > nav { display: none !important; }
        button, .no-print { display: none !important; }
        @page { margin: 15mm; }
      }
    `
    document.head.appendChild(style)
    window.print()
    const cleanup = () => {
      document.getElementById('__print_style_v2')?.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
  }

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
  const [sdmxReloading, setSdmxReloading] = useState<Record<string, boolean>>({})
  const [sdmxReloadMsg, setSdmxReloadMsg] = useState<Record<string, { status: 'done' | 'error'; msg: string }>>({})
  const [cpvModalOpen, setCpvModalOpen] = useState(false)
  const [atecoSuggestions, setAtecoSuggestions] = useState<{ code: string; description: string }[]>([])
  const [activeAtecoIndex, setActiveAtecoIndex] = useState<number | null>(null)
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
    const d = dataRef.current
    const primary = d.cpv_selections[0]
    try {
      await fetch(`/api/v1/cases/${id}/wizard-v2`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_step: nextStep ?? currentStep,
          contract_type: d.contract_type,
          tol_selections: d.tol_selections || [],
          cpv_code: primary?.cpv_code || d.cpv_code || null,
          cpv_description: primary?.description || d.cpv_description || null,
          cpv_selections: d.cpv_selections,
          ateco_selections: d.ateco_selections,
          amount: d.amount,
          base_period: d.base_period || null,
          comparison_period: d.comparison_period || null,
          indices_config: d.indices_config || null,
          result: d.result || null,
        })
      })
    } catch (err) {
      console.error('Errore salvataggio wizard:', err)
    }
  }, [id, currentStep])
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

  const addCpv = async (code: string, description: string): Promise<void> => {
    if (dataRef.current.cpv_selections.some(sel => sel.cpv_code === code)) return
    setData(prev => {
      if (prev.cpv_selections.some(sel => sel.cpv_code === code)) return prev
      const list = [...prev.cpv_selections, { cpv_code: code, description, weight: undefined }]
      return { ...prev, cpv_selections: list, cpv_code: list[0].cpv_code, cpv_description: list[0].description, indices_config: undefined, result: null }
    })
    setCpvModalOpen(false)
    invalidateDerivedForClassificationChange()
    try {
      const res = await fetch('/api/v1/classify/cpv-index-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpv_code: code }),
      })
      if (!res.ok) return
      const body: unknown = await res.json()
      if (!isRecord(body)) return
      const tableClass = asNullableString(body['table_class'])
      if (tableClass !== 'D2' && tableClass !== 'D3') return
      const rawAssocs = Array.isArray(body['associations']) ? body['associations'] : []
      const assocs = rawAssocs.filter(isRecord).filter(a => String(a['classification'] ?? '') === 'ATECO' && String(a['ateco_code'] ?? '').trim() !== '')
      if (assocs.length === 0) return
      const uniqueCodes = [...new Set(assocs.map(a => String(a['ateco_code']).trim()).filter(Boolean))]
      if (uniqueCodes.length === 0) return
      const descByCode: Record<string, string> = {}
      for (const a of assocs) {
        const k = String(a['ateco_code']).trim()
        if (k) descByCode[k] = String(a['description'] ?? '')
      }
      const baseAteco = dataRef.current.ateco_selections
      const existingSet0 = new Set(baseAteco.map(s => normalizeAteco(s.ateco_code)))
      const toAdd0 = uniqueCodes.filter(c => !existingSet0.has(normalizeAteco(c)))
      if (toAdd0.length === 0) return
      setData(prev => {
        const base = prev.ateco_selections
        const existingSet = new Set(base.map(s => normalizeAteco(s.ateco_code)))
        const filteredToAdd = uniqueCodes.filter(c => !existingSet.has(normalizeAteco(c)))
        if (filteredToAdd.length === 0) return prev
        const n = base.length + filteredToAdd.length
        const w = Math.floor(100 / n)
        const rem = 100 - w * n
        const adj = base.length > 0 ? base.map((s, i) => ({ ...s, weight: w + (i === 0 ? rem : 0) })) : []
        const news = base.length > 0
          ? filteredToAdd.map(c => ({ ateco_code: c, weight: w }))
          : filteredToAdd.map((c, i) => ({ ateco_code: c, weight: w + (i === 0 ? rem : 0) }))
        return { ...prev, ateco_selections: [...adj, ...news], result: null }
      })
      setAtecoInputs(prev => {
        const existingDisplayCodes = new Set(Object.values(prev).map(v => normalizeAteco(String(v).split(' —')[0] ?? String(v))))
        const existingDataCodes = new Set(dataRef.current.ateco_selections.map(s => normalizeAteco(s.ateco_code)))
        const combined = new Set([...existingDisplayCodes, ...existingDataCodes])
        const filteredForInput = toAdd0.filter(c => !combined.has(normalizeAteco(c)))
        // fallback to toAdd0 if combined dedup leaves empty but data dedup would have added some (race); ensure we use filtered from data perspective
        const effective = filteredForInput.length > 0 ? filteredForInput : toAdd0.filter(c => !existingDisplayCodes.has(normalizeAteco(c)))
        if (effective.length === 0) return prev
        const baseLen = Object.keys(prev).length
        const out: Record<string, string> = { ...prev }
        effective.forEach((c, i) => {
          const d = descByCode[c] ?? ''
          const display = d ? `${c} — ${d}` : c
          out[String(baseLen + i)] = display.trim()
        })
        return out
      })
      setAtecoSuggestions([])
      setActiveAtecoIndex(null)
    } catch {
      return
    }
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
    setActiveAtecoIndex(atIndex)
    setAtecoInputs(prev => ({ ...prev, [String(atIndex)]: value }))
    setData(prev => {
      const list = prev.ateco_selections.map((sel, i) => i === atIndex ? { ...sel, ateco_code: value } : sel)
      return { ...prev, ateco_selections: list, result: null }
    })
    if (!value.trim()) {
      setAtecoSuggestions([])
      setActiveAtecoIndex(null)
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
    setActiveAtecoIndex(null)
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
    setActiveAtecoIndex(null)
    setAtecoSuggestions([])
    setAtecoInputs(prev => {
      const next: Record<string, string> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k)
        if (Number.isNaN(idx)) return
        if (idx === atIndex) return
        if (idx > atIndex) next[String(idx - 1)] = v
        else next[k] = v
      })
      return next
    })
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
  const fetchPeriodCoverage = useCallback(async () => {
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
    try {
      const res = await fetch('/api/v1/calculation/v2/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: series,
          base_period: data.base_period,
          comparison_period: data.comparison_period,
        }),
      })
      if (!res.ok) {
        setPeriodCoverage(null)
        return
      }
      const body: unknown = await res.json()
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
    } catch {
      setPeriodCoverage(null)
    } finally {
      setCoverageLoading(false)
    }
  }, [currentStep, mappings, data.base_period, data.comparison_period, data.cpv_selections])

  useEffect(() => {
    void fetchPeriodCoverage()
  }, [fetchPeriodCoverage])

  const pollImportJob = async (jobId: string): Promise<unknown> => {
    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, 3000))
      const res = await fetch(`/api/v1/indices/import-jobs/${encodeURIComponent(jobId)}`)
      if (!res.ok) throw new Error('Errore nel controllo dell\'import')
      const job: unknown = await res.json()
      if (isRecord(job)) {
        const status = String(job['status'] ?? '')
        if (status === 'done') return job
        if (status === 'error') throw new Error(String(job['error'] ?? 'Errore importazione'))
      }
    }
    throw new Error('Tempo scaduto: Istat non ha risposto entro 15 minuti. Riprova.')
  }

  const handleReloadSdmx = async (seriesId: string) => {
    const cov = periodCoverage?.[seriesId]
    const qid = cov?.saved_query?.id
    if (!qid || sdmxReloading[seriesId]) return
    setSdmxReloading(prev => ({ ...prev, [seriesId]: true }))
    setSdmxReloadMsg(prev => {
      const next = { ...prev }
      delete next[seriesId]
      return next
    })
    try {
      const res = await fetch(`/api/v1/indices/saved-queries/${encodeURIComponent(qid)}/run`, { method: 'POST' })
      if (!res.ok) {
        let detail = await res.text()
        try {
          const j: unknown = JSON.parse(detail)
          if (isRecord(j) && typeof j['detail'] === 'string' && j['detail']) detail = j['detail']
        } catch { /* ignore */ }
        throw new Error(detail || 'Errore riscarica')
      }
      const body: unknown = await res.json()
      const jobId = isRecord(body) ? String(body['job_id'] ?? '') : ''
      if (!jobId) throw new Error('job_id mancante')
      const job = await pollImportJob(jobId) as Record<string, unknown>
      const details = isRecord(job['result']) && isRecord(job['result']['details']) ? job['result']['details'] as Record<string, unknown> : null
      const added = details ? String(details['added'] ?? '0') : '0'
      const updated = details ? String(details['updated'] ?? '0') : '0'
      const suffix = isRecord(body) && isRecord(body['resolved_meta']) && typeof body['resolved_meta']['endPeriod'] === 'string' && body['url'] !== body['original_url'] ? ` (endPeriod ${String(body['resolved_meta']['endPeriod'])})` : ''
      setSdmxReloadMsg(prev => ({ ...prev, [seriesId]: { status: 'done', msg: `Riscaricata ${cov?.saved_query?.dataflow_id ?? seriesId}: ${added} aggiunte, ${updated} aggiornate${suffix}` } }))
      await fetchPeriodCoverage()
      // se la serie era non disponibile, aggiorna anche i mapping per riflettere dati nuovi
      // trigger leggero: ricarica mapping senza cambiare pesi
      // (fetchMappings già chiamato all'ingresso step; qui solo coverage basta)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSdmxReloadMsg(prev => ({ ...prev, [seriesId]: { status: 'error', msg } }))
    } finally {
      setSdmxReloading(prev => ({ ...prev, [seriesId]: false }))
    }
  }

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
      // Salva anche su RevisionResult per report stabile dopo reopen (wizard state da solo non basta)
      if (id) {
        try {
          await fetch(`/api/v1/report/v2/cases/${id}/calculation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
          })
        } catch (e) {
          console.warn('Salvataggio report fallito', e)
        }
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
      const effectiveRaw = isRecord(calcResult) ? calcResult as unknown as CalcResultLike : (d.result as unknown as CalcResultLike | null)
      // Normalizza multi-componente (overall_*) come fa il backend per RevisionResult
      let effective: any = effectiveRaw
      if (effectiveRaw && (effectiveRaw as any).is_multi_component) {
        const anyEff: any = effectiveRaw
        effective = {
          ...anyEff,
          variation_percent: anyEff.variation_percent ?? anyEff.overall_variation_percent,
          revision_amount: anyEff.revision_amount ?? anyEff.overall_revision_amount,
          // threshold_exceeded già presente nel multi, ma fallback se manca
          threshold_exceeded: anyEff.threshold_exceeded ?? (anyEff.overall_variation_percent != null && anyEff.threshold_percent != null ? Math.abs(anyEff.overall_variation_percent) > Math.abs(anyEff.threshold_percent) : null),
          steps: anyEff.steps ?? anyEff.overall_steps ?? [],
        }
      }
      const sections = report.sections.map(sec => {
        const title = sec.title || ''
        const secData = sec.data && typeof sec.data === 'object' ? sec.data : {}
        if (title === 'Importi e Date') {
          return { ...sec, data: { ...secData, contract_amount: d.amount, revisable_amount: d.amount, base_period: d.base_period, comparison_period: d.comparison_period } }
        }
        if (title === 'Indici ISTAT' && effective) {
          return (() => {
            const step1 = (effective.steps ?? []).find((s: any) => s.step === 1)
            const d1 = step1?.details
            return { ...sec, data: { ...secData, synthetic_index_base: (effective as any).base_value, synthetic_index_comparison: (effective as any).comparison_value, components: (effective as any).weighted_component_variations ?? null, component_details: d1 ? d1['component_details'] ?? null : null, calc_formula: d1 ? d1['formula'] ?? null : null, calc_math: d1 ? d1['calculation'] ?? null : null } }
          })()
        }
        if (title === 'Risultato Calcolo' && effective) {
          const vp = (effective as any).variation_percent
          // Se il risultato effettivo non ha variazione (es. calcolo non eseguito), non sovrascrivere il dato backend (che potrebbe già contenere il risultato persistito)
          if (vp == null && (effective as any).overall_variation_percent == null) {
            // prova a mantenere il dato backend se già presente, altrimenti mostra comunque il dato effettivo (che sarà null e triggera il blu, ma è corretto)
            const hasBackendVariation = (secData as any).variation_percent != null
            if (hasBackendVariation) return sec
          }
          return { ...sec, data: { variation_percent: (effective as any).variation_percent, threshold_exceeded: (effective as any).threshold_exceeded, revision_amount: (effective as any).revision_amount, revision_type: (effective as any).revision_type, formula_steps: (effective as any).steps || [] } }
        }
        return sec
      })
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
    const reloadMsg = seriesId ? sdmxReloadMsg[seriesId] : undefined
    const reloading = seriesId ? !!sdmxReloading[seriesId] : false
    if (cov.missing) {
      return (
        <span style={{ color: 'var(--color-text-error)', display: 'block', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
          <span>Nessun dato definitivo nei periodi richiesti: il calcolo fallirebbe per questa serie.</span>
          {cov.saved_query && (
            <button
              type="button"
              onClick={() => seriesId && handleReloadSdmx(seriesId)}
              disabled={reloading}
              title={`Riscarica ${cov.saved_query.dataflow_id} — end:${cov.saved_query.end_period_strategy} start:${cov.saved_query.start_period_strategy}`}
              style={{
                marginLeft: 8,
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-card)',
                color: 'var(--color-text-secondary)',
                cursor: reloading ? 'not-allowed' : 'pointer',
                opacity: reloading ? 0.6 : 1,
                verticalAlign: 'middle',
              }}
            >
              {reloading ? 'Ricarica…' : '⟳ Ricarica dati'}
            </button>
          )}
          {reloadMsg && (
            <span style={{ display: 'block', marginTop: 4, color: reloadMsg.status === 'done' ? 'var(--color-text-success)' : 'var(--color-text-error)', fontSize: 11, lineHeight: 1.4 }}>
              {reloadMsg.msg}
            </span>
          )}
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
      <span style={{ color: 'var(--color-text-warning)', display: 'block', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
        <span>I periodi richiesti non esistono in questa serie: {notes.join(' · ')}.</span>
        {cov.saved_query && (
          <button
            type="button"
            onClick={() => seriesId && handleReloadSdmx(seriesId)}
            disabled={reloading}
            title={`Riscarica ${cov.saved_query.dataflow_id} — end:${cov.saved_query.end_period_strategy} start:${cov.saved_query.start_period_strategy}`}
            style={{
              marginLeft: 8,
              padding: '4px 10px',
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-card)',
              color: 'var(--color-text-secondary)',
              cursor: reloading ? 'not-allowed' : 'pointer',
              opacity: reloading ? 0.6 : 1,
              verticalAlign: 'middle',
            }}
          >
            {reloading ? 'Ricarica…' : '⟳ Ricarica dati'}
          </button>
        )}
        {reloadMsg && (
          <span style={{ display: 'block', marginTop: 4, color: reloadMsg.status === 'done' ? 'var(--color-text-success)' : 'var(--color-text-error)', fontSize: 11, lineHeight: 1.4 }}>
            {reloadMsg.msg}
          </span>
        )}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {(data.cpv_selections.length === 0 && data.amount === 0 && data.contract_type === '' && !initialLoading) && (
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-light)',
                  boxShadow: '0 1px 2px var(--color-shadow)',
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: 'var(--color-bg-info)',
                    border: '1px solid var(--color-border-info)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 14,
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  ✦
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.35 }}>
                    Percorso rapido (5 passi) — ideale per servizi e forniture standard
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45, marginTop: 2 }}>
                    Hai aperto la pratica senza dati estratti. Se è un lavoro complesso, puoi passare al percorso completo in un click.
                  </div>
                </div>
                <button
                  onClick={() => { if (id) navigate(`/cases/${id}/wizard/1`) }}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background: 'var(--color-bg-card)',
                    color: 'var(--color-text-primary)',
                    border: '1.5px solid var(--color-border)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Passa a 7 passi
                </button>
              </div>
            )}
            <div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 10px',
                  borderRadius: 999,
                  background: 'var(--color-bg-muted)',
                  border: '1px solid var(--color-border-light)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-muted)',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--color-primary)',
                  }}
                  aria-hidden
                />
                Passo 1 di 5
                <span style={{ opacity: 0.45 }}>·</span>
                Tipo di contratto
              </div>
              <h2
                style={{
                  margin: '14px 0 8px',
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                  color: 'var(--color-text-primary)',
                }}
              >
                Che tipo di contratto stai ricalcolando?
              </h2>
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: 'var(--color-text-muted)',
                  maxWidth: 580,
                }}
              >
                La scelta determina soglie, coefficienti e classificazione (CPV o TOL) dei passi successivi. Potrai modificarla in seguito.
              </p>
            </div>
            <ContractTypeSelector
              value={data.contract_type}
              onChange={(type) => setDataField('contract_type', type)}
            />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-light)', lineHeight: 1.5 }}>
              Suggerimento: per servizi/forniture standard il <strong style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>percorso rapido</strong> è più veloce; per lavori complessi usa il percorso completo (7 passi).
            </p>
          </div>
        )

      case 2: {
        const isWorks = data.contract_type === 'works'
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 999,
                  background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-primary)' }} aria-hidden />
                Passo 2 di 5
                <span style={{ opacity: 0.45 }}>·</span>
                Classificazione
              </div>
              <h2
                style={{
                  margin: '14px 0 8px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--color-text-primary)',
                }}
              >
                {isWorks ? 'Quali lavorazioni comprende l’appalto?' : 'Come è classificata la prestazione?'}
              </h2>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-text-muted)', maxWidth: 580 }}>
                {isWorks
                  ? 'Seleziona le TOL (Tipologie Omogenee Lavorazioni). Se più di una, ripartisci i pesi fino a 100%.'
                  : 'Aggiungi i codici CPV e, se presenti nel bando, i codici ATECO per affinare i pesi Tabella D.'}
              </p>
            </div>

            {isWorks ? (
              <TolSelector value={data.tol_selections || []} onChange={selections => setDataField('tol_selections', selections)} multiSelect={true} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* CPV */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                      Codici CPV
                      {data.cpv_selections.length > 0 && (
                        <span style={{ marginLeft: 8, padding: '2px 7px', borderRadius: 999, background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', color: 'var(--color-text-info)', fontSize: 10 }}>
                          {data.cpv_selections.length} selezionat{data.cpv_selections.length === 1 ? 'o' : 'i'}
                        </span>
                      )}
                    </div>
                    {data.cpv_selections.length > 1 && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>Pesi = ripartizione importo (Art. 13)</span>
                    )}
                  </div>

                  {data.cpv_selections.length === 0 ? (
                    <div
                      style={{
                        padding: 18, borderRadius: 12, border: '1.5px dashed var(--color-border)', background: 'var(--color-bg-muted)',
                        textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.5,
                      }}
                    >
                      Nessun CPV ancora. Aggiungi il codice principale del bando — potrai aggiungerne altri con pesi.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {data.cpv_selections.map((sel, i) => (
                        <div
                          key={sel.cpv_code + i}
                          style={{
                            display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px',
                            borderRadius: 12, border: '1.5px solid var(--color-border-light)', background: 'var(--color-bg-card)',
                            boxShadow: '0 1px 3px var(--color-shadow)',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)',
                                  background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', padding: '3px 8px', borderRadius: 8,
                                }}
                              >
                                {sel.cpv_code}
                              </span>
                              {i === 0 && (
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-info)', background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', padding: '2px 6px', borderRadius: 999 }}>
                                  principale
                                </span>
                              )}
                            </div>
                            {sel.description && (
                              <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{sel.description}</div>
                            )}
                          </div>

                          {data.cpv_selections.length > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                                Peso
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.01}
                                value={sel.weight ?? ''}
                                onChange={e => updateCpvWeight(i, e.target.value ? parseFloat(e.target.value) : undefined)}
                                placeholder="—"
                                style={{
                                  width: 74, padding: '7px 8px', borderRadius: 8, fontSize: 13, fontFamily: 'ui-monospace, monospace', textAlign: 'right',
                                  border: '1.5px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', outline: 'none',
                                }}
                              />
                              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 700 }}>%</span>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => removeCpv(i)}
                            aria-label={`Rimuovi CPV ${sel.cpv_code}`}
                            style={{
                              width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
                              border: '1.5px solid var(--color-border-light)', background: 'var(--color-bg-card)', color: 'var(--color-text-light)',
                              cursor: 'pointer', fontSize: 14, fontWeight: 700, transition: 'all 120ms',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-error)'; e.currentTarget.style.color = 'var(--color-text-error)'; e.currentTarget.style.borderColor = 'var(--color-border-error)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; e.currentTarget.style.color = 'var(--color-text-light)'; e.currentTarget.style.borderColor = 'var(--color-border-light)' }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setCpvModalOpen(true)}
                    style={{
                      marginTop: 12, width: '100%', padding: '13px 16px', borderRadius: 12, border: '1.5px dashed var(--color-border)', background: 'var(--color-bg-card)',
                      color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all 120ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'var(--color-bg-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-bg-card)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                  >
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--color-primary)', color: 'var(--color-primary-text)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>＋</span>
                    Aggiungi CPV
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}>— cerca per codice o descrizione</span>
                  </button>
                </div>

                {/* ATECO */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                    Codici ATECO dal testo contrattuale
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-light)', marginLeft: 8, fontSize: 11 }}>
                      opzionali — affinano i pesi (Art. 11.3)
                    </span>
                  </div>

                  {data.ateco_selections.length === 0 ? (
                    <div
                      style={{
                        padding: 14, borderRadius: 12, border: '1px solid var(--color-border-light)', background: 'var(--color-bg-muted)',
                        fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5,
                      }}
                    >
                      Se nel bando sono indicati ATECO (es. 26.3, 95.1), aggiungili per ripartire con precisione i pesi tra PPI e retribuzioni.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {data.ateco_selections.map((at, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px',
                            borderRadius: 12, border: '1.5px solid var(--color-border-light)', background: 'var(--color-bg-card)',
                            boxShadow: '0 1px 3px var(--color-shadow)', position: 'relative' as const,
                          }}
                        >
                          <div style={{ flex: 1, position: 'relative' as const }}>
                            <input
                              type="text"
                              value={atecoInputs[String(i)] ?? at.ateco_code}
                              onChange={e => onAtecoInput(i, e.target.value)}
                              onFocus={() => {
                                setActiveAtecoIndex(i)
                                if (!at.ateco_code) return
                                fetch(`/api/v1/ateco/search?q=${encodeURIComponent(at.ateco_code)}`)
                                  .then(res => res.json())
                                  .then(body =>
                                    setAtecoSuggestions(
                                      isRecord(body) && Array.isArray(body['results'])
                                        ? (body['results'] as unknown[])
                                            .filter(isRecord)
                                            .map(r => ({ code: String((r as Record<string, unknown>)['code'] ?? ''), description: String((r as Record<string, unknown>)['description'] ?? '') }))
                                        : []
                                    )
                                  )
                                  .catch(() => setAtecoSuggestions([]))
                              }}
                              onBlur={() => {
                                // ritarda per permettere click sulla tendina prima di chiudere
                                setTimeout(() => {
                                  setActiveAtecoIndex(prev => (prev === i ? null : prev))
                                }, 180)
                              }}
                              placeholder="es. 26.3 — fabbricazione computer"
                              style={{
                                width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 13,
                                border: '1.5px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', outline: 'none',
                              }}
                            />
                            {activeAtecoIndex === i && atecoSuggestions.length > 0 && (
                              <div
                                style={{
                                  position: 'absolute' as const, zIndex: 10, marginTop: 6, width: '100%',
                                  background: 'var(--color-bg-card)', border: '1px solid var(--color-border-light)', borderRadius: 12,
                                  boxShadow: '0 12px 28px var(--color-shadow-heavy)', maxHeight: 192, overflow: 'auto', padding: 6,
                                }}
                              >
                                {atecoSuggestions.map(s => (
                                  <button
                                    key={s.code}
                                    type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => pickAteco(i, s.code, s.description)}
                                    style={{
                                      display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, border: '1px solid transparent',
                                      background: 'transparent', cursor: 'pointer', fontSize: 13,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-muted)'; e.currentTarget.style.borderColor = 'var(--color-border-light)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}
                                  >
                                    <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: 'var(--color-primary)' }}>{s.code}</span>
                                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>{s.description}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                              Peso
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={at.weight || ''}
                              onChange={e => updateAtecoWeight(i, parseFloat(e.target.value) || 0)}
                              placeholder="—"
                              style={{
                                width: 74, padding: '7px 8px', borderRadius: 8, fontSize: 13, fontFamily: 'ui-monospace, monospace', textAlign: 'right',
                                border: '1.5px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', outline: 'none',
                              }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 700 }}>%</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeAteco(i)}
                            aria-label="Rimuovi ATECO"
                            style={{
                              width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
                              border: '1.5px solid var(--color-border-light)', background: 'var(--color-bg-card)', color: 'var(--color-text-light)',
                              cursor: 'pointer', fontSize: 14, fontWeight: 700, transition: 'all 120ms',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-error)'; e.currentTarget.style.color = 'var(--color-text-error)'; e.currentTarget.style.borderColor = 'var(--color-border-error)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-card)'; e.currentTarget.style.color = 'var(--color-text-light)'; e.currentTarget.style.borderColor = 'var(--color-border-light)' }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={addAteco}
                    style={{
                      marginTop: 12, width: '100%', padding: '13px 16px', borderRadius: 12, border: '1.5px dashed var(--color-border)', background: 'var(--color-bg-card)',
                      color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all 120ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'var(--color-bg-muted)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-bg-card)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
                  >
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, color: 'var(--color-text-muted)' }}>
                      ＋
                    </span>
                    Aggiungi codice ATECO
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}>— dal bando</span>
                  </button>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-text-light)', lineHeight: 1.5 }}>
                    Incidenza manodopera/materiali (Art. 11.3, Tabella D punto 7) — se lasci vuoto, i pesi verranno ripartiti in automatico.
                  </p>
                </div>
              </div>
            )}
          </div>
        )
      }

      case 3:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 999,
                  background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-primary)' }} aria-hidden />
                Passo 3 di 5
                <span style={{ opacity: 0.45 }}>·</span>
                Importi e periodi
              </div>
              <h2
                style={{
                  margin: '14px 0 8px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--color-text-primary)',
                }}
              >
                Importo e periodi di riferimento
              </h2>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-text-muted)', maxWidth: 580 }}>
                Inserisci l’importo assoggettabile a revisione e i due mesi che delimitano il calcolo.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  Importo assoggettabile a revisione (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={data.amount || ''}
                  onChange={e => setDataField('amount', parseFloat(e.target.value) || 0)}
                  placeholder="es. 100 000,00"
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 14,
                    border: '1.5px solid var(--color-border)', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-text-light)', lineHeight: 1.4 }}>
                  Solo la quota soggetta a revisione (al netto di oneri non rivalutabili).
                </p>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  Periodo base — mese di aggiudicazione
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-light)', marginLeft: 6, fontSize: 11 }}>
                    (solo mese e anno)
                  </span>
                </label>
                <MonthYearPicker value={data.base_period} onChange={v => setDataField('base_period', v)} id="base-period" />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-text-light)', lineHeight: 1.4 }}>
                  Seleziona dalle tendine mese e anno di aggiudicazione (es. <em>Luglio 2023</em>) — il giorno è sempre il 1º del mese.
                </p>
                {data.base_period && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Selezionato: <strong style={{ color: 'var(--color-text-primary)', fontFamily: 'ui-monospace, monospace' }}>{data.base_period.slice(0, 7)}</strong>
                  </p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  Periodo di confronto — mese di rilevazione
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--color-text-light)', marginLeft: 6, fontSize: 11 }}>
                    (solo mese e anno)
                  </span>
                </label>
                <MonthYearPicker value={data.comparison_period} onChange={v => setDataField('comparison_period', v)} id="comparison-period" />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--color-text-light)', lineHeight: 1.4 }}>
                  Seleziona dalle tendine il mese di rilevazione corrente — deve essere successivo al periodo base.
                </p>
                {data.comparison_period && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    Selezionato: <strong style={{ color: 'var(--color-text-primary)', fontFamily: 'ui-monospace, monospace' }}>{data.comparison_period.slice(0, 7)}</strong>
                  </p>
                )}
                {data.base_period && data.comparison_period && data.base_period > data.comparison_period && (
                  <div
                    style={{
                      marginTop: 8, padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                      background: 'var(--color-bg-error)', color: 'var(--color-text-error)', border: '1px solid var(--color-border-error)',
                      lineHeight: 1.4,
                    }}
                  >
                    Il periodo base deve precedere il confronto — con l’ordine inverso la variazione avrebbe segno invertito.
                  </div>
                )}
              </div>
            </div>
          </div>
        )

      case 4:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 999,
                  background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-primary)' }} aria-hidden />
                Passo 4 di 5
                <span style={{ opacity: 0.45 }}>·</span>
                Indici ISTAT
              </div>
              <h2
                style={{
                  margin: '14px 0 8px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--color-text-primary)',
                }}
              >
                Pesi e serie ISTAT
              </h2>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-text-muted)', maxWidth: 580 }}>
                Associazione CPV → indici secondo Tabella D (All. II.2-bis). Verifica i pesi e la disponibilità dei dati prima di calcolare.
              </p>
            </div>

            {data.cpv_selections.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {data.cpv_selections.map((sel, i) => (
                  <div
                    key={sel.cpv_code + i}
                    style={{
                      padding: 16, borderRadius: 12, border: '1.5px solid var(--color-border-light)', background: 'var(--color-bg-card)',
                      boxShadow: '0 1px 3px var(--color-shadow)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)',
                          background: 'var(--color-bg-info)', border: '1px solid var(--color-border-info)', padding: '3px 8px', borderRadius: 8,
                        }}
                      >
                        {sel.cpv_code}
                      </span>
                      {sel.description && (
                        <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{sel.description}</span>
                      )}
                    </div>
                    {renderMappingForCpv(sel)}
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                padding: 16, borderRadius: 12, background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-light)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                Riepilogo configurazione
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Tipo contratto</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {data.contract_type === 'works' ? 'Lavori' : data.contract_type === 'services' ? 'Servizi' : 'Forniture'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Classificazione</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', textAlign: 'right', maxWidth: 260 }}>
                    {data.contract_type === 'works' ? `${data.tol_selections?.length || 0} TOL` : data.cpv_selections.map(s => s.cpv_code).join(', ')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Importo</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>€ {data.amount.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Periodo</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {data.base_period ? data.base_period.substring(0, 7) : '—'} → {data.comparison_period ? data.comparison_period.substring(0, 7) : '—'}
                  </span>
                </div>
              </div>
            </div>

            {mappingIssues().length > 0 && (
              <div
                style={{
                  padding: '12px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                {mappingIssues().map((issue, idx) => (
                  <p key={idx} style={{ margin: 0, fontSize: 12.5, color: '#92400e', lineHeight: 1.4 }}>
                    • {issue}
                  </p>
                ))}
              </div>
            )}

            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-light)', lineHeight: 1.5 }}>
              Quando i pesi sono a 100% e le serie hanno dati nei periodi scelti, puoi calcolare la revisione.
            </p>
          </div>
        )

      case 5:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {reportData ? (
              <div id="print-area-v2" ref={printRef}>
                <ReportV2View reportData={reportData} />
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: '3px solid var(--color-border)',
                    borderTopColor: 'var(--color-primary)',
                    margin: '0 auto 12px',
                    animation: 'spin 0.8s linear infinite',
                  }}
                  aria-hidden
                />
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Caricamento report...</p>
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 0 0',
          marginTop: 8,
          borderTop: '1px solid var(--color-border-lighter)',
        }}
      >
        <button
          onClick={handleBack}
          disabled={currentStep === 1 || loading || initialLoading}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--color-bg-card)',
            color: 'var(--color-text-secondary)',
            border: '1.5px solid var(--color-border)',
            cursor: currentStep === 1 || loading || initialLoading ? 'not-allowed' : 'pointer',
            opacity: currentStep === 1 || loading || initialLoading ? 0.45 : 1,
            transition: 'all 140ms',
          }}
        >
          ← Indietro
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {currentStep === 1 && !canProceed() && !initialLoading && (
            <span className="hidden sm:inline" style={{ fontSize: 12, color: 'var(--color-text-light)' }}>
              Seleziona un tipo per continuare
            </span>
          )}
          {currentStep < totalSteps ? (
            <button
              onClick={handleNext}
              disabled={!canProceed() || loading || initialLoading}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                background: !canProceed() || loading || initialLoading ? 'var(--color-bg-hover)' : 'var(--color-primary)',
                color: !canProceed() || loading || initialLoading ? 'var(--color-text-light)' : 'var(--color-primary-text)',
                border: !canProceed() || loading || initialLoading ? '1.5px solid var(--color-border-light)' : '1.5px solid var(--color-primary)',
                cursor: !canProceed() || loading || initialLoading ? 'not-allowed' : 'pointer',
                boxShadow: !canProceed() || loading || initialLoading ? 'none' : '0 4px 12px var(--color-shadow)',
                opacity: 1,
                transition: 'all 140ms',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {currentStep === 4 ? (loading ? 'Calcolo…' : 'Calcola') : 'Avanti'}
              <span aria-hidden>{currentStep === 4 ? '✦' : '→'}</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="no-print">
              <button
                onClick={handlePrint}
                disabled={!reportData}
                title={!reportData ? 'Report non ancora pronto' : 'Stampa o salva PDF'}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  background: !reportData ? 'var(--color-bg-hover)' : 'var(--color-bg-card)',
                  color: !reportData ? 'var(--color-text-light)' : 'var(--color-text-secondary)',
                  border: '1.5px solid var(--color-border)',
                  cursor: !reportData ? 'not-allowed' : 'pointer',
                  opacity: !reportData ? 0.6 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span aria-hidden>🖨️</span> Stampa / PDF
              </button>
              <button
                onClick={async () => {
                  if (id && (currentStep >= 5 || reportData || data.result)) {
                    try {
                      await fetch(`/api/v1/cases/${id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'completed', current_step: 5 }),
                      })
                    } catch {
                      // ignora, naviga comunque
                    }
                    try {
                      await saveWizardState(5)
                    } catch {
                      // ignora
                    }
                  }
                  navigate('/')
                }}
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
                Chiudi ✓
              </button>
            </div>
          )}
        </div>
      </div>

      <CpvSearchModal
        open={cpvModalOpen}
        onClose={() => setCpvModalOpen(false)}
        onSelect={(code, desc) => addCpv(code, desc)}
      />
    </div>
  )
}
