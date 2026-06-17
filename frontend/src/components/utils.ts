function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Bozza',
    in_progress: 'In corso',
    completed: 'Completato',
  }
  return map[status] || status
}

export { formatDate, statusLabel }
