'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useChatContext } from './useChatContext'

/** Client + matter label for the floating assistant header when URL-scoped to a matter. */
export function useMatterDisplayName(): string | null {
  const ctx = useChatContext()
  const matterId = ctx.type === 'matter' ? ctx.id : null
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (!matterId) {
      setLabel(null)
      return
    }

    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('v_matter_pipeline')
        .select('matter_name, client_name')
        .eq('matter_id', matterId)
        .maybeSingle()

      if (cancelled) return
      if (!data) {
        setLabel(null)
        return
      }

      const name = (data.matter_name || data.client_name || '').trim()
      setLabel(name || null)
    })()

    return () => {
      cancelled = true
    }
  }, [matterId])

  return label
}
