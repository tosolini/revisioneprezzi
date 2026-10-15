export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
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
