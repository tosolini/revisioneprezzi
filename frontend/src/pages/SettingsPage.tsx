import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

function getDeviceId(): string {
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('device_id', id)
  }
  return id
}

const GROUP_OPTIONS = [
  { value: 'ppi', label: 'Prezzi alla produzione industria (PPI)' },
  { value: 'ps_business', label: 'Prezzi produzione servizi (BtoB)' },
  { value: 'tol', label: 'Tipologie Omogenee Lavorazioni (TOL)' },
  { value: 'construction_cost_residential', label: 'Costo costruzione - Fabbricato residenziale' },
  { value: 'construction_cost_tunnel', label: 'Costo costruzione - Tronco stradale con galleria' },
  { value: 'nic', label: 'Prezzi al consumo (NIC)' },
  { value: 'nic_ecoicop2', label: 'NIC - tutte le basi (Ecoicop 2)' },
  { value: 'wages', label: 'Retribuzioni contrattuali orarie' },
  { value: 'wages_ateco', label: 'Retribuzioni orarie per settore ATECO' },
]

const FREQ_OPTIONS = [
  { value: 'monthly', label: 'Mensile' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'annual', label: 'Annuale' },
]

function ImportModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [groupKey, setGroupKey] = useState('ppi')
  const [freq, setFreq] = useState('monthly')

  const handleUpload = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const params = new URLSearchParams({ group_key: groupKey, freq_param: freq })
      const res = await fetch(`/api/v1/indices/import-csv?${params}`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Errore importazione')
      }
      const data = await res.json()
      const d = data.details
      setResult(`✓ Importato: ${d.added} aggiunte, ${d.updated} aggiornate, ${d.skipped} saltate, ${d.errors} errori. ${d.series_created} nuove serie create.`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, minWidth: 460,
        maxWidth: 540, boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>Importa CSV ISTAT</h3>

        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Seleziona un file CSV scaricato dal portale ISTAT (formato SDMX). Se il CSV contiene la colonna DATAFLOW la configurazione viene rilevata automaticamente.
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Tipo dati</label>
            <select value={groupKey} onChange={e => setGroupKey(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
              {GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Frequenza</label>
            <select value={freq} onChange={e => setFreq(e.target.value)} style={{ padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
              {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={e => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: 16 }}
        />
        {file && <p style={{ fontSize: 12, color: '#374151', marginBottom: 12 }}>{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}

        {error && (
          <div style={{
            padding: '8px 12px', background: '#fde8e8', color: '#c0392b',
            borderRadius: 8, marginBottom: 12, fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}>{error}</div>
        )}

        {result && (
          <div style={{
            padding: '8px 12px', background: '#e8fde8', color: '#2b8c2b',
            borderRadius: 8, marginBottom: 12, fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}>{result}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 8, border: '1px solid #d1d5db',
              background: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            Chiudi
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: !file || loading ? '#9ca3af' : '#1a1a2e',
              color: '#fff', cursor: !file || loading ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {loading ? 'Importazione...' : 'Importa CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [prefEnte, setPrefEnte] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [showImport, setShowImport] = useState(false)

  // backup / restore
  const [exporting, setExporting] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importConfirm, setImportConfirm] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [importError, setImportError] = useState('')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const deviceId = getDeviceId()
      const res = await fetch(`/api/v1/settings?device_id=${encodeURIComponent(deviceId)}`)
      if (!res.ok) throw new Error('Errore caricamento impostazioni')
      const data = await res.json()
      setPrefEnte(data.preferences?.prefilled_ente || '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const deviceId = getDeviceId()
      const res = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          preferences: { prefilled_ente: prefEnte || null },
        }),
      })
      if (!res.ok) throw new Error('Errore salvataggio impostazioni')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Impostazioni</h2>
        <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>
          Valori predefiniti per le nuove pratiche
        </p>

        {loading ? (
          <div style={{ color: '#6b7280' }}>Caricamento...</div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#374151' }}>
                Ente / Stazione appaltante predefinito
              </label>
              <input
                type="text"
                value={prefEnte}
                onChange={e => setPrefEnte(e.target.value)}
                placeholder="es. Comune di Milano"
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 14,
                  border: '1px solid #d1d5db', borderRadius: 8, outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af' }}>
                Verrà precompilato automaticamente nello step 1 del wizard. Modificabile in fase di compilazione.
              </p>
            </div>

            {error && (
              <div style={{
                padding: '8px 12px', background: '#fde8e8', color: '#c0392b',
                borderRadius: 8, marginBottom: 16, fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: '#1a1a2e', color: '#fff', cursor: 'pointer',
                fontSize: 14, fontWeight: 600,
              }}
            >
              {saving ? 'Salvataggio...' : saved ? 'Salvato ✓' : 'Salva impostazioni'}
            </button>
          </>
        )}
      </div>

      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Dati ISTAT</h2>
        <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>
          Importa manualmente file CSV scaricati dal portale ISTAT
        </p>
        <button
          onClick={() => setShowImport(true)}
          style={{
            padding: '10px 24px', borderRadius: 8, border: 'none',
            background: '#1a1a2e', color: '#fff', cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
        >
          Importa CSV ISTAT
        </button>
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      <div style={{
        background: '#fff', padding: 24, borderRadius: 12, marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Database Backup</h2>
        <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>
          Esporta o importa l'intero database in formato pg_dump (.dump)
        </p>

        <div style={{ marginBottom: 16, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Esporta database</h3>
          <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 13 }}>
            Scarica un dump completo con tutti i dati (pratiche, cataloghi, impostazioni).
          </p>
          <button
            onClick={() => { setExporting(true); api.backup.export(); setTimeout(() => setExporting(false), 1500) }}
            disabled={exporting}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: exporting ? '#9ca3af' : '#1a1a2e',
              color: '#fff', cursor: exporting ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {exporting ? 'Avvio...' : 'Scarica dump'}
          </button>
        </div>

        <div style={{ padding: 16, background: '#f9fafb', borderRadius: 8 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Importa database</h3>
          <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 13 }}>
            Carica un file .dump per ripristinare l'intero database. <strong style={{ color: '#c0392b' }}>I dati esistenti verranno sovrascritti.</strong>
          </p>

          <input
            type="file"
            accept=".dump"
            onChange={e => { setImportFile(e.target.files?.[0] || null); setImportResult(null); setImportError('') }}
            style={{ marginBottom: 12 }}
          />
          {importFile && (
            <p style={{ fontSize: 12, color: '#374151', marginBottom: 12 }}>
              {importFile.name} ({(importFile.size / 1024 / 1024).toFixed(1)} MB)
            </p>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#c0392b', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={importConfirm}
              onChange={e => setImportConfirm(e.target.checked)}
            />
            Confermo di voler sovrascrivere TUTTI i dati attuali
          </label>

          {importError && (
            <div style={{
              padding: '8px 12px', background: '#fde8e8', color: '#c0392b',
              borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap',
            }}>{importError}</div>
          )}

          {importResult && (
            <div style={{
              padding: '8px 12px', background: '#e8fde8', color: '#2b8c2b',
              borderRadius: 8, marginBottom: 12, fontSize: 13, whiteSpace: 'pre-wrap',
            }}>{importResult}</div>
          )}

          <button
            onClick={async () => {
              if (!importFile) return
              setImporting(true)
              setImportError('')
              setImportResult(null)
              try {
                const msg = await api.backup.import(importFile)
                setImportResult(msg)
                setImportFile(null)
                setImportConfirm(false)
              } catch (e: any) {
                setImportError(e.message)
              } finally {
                setImporting(false)
              }
            }}
            disabled={!importFile || !importConfirm || importing}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: !importFile || !importConfirm || importing ? '#9ca3af' : '#c0392b',
              color: '#fff', cursor: !importFile || !importConfirm || importing ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {importing ? 'Importazione...' : 'Importa dump'}
          </button>
        </div>
      </div>
    </div>
  )
}
