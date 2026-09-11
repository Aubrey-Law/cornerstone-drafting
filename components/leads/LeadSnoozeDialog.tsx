'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function LeadSnoozeDialog({ open, onOpenChange, onSnooze }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSnooze: (until: string) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(until: string) {
    if (pending) return
    if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now()) {
      setError('Choose a future date.'); return
    }
    setPending(true); setError(null)
    try { await onSnooze(until); onOpenChange(false) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not snooze. Please retry.') }
    finally { setPending(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value) }}>
    <DialogContent><DialogHeader><DialogTitle>Snooze next action</DialogTitle><DialogDescription>Hide this suggestion until the selected time. Tasks and their due dates stay unchanged.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2">{[[1, 'Tomorrow'], [3, 'Three days'], [7, 'Next week']].map(([days, label]) => <Button key={days} variant="outline" disabled={pending} onClick={() => void save(new Date(Date.now() + Number(days) * 86_400_000).toISOString())}>{label}</Button>)}</div>
      <label className="space-y-2 text-sm">Choose date and time <Input type="datetime-local" value={date} disabled={pending} onChange={event => setDate(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">Uses your device’s local time.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending || !date} onClick={() => void save(date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : '')}>{pending ? 'Saving…' : 'Snooze until this time'}</Button>
    </DialogContent>
  </Dialog>
}
