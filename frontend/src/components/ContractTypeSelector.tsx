interface ContractTypeSelectorProps {
  value: 'works' | 'services' | 'supplies' | ''
  onChange: (type: 'works' | 'services' | 'supplies') => void
  disabled?: boolean
}

const CONTRACT_TYPES = [
  {
    value: 'works' as const,
    label: 'Lavori',
    icon: '🏗️',
    description: 'Contratti di lavori pubblici (soglia 3%, coeff. 90%)',
    classification: 'TOL - Tipologie Omogenee Lavorazioni'
  },
  {
    value: 'services' as const,
    label: 'Servizi',
    icon: '💼',
    description: 'Contratti di servizi (soglia 5%, coeff. 80%)',
    classification: 'CPV - Common Procurement Vocabulary'
  },
  {
    value: 'supplies' as const,
    label: 'Forniture',
    icon: '📦',
    description: 'Contratti di forniture (soglia 5%, coeff. 80%)',
    classification: 'CPV - Common Procurement Vocabulary'
  }
]

export default function ContractTypeSelector({ 
  value, 
  onChange, 
  disabled = false 
}: ContractTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CONTRACT_TYPES.map(type => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            disabled={disabled}
            className={`
              p-6 rounded-lg border-2 text-left transition-all
              ${value === type.value 
                ? 'border-blue-500 bg-blue-50 shadow-md' 
                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {/* Icon e label */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{type.icon}</span>
              <div>
                <h3 className="font-bold text-lg">{type.label}</h3>
                {value === type.value && (
                  <span className="text-xs text-blue-600 font-medium">✓ Selezionato</span>
                )}
              </div>
            </div>
            
            {/* Descrizione */}
            <p className="text-sm text-gray-600 mb-2">
              {type.description}
            </p>
            
            {/* Classificazione */}
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                <strong>Classificazione:</strong> {type.classification}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Info parametri normativi */}
      {value && (
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">
            📋 Parametri normativi applicabili
          </h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-blue-700 font-medium">Soglia attivazione:</span>
              <span className="ml-2 font-bold">
                {value === 'works' ? '3%' : '5%'}
              </span>
            </div>
            <div>
              <span className="text-blue-700 font-medium">Coefficiente riconoscimento:</span>
              <span className="ml-2 font-bold">
                {value === 'works' ? '90%' : '80%'}
              </span>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-2">
            (D.lgs 36/2023, Allegato II.2-bis, Art. 3)
          </p>
        </div>
      )}
    </div>
  )
}
