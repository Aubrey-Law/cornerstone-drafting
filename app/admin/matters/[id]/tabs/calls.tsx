'use client'

import { CallList } from '@/components/calls/CallList'

export function CallsSection({ matterId }: { matterId: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Calls</h3>
        <p className="text-xs text-muted-foreground">Logged Twilio and Retell calls for this matter.</p>
      </div>
      <CallList matterId={matterId} />
    </section>
  )
}
