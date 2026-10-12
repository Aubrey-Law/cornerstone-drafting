'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

export function MatterTextDialog({
  open,
  onOpenChange,
  clientName,
  clientPhone,
  smsEnabled,
  smsRecipient,
  onSmsRecipientChange,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientName: string
  clientPhone: string | null
  smsEnabled: boolean
  smsRecipient: 'client' | 'spouse'
  onSmsRecipientChange: (recipient: 'client' | 'spouse') => void
  onSend: (channel: 'sms', body: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const hint = `Text ${smsRecipient === 'spouse' ? 'spouse' : clientName}${clientPhone && smsRecipient === 'client' ? ` · ${clientPhone}` : ''}`

  async function submit() {
    if (submitting.current || pending || !smsEnabled || !text.trim()) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      if (await onSend('sms', text)) {
        setText('')
        onOpenChange(false)
      } else {
        setError('Message was not sent. Your draft is still here; please retry.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please retry.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Text client</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Text message"
          rows={3}
          placeholder="Write text message…"
          value={text}
          disabled={pending}
          maxLength={MAX_SMS_BODY_LENGTH}
          onChange={event => setText(event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          Recipient
          <select
            aria-label="Text recipient"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            disabled={pending}
            value={smsRecipient}
            onChange={event => onSmsRecipientChange(event.target.value as 'client' | 'spouse')}
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
          </select>
        </label>
        {!smsEnabled && <p className="text-sm text-muted-foreground">Text sending is not configured. Connect and enable your SMS provider to send texts.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={pending || !smsEnabled || !text.trim()} onClick={() => void submit()}>
            {pending ? 'Sending…' : 'Send text'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MatterLogCallDialog({
  open,
  onOpenChange,
  onLogCall,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogCall: (outcome: string, detail: string) => Promise<boolean>
}) {
  const [callNotes, setCallNotes] = useState('')
  const [outcome, setOutcome] = useState('Connected')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)

  async function submit() {
    if (submitting.current || pending) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      if (await onLogCall(outcome, callNotes)) {
        setCallNotes('')
        onOpenChange(false)
      } else {
        setError('Call was not saved. Your notes are still here; please retry.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please retry.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log call</DialogTitle>
          <DialogDescription>Records a completed call or attempt. It does not place a call.</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          Call outcome
          <select
            aria-label="Call outcome"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={outcome}
            disabled={pending}
            onChange={event => setOutcome(event.target.value)}
          >
            {['Connected', 'Left voicemail', 'No answer', 'Wrong number'].map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <Textarea
          aria-label="Call notes"
          rows={3}
          placeholder="Add call notes (optional)…"
          value={callNotes}
          disabled={pending}
          onChange={event => setCallNotes(event.target.value)}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? 'Saving…' : 'Save call'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
