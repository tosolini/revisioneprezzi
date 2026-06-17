interface RevisionResultProps {
  result: {
    contract_type: string
    amount: number
    threshold_percent: number
    variation_percent: number
    threshold_exceeded: boolean
    revision_amount: number
    base_index: number
    comparison_index: number
    net_variation_percent: number
    recognition_rate_percent: number
  }
  onExport?: () => void
  onNew?: () => void
}

export default function RevisionResultCard({ result, onExport, onNew }: RevisionResultProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    }).format(value)
  }

  const formatPercent = (value: number) => {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const contractTypeLabel = {
    works: 'Lavori',
    services: 'Servizi',
    supplies: 'Forniture'
  }[result.contract_type] || result.contract_type

  return (
    <div className="space-y-6">
      {/* Esito principale */}
      <div className={`
        p-6 rounded-xl border-2 text-center
        ${result.threshold_exceeded 
          ? 'border-green-500 bg-green-50' 
          : 'border-gray-300 bg-gray-50'
        }
      `}>
        <div className="text-5xl mb-3">
          {result.threshold_exceeded ? '✅' : '❌'}
        </div>
        <h2 className="text-2xl font-bold mb-2">
          {result.threshold_exceeded 
            ? 'Soglia Superata' 
            : 'Soglia NON Superata'
          }
        </h2>
        <p className="text-gray-600">
          {result.threshold_exceeded
            ? 'La revisione prezzi è applicabile'
            : 'La revisione prezzi NON è applicabile'
          }
        </p>
      </div>

      {/* Importo revisionale */}
      <div className="p-6 bg-white rounded-lg border-2 border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">
          💰 Importo da corrispondere/decurtare
        </h3>
        <div className="text-center">
          <div className={`
            text-5xl font-bold mb-2
            ${result.revision_amount > 0 ? 'text-green-600' : 
              result.revision_amount < 0 ? 'text-red-600' : 
              'text-gray-400'}
          `}>
            {formatCurrency(Math.abs(result.revision_amount))}
          </div>
          <div className="text-sm text-gray-500">
            {result.revision_amount > 0 && '↑ Importo da corrispondere al contraente'}
            {result.revision_amount < 0 && '↓ Importo da decurtare dal contraente'}
            {result.revision_amount === 0 && '= Nessuna revisione applicabile'}
          </div>
        </div>
      </div>

      {/* Dettaglio calcolo */}
      <div className="p-6 bg-gray-50 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">
          📊 Dettaglio del calcolo
        </h3>
        
        <div className="space-y-3">
          {/* Tipo contratto */}
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Tipo contratto:</span>
            <span className="font-medium">{contractTypeLabel}</span>
          </div>

          {/* Importo assoggettabile */}
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Importo contrattuale:</span>
            <span className="font-medium">{formatCurrency(result.amount)}</span>
          </div>

          {/* Soglia applicabile */}
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Soglia applicabile:</span>
            <span className="font-medium">{result.threshold_percent.toFixed(0)}%</span>
          </div>

          {/* Indici */}
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Indice riferimento:</span>
            <span className="font-medium">{result.base_index.toFixed(2)}</span>
          </div>

          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Indice corrente:</span>
            <span className="font-medium">{result.comparison_index.toFixed(2)}</span>
          </div>

          {/* Variazione */}
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">Variazione rilevata:</span>
            <span className={`font-bold ${
              result.variation_percent > 0 ? 'text-red-600' : 
              result.variation_percent < 0 ? 'text-green-600' : 
              'text-gray-600'
            }`}>
              {formatPercent(result.variation_percent)}
            </span>
          </div>

          {/* Eccedenza */}
          {result.threshold_exceeded && (
            <>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Eccedenza rispetto soglia:</span>
                <span className="font-medium">
                  {formatPercent(result.net_variation_percent)}
                </span>
              </div>

              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">Coefficiente riconoscimento:</span>
                <span className="font-medium">{result.recognition_rate_percent.toFixed(0)}%</span>
              </div>
            </>
          )}
        </div>

        {/* Formula calcolo */}
        {result.threshold_exceeded && (
          <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
            <p className="text-xs text-gray-600 mb-1 font-medium">Formula applicata:</p>
            <code className="text-xs text-blue-900 block">
              {formatCurrency(result.amount)} × {formatPercent(result.net_variation_percent)} × {result.recognition_rate_percent.toFixed(0)}% = {formatCurrency(result.revision_amount)}
            </code>
          </div>
        )}
      </div>

      {/* Riferimento normativo */}
      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
        <p className="text-sm text-amber-900">
          <strong>📖 Riferimento normativo:</strong> D.lgs 36/2023, Allegato II.2-bis "Modalità applicative delle clausole di revisione dei prezzi", Art. 3 comma 2-3
        </p>
      </div>

      {/* Azioni */}
      <div className="flex gap-3">
        {onExport && (
          <button
            onClick={onExport}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            📄 Esporta PDF
          </button>
        )}
        {onNew && (
          <button
            onClick={onNew}
            className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            ➕ Nuovo calcolo
          </button>
        )}
      </div>
    </div>
  )
}
