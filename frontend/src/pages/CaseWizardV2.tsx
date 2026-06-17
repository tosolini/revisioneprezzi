import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ContractTypeSelector from '../components/ContractTypeSelector'
import TolSelector from '../components/TolSelector'
import RevisionResultCard from '../components/RevisionResultCard'
import ReportV2View from '../components/ReportV2View'

interface TolSelection {
  code: string
  weight: number
}

interface IndicesConfig {
  type: 'single' | 'composite'
  single_series_id?: string
  components?: Record<string, number>
}

interface WizardData {
  // Step 1: Contract type
  contract_type: 'works' | 'services' | 'supplies' | ''
  
  // Step 2: Classification
  tol_selections?: TolSelection[]
  cpv_code?: string
  cpv_description?: string
  
  // Step 3: Contract data
  amount: number
  base_period: string // YYYY-MM-DD
  comparison_period: string // YYYY-MM-DD
  
  // Step 4: Indices (auto-mapped)
  indices_config?: IndicesConfig
  
  // Step 5: Result
  result?: any
}

export default function CaseWizardV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [data, setData] = useState<WizardData>({
    contract_type: '',
    amount: 0,
    base_period: '',
    comparison_period: ''
  })
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(false)
  const [error, setError] = useState('')
  const [reportData, setReportData] = useState<any>(null)

  const totalSteps = 5

  // Carica dati esistenti se presente un case_id
  useEffect(() => {
    if (id) {
      setInitialLoading(true)
      fetch(`/api/v1/cases/${id}/wizard-v2`)
        .then(res => {
          if (!res.ok) throw new Error('Errore caricamento wizard')
          return res.json()
        })
        .then(res => {
          const s = res.state
          setData({
            contract_type: s.contract_type || '',
            tol_selections: s.tol_selections || [],
            cpv_code: s.cpv_code || '',
            cpv_description: s.cpv_description || '',
            amount: s.amount || 0,
            base_period: s.base_period || '',
            comparison_period: s.comparison_period || '',
            indices_config: s.indices_config || undefined,
            result: s.result || undefined,
          })
          setCurrentStep(s.current_step || 1)
          setInitialLoading(false)
        })
        .catch(err => {
          console.error('Errore caricamento wizard:', err)
          setError('Impossibile caricare i dati della pratica')
          setInitialLoading(false)
        })
    }
  }, [id])

  const saveWizardState = useCallback(async () => {
    if (!id) return
    try {
      await fetch(`/api/v1/cases/${id}/wizard-v2`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_step: currentStep,
          contract_type: data.contract_type,
          tol_selections: data.tol_selections || [],
          cpv_code: data.cpv_code || null,
          cpv_description: data.cpv_description || null,
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

  const updateData = (field: string, value: any) => {
    setData(prev => ({ ...prev, [field]: value }))
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return data.contract_type !== ''
      case 2:
        if (data.contract_type === 'works') {
          return (data.tol_selections?.length ?? 0) > 0
        } else {
          return !!data.cpv_code
        }
      case 3:
        return data.amount > 0 && data.base_period && data.comparison_period
      case 4:
        return !!data.indices_config
      default:
        return true
    }
  }

  const handleNext = async () => {
    if (currentStep < 4) {
      // Salva stato prima di avanzare
      await saveWizardState()
      setCurrentStep(prev => Math.min(prev + 1, totalSteps))
    } else if (currentStep === 4) {
      await executeCalculation()
    }
  }

  const handleBack = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1))
  }

  const resolveTolSeriesIds = async (selections: TolSelection[]): Promise<{code: string, weight: number, seriesId: string}[]> => {
    const results = await Promise.all(
      selections.map(async (sel) => {
        try {
          const res = await fetch(`/api/v1/tol/${sel.code}/indices`)
          const indices = await res.json()
          const active = indices.find((i: any) => i.is_active)
          return {
            code: sel.code,
            weight: sel.weight,
            seriesId: active?.series_id || `TOL_${sel.code}`,
          }
        } catch {
          return { code: sel.code, weight: sel.weight, seriesId: `TOL_${sel.code}` }
        }
      })
    )
    return results
  }

  const resolveCpvSeriesIds = async (cpvCode: string, contractType: string): Promise<string[]> => {
    try {
      const res = await fetch('/api/v1/classify/indices-for-cpv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpv_primary: cpvCode, contract_type: contractType }),
      })
      if (!res.ok) return []
      const data = await res.json()
      return data.candidates?.map((c: any) => c.id) || []
    } catch {
      return []
    }
  }

  const executeCalculation = async () => {
    setLoading(true)
    setError('')
    
    try {
      let indicesConfig: IndicesConfig
      
      if (data.contract_type === 'works' && data.tol_selections && data.tol_selections.length > 0) {
        const resolved = await resolveTolSeriesIds(data.tol_selections)
        
        if (resolved.length > 1) {
          const components: Record<string, number> = {}
          resolved.forEach(r => { components[r.seriesId] = r.weight })
          indicesConfig = { type: 'composite', components }
        } else {
          indicesConfig = { type: 'single', single_series_id: resolved[0].seriesId }
        }
      } else if (data.cpv_code) {
        const seriesIds = await resolveCpvSeriesIds(data.cpv_code, data.contract_type)
        if (seriesIds.length > 0) {
          indicesConfig = { type: 'single', single_series_id: seriesIds[0] }
        } else {
          throw new Error('Nessun indice ISTAT trovato per il codice CPV specificato')
        }
      } else {
        throw new Error('Impossibile determinare gli indici: nessuna classificazione selezionata')
      }
      
      const response = await fetch('/api/v1/calculation/v2/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_type: data.contract_type,
          amount: data.amount,
          base_period: data.base_period,
          comparison_period: data.comparison_period,
          indices_config: indicesConfig
        })
      })
      
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.detail || 'Errore calcolo')
      }
      
      const result = await response.json()
      updateData('result', result)
      updateData('indices_config', indicesConfig)
      
      // Salva risultato sul backend
      if (id) {
        await fetch(`/api/v1/cases/${id}/wizard-v2`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_step: 5,
            contract_type: data.contract_type,
            tol_selections: data.tol_selections || [],
            cpv_code: data.cpv_code || null,
            cpv_description: data.cpv_description || null,
            amount: data.amount,
            base_period: data.base_period || null,
            comparison_period: data.comparison_period || null,
            indices_config: indicesConfig,
            result: result,
          })
        })
      }
      
      // Carica il report completo
      await loadReport()
      
      setCurrentStep(5)
      
    } catch (err: any) {
      setError(err.message || 'Errore durante il calcolo')
    } finally {
      setLoading(false)
    }
  }

  const loadReport = async () => {
    if (!id) return
    
    try {
      const response = await fetch(`/api/v1/report/v2/cases/${id}`)
      if (!response.ok) throw new Error('Errore caricamento report')
      
      const report = await response.json()
      
      // Arricchisci il report con i dati del calcolo se disponibili
      if (data.result && report.sections) {
        // Aggiorna sezione Importi e Date
        const amountsSection = report.sections.find((s: any) => s.title === 'Importi e Date')
        if (amountsSection) {
          amountsSection.data.contract_amount = data.amount
          amountsSection.data.revisable_amount = data.amount
          amountsSection.data.base_period = data.base_period
          amountsSection.data.comparison_period = data.comparison_period
        }
        
        // Aggiorna sezione Indici ISTAT
        const indicesSection = report.sections.find((s: any) => s.title === 'Indici ISTAT')
        if (indicesSection && data.result) {
          indicesSection.data.synthetic_index_base = data.result.base_value
          indicesSection.data.synthetic_index_comparison = data.result.comparison_value
        }
        
        // Aggiorna sezione Risultato Calcolo
        const calcSection = report.sections.find((s: any) => s.title === 'Risultato Calcolo')
        if (calcSection && data.result) {
          calcSection.data = {
            variation_percent: data.result.variation_percent,
            threshold_exceeded: data.result.threshold_exceeded,
            revision_amount: data.result.revision_amount,
            revision_type: data.result.revision_type,
            formula_steps: data.result.steps || []
          }
        }
      }
      
      setReportData(report)
      
    } catch (err: any) {
      console.error('Errore caricamento report:', err)
    }
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
              onChange={(type) => updateData('contract_type', type)}
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
                : 'Inserisci il codice CPV (Common Procurement Vocabulary) del contratto'
              }
            </p>
            
            {data.contract_type === 'works' ? (
              <TolSelector
                value={data.tol_selections || []}
                onChange={(selections) => updateData('tol_selections', selections)}
                multiSelect={true}
              />
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Codice CPV</label>
                  <input
                    type="text"
                    value={data.cpv_code || ''}
                    onChange={(e) => updateData('cpv_code', e.target.value)}
                    placeholder="es. 45000000-7"
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                </div>
                {data.cpv_description && (
                  <div className="p-3 bg-blue-50 rounded border border-blue-200">
                    <p className="text-sm text-blue-900">{data.cpv_description}</p>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  Il codice CPV verrà utilizzato per determinare gli indici ISTAT applicabili
                </p>
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
              {/* Importo */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Importo assoggettabile a revisione (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={data.amount || ''}
                  onChange={(e) => updateData('amount', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="es. 100000.00"
                />
              </div>

              {/* Periodo base */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Periodo base (mese aggiudicazione)
                </label>
                <input
                  type="month"
                  value={data.base_period ? data.base_period.substring(0, 7) : ''}
                  onChange={(e) => updateData('base_period', `${e.target.value}-01`)}
                  className="w-full px-4 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Il mese e anno di aggiudicazione del contratto (indice di riferimento)
                </p>
              </div>

              {/* Periodo confronto */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Periodo confronto (mese rilevazione)
                </label>
                <input
                  type="month"
                  value={data.comparison_period ? data.comparison_period.substring(0, 7) : ''}
                  onChange={(e) => updateData('comparison_period', `${e.target.value}-01`)}
                  className="w-full px-4 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Il mese e anno di rilevazione corrente (indice da confrontare)
                </p>
              </div>
            </div>
          </div>
        )

      case 4:
        return (
          <div>
            <h2 className="text-2xl font-bold mb-2">Indici ISTAT</h2>
            <p className="text-gray-600 mb-6">
              Gli indici ISTAT verranno recuperati automaticamente in base alla classificazione selezionata
            </p>
            
            <div className="p-6 bg-blue-50 rounded-lg border border-blue-200">
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
                      : data.cpv_code
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
            ) : data.result ? (
              // Fallback al componente vecchio se report non disponibile
              <>
                <h2 className="text-2xl font-bold mb-2">Risultato Calcolo</h2>
                <p className="text-gray-600 mb-6">
                  Esito del calcolo della revisione prezzi secondo normativa vigente
                </p>
                <RevisionResultCard
                  result={data.result}
                  onExport={() => {
                    console.log('Export PDF')
                  }}
                  onNew={() => {
                    setData({
                      contract_type: '',
                      amount: 0,
                      base_period: '',
                      comparison_period: ''
                    })
                    setReportData(null)
                    setCurrentStep(1)
                  }}
                />
              </>
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
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map(stepNum => (
            <div key={stepNum} className="flex items-center flex-1">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center font-bold
                ${stepNum < currentStep ? 'bg-green-500 text-white' :
                  stepNum === currentStep ? 'bg-blue-500 text-white' :
                  'bg-gray-200 text-gray-500'}
              `}>
                {stepNum < currentStep ? '✓' : stepNum}
              </div>
              {stepNum < totalSteps && (
                <div className={`
                  flex-1 h-1 mx-2
                  ${stepNum < currentStep ? 'bg-green-500' : 'bg-gray-200'}
                `} />
              )}
            </div>
          ))}
        </div>
        <div className="text-sm text-gray-600 text-center">
          Step {currentStep} di {totalSteps}
        </div>
      </div>

      {/* Error display */}
      {error && !initialLoading && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
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
    </div>
  )
}
