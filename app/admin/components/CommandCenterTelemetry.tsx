'use client'

import { useEffect, useRef } from 'react'

export function CommandCenterTelemetry({ event }: { event: 'command_center_opened' | 'legacy_today_opened' }) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    void fetch('/api/admin/command-center/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
      keepalive: true,
    })
  }, [event])
  return null
}
