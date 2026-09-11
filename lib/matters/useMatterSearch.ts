'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export interface MatterSearchResult {
  matter_id: string
  matter_name: string | null
  client_name: string | null
  stage: string | null
}

/** Backend matches are authoritative, including matches found only in email. */
export function useMatterSearch(query: string, enabled: boolean) {
  const term = query.trim()
  const [result, setResult] = useState({
    query: '', matters: [] as MatterSearchResult[], searching: false, error: null as string | null,
  })

  useEffect(() => {
    let cancelled = false
    if (!enabled || !term) return
    setResult({ query: term, matters: [], searching: true, error: null })
    const timer = setTimeout(async () => {
      try {
        const safeTerm = term.replace(/[%,]/g, ' ')
        const { data, error } = await supabase.from('v_matter_pipeline')
          .select('matter_id, matter_name, client_name, stage')
          .or(`matter_name.ilike.%${safeTerm}%,client_name.ilike.%${safeTerm}%,client_email.ilike.%${safeTerm}%`)
          .limit(8)
        if (error) throw error
        if (!cancelled) setResult({ query: term, matters: (data ?? []) as MatterSearchResult[], searching: false, error: null })
      } catch {
        if (!cancelled) setResult({ query: term, matters: [], searching: false, error: 'Search is unavailable. Please try again.' })
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [term, enabled])

  if (!enabled || !term || result.query !== term) {
    return { matters: [] as MatterSearchResult[], searching: enabled && !!term, error: null }
  }
  return result
}
