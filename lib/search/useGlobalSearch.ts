'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  contactHit,
  invoiceHit,
  matterHit,
  sanitizeTerm,
  taskHit,
  type ContactRow,
  type InvoiceRow,
  type MatterRow,
  type SearchHit,
  type TaskRow,
} from './globalSearchSources'

/**
 * ⌘K across matters, contacts, tasks and invoices.
 *
 * Replaces the matters-only search the palette had. The four run in parallel
 * and settle independently: row-level security can deny any one of them to a
 * given role, and a palette that goes blank because invoices were refused is
 * worse than one that shows the three it could read. A source that fails is
 * dropped and counted, and the caller says so once rather than per source.
 *
 * `MatterSwitcher` still uses `useMatterSearch`, which this deliberately does
 * not replace — that control searches matters and only matters.
 */

export interface GlobalSearchState {
  hits: Record<'matters' | 'contacts' | 'tasks' | 'invoices', SearchHit[]>
  searching: boolean
  /** Set when every source failed; a partial failure is silent by design. */
  error: string | null
  /** How many sources were refused or errored, for the partial-result note. */
  failedSources: number
}

const EMPTY: GlobalSearchState['hits'] = { matters: [], contacts: [], tasks: [], invoices: [] }

const LIMIT = 6

async function fetchAll(term: string): Promise<{ hits: GlobalSearchState['hits']; failed: number }> {
  const like = `%${term}%`

  const results = await Promise.allSettled([
    supabase
      .from('v_matter_pipeline')
      .select('matter_id, matter_name, client_name, stage')
      .or(`matter_name.ilike.${like},client_name.ilike.${like},client_email.ilike.${like}`)
      .limit(LIMIT),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, preferred_name, email, phone')
      // A merged contact is a tombstone pointing at the surviving row; offering
      // it would navigate to a record the contacts table no longer lists.
      .is('merged_into_id', null)
      .or(
        `first_name.ilike.${like},last_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like}`,
      )
      .limit(LIMIT),
    supabase
      .from('tasks')
      .select('id, title, status, matter_id')
      // Completed work is not what someone reaches for the palette to find.
      .is('completed_at', null)
      .ilike('title', like)
      .limit(LIMIT),
    supabase
      .from('invoices')
      .select('id, number, status, bill_to_name')
      .is('voided_at', null)
      .or(`number.ilike.${like},bill_to_name.ilike.${like}`)
      .limit(LIMIT),
  ])

  let failed = 0
  const rowsOf = <T,>(index: number): T[] => {
    const settled = results[index]
    if (settled.status !== 'fulfilled' || settled.value.error) {
      failed += 1
      return []
    }
    return (settled.value.data ?? []) as T[]
  }

  return {
    hits: {
      matters: rowsOf<MatterRow>(0).map(matterHit),
      contacts: rowsOf<ContactRow>(1).map(contactHit),
      tasks: rowsOf<TaskRow>(2).map(taskHit),
      invoices: rowsOf<InvoiceRow>(3).map(invoiceHit),
    },
    failed,
  }
}

export function useGlobalSearch(query: string, enabled: boolean): GlobalSearchState {
  const term = sanitizeTerm(query)
  const [result, setResult] = useState<GlobalSearchState & { query: string }>({
    query: '',
    hits: EMPTY,
    searching: false,
    error: null,
    failedSources: 0,
  })

  useEffect(() => {
    let cancelled = false
    if (!enabled || !term) return
    setResult({ query: term, hits: EMPTY, searching: true, error: null, failedSources: 0 })

    const timer = setTimeout(async () => {
      try {
        const { hits, failed } = await fetchAll(term)
        if (cancelled) return
        setResult({
          query: term,
          hits,
          searching: false,
          // Only a total failure is worth saying out loud; anything less would
          // put an error over results the person can use.
          error: failed === 4 ? 'Search is unavailable. Please try again.' : null,
          failedSources: failed,
        })
      } catch {
        if (cancelled) return
        setResult({
          query: term,
          hits: EMPTY,
          searching: false,
          error: 'Search is unavailable. Please try again.',
          failedSources: 4,
        })
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, enabled])

  // While the debounce is pending, `result` still describes the previous term.
  // Reporting it as the answer to this one would flash stale hits.
  if (!enabled || !term || result.query !== term) {
    return { hits: EMPTY, searching: enabled && !!term, error: null, failedSources: 0 }
  }
  return result
}
