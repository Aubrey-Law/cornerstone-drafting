'use server'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { estimateUsdCost } from '@/lib/aiUsage'

export interface AiUsageRow {
  id: string
  created_at: string
  route: string
  context_type: string | null
  matter_id: string | null
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  duration_ms: number | null
  success: boolean
  error_message: string | null
}

export interface AiUsageTotals {
  calls: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  failures: number
}

export interface AiUsageSnapshot {
  rows: AiUsageRow[]
  totals: AiUsageTotals
  windowDays: number
}

export async function fetchRecentAiUsage(windowDays = 30): Promise<AiUsageSnapshot> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: rowsRaw, error } = await admin
    .from('ai_usage')
    .select('id, created_at, route, context_type, matter_id, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, duration_ms, success, error_message')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(error.message)
  const rows = (rowsRaw ?? []) as AiUsageRow[]

  const totals = rows.reduce<AiUsageTotals>(
    (acc, r) => {
      acc.calls += 1
      acc.input += r.input_tokens
      acc.output += r.output_tokens
      acc.cacheRead += r.cache_read_input_tokens
      acc.cacheWrite += r.cache_creation_input_tokens
      acc.cost += estimateUsdCost(r)
      if (!r.success) acc.failures += 1
      return acc
    },
    { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, failures: 0 }
  )

  return { rows: rows.slice(0, 50), totals, windowDays }
}
