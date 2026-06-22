const BASE = '/api/v1'

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface CaseItem {
  id: string
  title: string
  status: string
  current_step: number
  created_by: string | null
  created_at: string
}

export interface CaseDetail extends CaseItem {
  notes: string | null
  updated_at: string
}

export interface WizardAnswer {
  id: string
  step: number
  field_key: string
  field_value: string | null
  created_at: string
}

export interface ClassifyResult {
  cpv_primary: string
  cpv_description: string | null
  candidates: {
    family: string
    label: string
    confidence: string
    note: string
  }[]
  questions: string[]
  warnings: string[]
  overall_confidence: string
  requires_human_intervention: boolean
}

export interface IndexSeries {
  id: string
  name: string
  source: string
  normative_category: string | null
  classification_ref: string | null
  frequency: string | null
}

export interface CalcResult {
  series_id?: string
  base_value?: number
  comparison_value?: number
  variation_percent?: number
  threshold_percent?: number
  excess_percent?: number
  recognition_percent?: number
  revision_amount?: number
  formula_detail?: string
  steps?: { step: number; description: string; formula: string; result: string }[]
  is_applicable?: boolean
  result_version?: number
  result_id?: string
}

export interface ReportResponse {
  report: string
  format: string
}

export const api = {
  cases: {
    list: () => request<CaseItem[]>('/cases'),
    search: (q: string) => request<CaseItem[]>(`/cases?q=${encodeURIComponent(q)}`),
    get: (id: string) => request<CaseDetail>(`/cases/${id}`),
    create: (data: { title: string; notes?: string; created_by?: string }) =>
      request<CaseDetail>('/cases', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<CaseDetail>) =>
      request<CaseDetail>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/cases/${id}`, { method: 'DELETE' }),
  },
  wizard: {
    save: (caseId: string, step: number, answers: { step: number; field_key: string; field_value: string }[]) =>
      request<WizardAnswer[]>(`/cases/${caseId}/wizard/${step}`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }),
    get: (caseId: string, step: number) =>
      request<WizardAnswer[]>(`/cases/${caseId}/wizard/${step}`),
  },
  classify: (data: { cpv_primary: string; contract_type?: string; labour_intensive?: boolean }) =>
    request<ClassifyResult>('/classify', { method: 'POST', body: JSON.stringify(data) }),
  indices: {
    list: () => request<IndexSeries[]>('/indices'),
    forFamily: (family: string) =>
      request<{ family: string; candidate_series: IndexSeries[] }>('/classify/indices', {
        method: 'POST',
        body: JSON.stringify({ family }),
      }),
    forCpv: (cpv: string, contractType?: string) =>
      request<{ cpv_primary: string; candidates: IndexSeries[]; requires_human_intervention: boolean; warnings: string[] }>(
        '/classify/indices-for-cpv', {
          method: 'POST',
          body: JSON.stringify({ cpv_primary: cpv, contract_type: contractType }),
        }),
  },
  calculate: (data: { case_id: string; series_id: string; base_period: string; comparison_period: string; amount: number }) =>
    request<CalcResult>('/calculate', { method: 'POST', body: JSON.stringify(data) }),
  report: (caseId: string) =>
    request<ReportResponse>(`/cases/${caseId}/report`, { method: 'POST' }),
  settings: {
    get: (deviceId: string) =>
      request<{ preferences: Record<string, string> }>(`/settings?device_id=${encodeURIComponent(deviceId)}`),
    update: (deviceId: string, preferences: Record<string, string | null>) =>
      request<{ preferences: Record<string, string> }>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ device_id: deviceId, preferences }),
      }),
  },
  backup: {
    export: () => {
      const a = document.createElement('a')
      a.href = '/api/v1/backup/export'
      a.download = ''
      a.click()
    },
    import: async (file: File): Promise<string> => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/v1/backup/import', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      return data.detail
    },
  },
}
