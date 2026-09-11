import { createHash } from 'node:crypto'

export interface DraftRunOutcome {
  filename: string
  name: string
  status: 'saved' | 'failed'
  documentId?: string
  error?: string
  markerCount?: number
}
export interface DraftRun {
  id: string
  matter_id: string
  source_revision: string
  request_hash: string
  requested_documents: string[]
  status: 'running' | 'partial' | 'completed' | 'failed'
  outcomes: DraftRunOutcome[]
  worker_token: string
  lease_expires_at: string
  created_at: string
  updated_at: string
  error: string | null
}

function canonical(value: unknown): unknown {
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, item]) => [key, canonical(item)])
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]))
  return value
}
export function sourceRevision(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')
}
export function runRequestHash(revision: string, documents: string[]): string {
  return sourceRevision({ revision, documents: [...new Set(documents)].sort() })
}
export function outstandingDocuments(documents: string[], outcomes: DraftRunOutcome[]): string[] {
  const saved = new Set(outcomes.filter(item => item.status === 'saved').map(item => item.filename))
  return documents.filter(filename => !saved.has(filename))
}
export function summarizeRun(documents: string[], outcomes: DraftRunOutcome[]) {
  const wanted = new Set(documents)
  const saved = outcomes.filter(item => wanted.has(item.filename) && item.status === 'saved').length
  const failed = outcomes.filter(item => wanted.has(item.filename) && item.status === 'failed').length
  const pending = Math.max(0, wanted.size - saved - failed)
  const status = saved === wanted.size && wanted.size > 0 ? 'completed' : saved > 0 ? 'partial' : 'failed'
  return { saved, failed, pending, total: wanted.size, status: status as 'completed' | 'partial' | 'failed' }
}
