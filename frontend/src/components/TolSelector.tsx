import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface TolOption {
  code: string
  sequence: number
  short_description: string
  is_specialized: boolean
}

interface TolSelection {
  code: string
  weight: number
}

interface TolSelectorProps {
  value: TolSelection[]
  onChange: (selections: TolSelection[]) => void
  multiSelect?: boolean
  disabled?: boolean
}

export default function TolSelector({ 
  value, 
  onChange, 
  multiSelect = false,
  disabled = false 
}: TolSelectorProps) {
  const [tols, setTols] = useState<TolOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedTol, setExpandedTol] = useState<string | null>(null)
  const [tolDetails, setTolDetails] = useState<Record<string, any>>({})

  useEffect(() => {
    fetch('/api/v1/tol/list')
      .then(r => r.json())
      .then(data => {
        setTols(data)
        setLoading(false)
      })
      .catch(err => {
        setError('Errore caricamento TOL')
        setLoading(false)
      })
  }, [])

  const handleToggleTol = (code: string) => {
    if (disabled) return
    
    const existing = value.find(s => s.code === code)
    
    if (existing) {
      // Rimuovi
      onChange(value.filter(s => s.code !== code))
    } else {
      if (multiSelect) {
        // Aggiungi con peso di default
        const newWeight = value.length === 0 ? 100 : Math.floor(100 / (value.length + 1))
        const adjusted = value.map(s => ({ ...s, weight: newWeight }))
        onChange([...adjusted, { code, weight: newWeight }])
      } else {
        // Modalità singola selezione
        onChange([{ code, weight: 100 }])
      }
    }
  }

  const handleWeightChange = (code: string, weight: number) => {
    onChange(value.map(s => s.code === code ? { ...s, weight } : s))
  }

  const handleViewDetails = async (code: string) => {
    if (expandedTol === code) {
      setExpandedTol(null)
      return
    }
    
    if (!tolDetails[code]) {
      try {
        const response = await fetch(`/api/v1/tol/${code}`)
        const data = await response.json()
        setTolDetails(prev => ({ ...prev, [code]: data }))
      } catch (err) {
        console.error('Errore caricamento dettagli TOL', err)
      }
    }
    setExpandedTol(code)
  }

  const totalWeight = value.reduce((sum, s) => sum + s.weight, 0)
  const isWeightValid = Math.abs(totalWeight - 100) < 0.01

  if (loading) {
    return <div className="text-sm text-gray-500">Caricamento TOL...</div>
  }

  if (error) {
    return <div className="text-sm text-red-600">{error}</div>
  }

  return (
    <div className="space-y-4">
      {/* Selezione TOL */}
      <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
        {tols.map(tol => {
          const selected = value.find(s => s.code === tol.code)
          const isExpanded = expandedTol === tol.code
          
          return (
            <div key={tol.code} className={`p-3 ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <input
                  type={multiSelect ? 'checkbox' : 'radio'}
                  checked={!!selected}
                  onChange={() => handleToggleTol(tol.code)}
                  disabled={disabled}
                  className="mt-1"
                />
                
                {/* Info TOL */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{tol.code}</span>
                    {tol.is_specialized && (
                      <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                        Specializzata
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{tol.short_description}</p>
                  
                  {/* Pulsante dettagli */}
                  <button
                    type="button"
                    onClick={() => handleViewDetails(tol.code)}
                    className="text-xs text-blue-600 hover:underline mt-1"
                  >
                    {isExpanded ? 'Nascondi' : 'Mostra'} declaratoria completa
                  </button>
                  
                  {/* Declaratoria espansa */}
                  {isExpanded && tolDetails[tol.code] && (
                    <div className="mt-2 p-3 bg-white rounded border text-sm text-gray-600">
                      {tolDetails[tol.code].full_description}
                      {tolDetails[tol.code].notes && (
                        <p className="mt-2 text-xs italic text-gray-500">
                          Note: {tolDetails[tol.code].notes}
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Input peso (se selezionato e multi-select) */}
                  {selected && multiSelect && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-gray-600">Peso %:</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={selected.weight}
                        onChange={(e) => handleWeightChange(tol.code, parseFloat(e.target.value) || 0)}
                        disabled={disabled}
                        className="w-20 px-2 py-1 text-sm border rounded"
                      />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Riepilogo selezione */}
      {value.length > 0 && (
        <div className="p-4 bg-gray-50 rounded-lg space-y-2">
          <h4 className="text-sm font-medium text-gray-700">Riepilogo selezione:</h4>
          <div className="space-y-1">
            {value.map(sel => (
              <div key={sel.code} className="flex justify-between text-sm">
                <span className="font-mono">{sel.code}</span>
                {multiSelect && <span>{sel.weight.toFixed(1)}%</span>}
              </div>
            ))}
          </div>
          
          {/* Validazione peso totale */}
          {multiSelect && value.length > 1 && (
            <div className="pt-2 border-t mt-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Totale:</span>
                <span className={`text-sm font-bold ${isWeightValid ? 'text-green-600' : 'text-red-600'}`}>
                  {totalWeight.toFixed(1)}%
                </span>
              </div>
              {!isWeightValid && (
                <p className="text-xs text-red-600 mt-1">
                  ⚠️ La somma dei pesi deve essere 100%
                </p>
              )}
              {isWeightValid && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Pesi corretti
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      <p className="text-xs text-gray-500">
        {multiSelect 
          ? 'Per contratti con lavorazioni diverse, seleziona più TOL e assegna i pesi percentuali. La somma deve essere 100%.'
          : 'Seleziona la TOL prevalente per questo contratto.'
        }
      </p>
    </div>
  )
}
