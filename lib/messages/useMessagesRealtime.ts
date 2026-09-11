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
  onReconnect?: () => void | Promise<void>,
) {
  useEffect(() => {
    let subscribed = false
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
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return
        if (subscribed) void onReconnect?.()
        subscribed = true
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [matterId, onInsert, onReconnect])
}
