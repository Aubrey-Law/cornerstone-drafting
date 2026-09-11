'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

export function LeadLogCallDialog({ leadId, open, onOpenChange, onSaved }: {
  leadId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (timestamp: string, contacted: boolean) => void | Promise<void>
}) {
  const token = useAccessToken()
  const [outcome, setOutcome] = useState('connected')
  const [detail, setDetail] = useState('')
  const [due, setDue] = useState('')
  const [hasSavedCall, setHasSavedCall] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A task failure must not write a second call when the operator retries.
  const savedCall = useRef<{ timestamp: string; contacted: boolean } | null>(null)
  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'Could not save')
    return json
  }
  async function save() {
    if (pending) return
    setPending(true); setError(null)
    try {
      if (!savedCall.current) {
        const json = await post(`/api/admin/leads/${leadId}/activity`, { eventType: 'call_logged', outcome, detail: detail.trim() })
        savedCall.current = { timestamp: json.activity.created_at, contacted: outcome === 'connected' }
        setHasSavedCall(true)
      }
      if (due) {
        await post('/api/admin/tasks', { title: 'Follow up after call', lead_id: leadId, due_at: new Date(due).toISOString(), source: 'manual', description: detail.trim() || null })
      }
    } catch (caught) {
      setError(`${savedCall.current ? 'Call saved. Follow-up was not saved. Retry to save the follow-up only. ' : ''}${caught instanceof Error ? caught.message : 'Could not save'}`)
      setPending(false)
      return
    }
    const saved = savedCall.current!
    savedCall.current = null
    setHasSavedCall(false)
    setDetail(''); setDue(''); setOutcome('connected')
    onOpenChange(false)
    try { await onSaved?.(saved.timestamp, saved.contacted) } catch { /* The persisted call must not be retried because a summary refresh failed. */ } finally { setPending(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!pending) {
      if (!value && savedCall.current) {
        const saved = savedCall.current
        savedCall.current = null
        setHasSavedCall(false)
        setDetail(''); setDue(''); setError(null)
        void Promise.resolve(onSaved?.(saved.timestamp, saved.contacted)).catch(() => {})
      }
      onOpenChange(value)
    } }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Log call</DialogTitle><DialogDescription>Record a completed call or attempt. This does not place a call.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm">Call outcome<select aria-label="Call outcome" className="block w-full rounded border p-2" disabled={pending || hasSavedCall} value={outcome} onChange={event => setOutcome(event.target.value)}>
        <option value="connected">Connected</option><option value="voicemail">Left voicemail</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option>
      </select></label>
      <label className="space-y-1 text-sm">Call notes<Input aria-label="Call notes" value={detail} disabled={pending || hasSavedCall} onChange={event => setDetail(event.target.value)} /></label>
      <label className="space-y-1 text-sm">Next follow-up (optional)<Input aria-label="Next follow-up" type="datetime-local" disabled={pending} value={due} onChange={event => setDue(event.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} onClick={() => void save()}>{pending ? 'Saving…' : hasSavedCall ? 'Save follow-up' : 'Save call'}</Button>
    </DialogContent>
  </Dialog>
}
