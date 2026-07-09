'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export interface RealtimeMessageRow {
  id: string
  body: string
  sender_role: string
  created_at: string
  read_at: string | null
}

export function useMessagesRealtime(
  matterId: string,
  onInsert: (message: RealtimeMessageRow) => void,
) {
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${matterId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `matter_id=eq.${matterId}`,
        },
        payload => {
          onInsert(payload.new as RealtimeMessageRow)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [matterId, onInsert])
}
