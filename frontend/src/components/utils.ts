export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}


export type WizardVersion = 'v1' | 'v2' | 'unified'

export interface WizardVersionInfo {
  version: WizardVersion | null
  hasV2State: boolean
  v2Step: number
}

export function parseWizardVersion(body: unknown): WizardVersionInfo {
  const fallback: WizardVersionInfo = { version: null, hasV2State: false, v2Step: 1 }
  if (!isRecord(body)) return fallback
  const raw = body['wizard_version']
  const version: WizardVersion | null = raw === 'v1' || raw === 'v2' || raw === 'unified' ? raw : null
  const hasV2State = body['has_v2_state'] === true
  let v2Step = 1
  if (isRecord(body['state'])) {
    const step = asNumber((body['state'] as Record<string, unknown>)['current_step'])
    if (step !== undefined) v2Step = step
  }
  return { version, hasV2State, v2Step }
}

export function isV2Draft(info: WizardVersionInfo): boolean {
  if (info.version === 'v2' || info.version === 'unified') return true
  if (info.version === 'v1') return false
  // Senza marcatore esplicito conta solo uno stato V2 davvero salvato con
  // avanzamento: i dati ricostruiti dalle risposte V1 non bastano.
  return info.hasV2State && info.v2Step > 1
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Bozza',
    in_progress: 'In corso',
    completed: 'Completato',
  }
  return map[status] || status
}

export function getDeviceId(): string {
  let id = localStorage.getItem('device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('device_id', id)
  }
  return id
}
