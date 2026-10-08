'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { cn } from '@/lib/utils'

const EmailComposer = dynamic(() => import('@/components/rail/RailEmailPane').then(module => module.ManualEmailComposer), {
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading email composer…</p>,
})
const modes = ['Note', 'Portal message', 'Email', 'Text', 'Log call'] as const
type Mode = typeof modes[number]

interface Props {
  matterId: string
  clientName: string
  clientEmail: string | null
  clientPhone: string | null
  smsEnabled: boolean
  emailEnabled: boolean
  noteText: string
  onNoteChange: (text: string) => void
  noteSaving: boolean
  onAddNote: () => Promise<void>
  portalDraft: string
  onPortalChange: (text: string) => void
  onSend: (channel: 'portal' | 'sms', body: string) => Promise<boolean>
  smsRecipient: 'client' | 'spouse'
  onSmsRecipientChange: (recipient: 'client' | 'spouse') => void
  onLogCall: (outcome: string, detail: string) => Promise<boolean>
  onEmailSent: () => void
}

export function MatterOverviewComposer(props: Props) {
  const [mode, setMode] = useState<Mode>('Note')
  const [emailVisited, setEmailVisited] = useState(false)
  const [text, setText] = useState('')
  const [callNotes, setCallNotes] = useState('')
  const [outcome, setOutcome] = useState('Connected')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const busy = pending || props.noteSaving
  const body = mode === 'Note' ? props.noteText : mode === 'Portal message' ? props.portalDraft : mode === 'Text' ? text : callNotes
  const label = mode === 'Note' ? 'Internal note' : mode === 'Log call' ? 'Call notes' : mode === 'Text' ? 'Text message' : 'Portal message'
  const action = mode === 'Note' ? 'Add note' : mode === 'Log call' ? 'Save call' : mode === 'Text' ? 'Send text' : 'Send portal message'
  const unavailable = mode === 'Text' && !props.smsEnabled
  async function submit() {
    if (submitting.current || busy || unavailable || (mode !== 'Log call' && !body.trim())) return
    submitting.current = true
    setPending(true); setError(null)
    try {
      if (mode === 'Note') await props.onAddNote()
      else if (mode === 'Log call') {
        if (await props.onLogCall(outcome, callNotes)) setCallNotes('')
        else setError('Call was not saved. Your notes are still here; please retry.')
      } else if (mode === 'Portal message' || mode === 'Text') {
        if (await props.onSend(mode === 'Text' ? 'sms' : 'portal', body)) {
          if (mode === 'Text') setText('')
          else props.onPortalChange('')
        } else setError('Message was not sent. Your draft is still here; please retry.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save. Please retry.')
    } finally { submitting.current = false; setPending(false) }
  }
  const hint = mode === 'Note' ? 'Visible to staff only' : mode === 'Portal message' ? `Secure portal message to ${props.clientName}` : mode === 'Email' ? `Email ${props.clientName}` : mode === 'Text' ? `Text ${props.smsRecipient === 'spouse' ? 'spouse' : props.clientName}${props.clientPhone && props.smsRecipient === 'client' ? ` · ${props.clientPhone}` : ''}` : 'Records a completed call or attempt; it does not place a call'
  return <section aria-label="Matter communication composer" className="px-4 py-3.5">
    {emailVisited && <div hidden={mode !== 'Email'}>
      {props.emailEnabled ? <EmailComposer embedded recordOverride={{ type: 'matter', id: props.matterId }} initialContext={{
        recordType: 'matter', recordId: props.matterId, recipientName: props.clientName, recipientEmail: props.clientEmail,
        spouseName: null, spouseEmail: null, alternateEmails: [], documents: [],
      }} onSent={props.onEmailSent} /> : <p className="py-2 text-sm text-muted-foreground">Email sending is not configured.</p>}
    </div>}
    {mode !== 'Email' && <>
      <Textarea aria-label={label} rows={2} placeholder={mode === 'Log call' ? 'Add call notes (optional)…' : `Write ${label.toLowerCase()}…`} value={body} disabled={busy} maxLength={mode === 'Text' ? MAX_SMS_BODY_LENGTH : undefined} onChange={event => {
        if (mode === 'Note') props.onNoteChange(event.target.value)
        else if (mode === 'Portal message') props.onPortalChange(event.target.value)
        else if (mode === 'Text') setText(event.target.value)
        else setCallNotes(event.target.value)
      }} className="min-h-16 resize-y border-input" />
      {mode === 'Text' && <label className="mt-2 flex items-center gap-2 text-compact">Recipient
        <select aria-label="Text recipient" className="h-[30px] rounded-md border bg-background px-2 text-compact" disabled={busy} value={props.smsRecipient} onChange={event => props.onSmsRecipientChange(event.target.value as 'client' | 'spouse')}>
          <option value="client">Client</option><option value="spouse">Spouse</option>
        </select>
      </label>}
      {mode === 'Log call' && <label className="mt-2 flex items-center gap-2 text-compact">Call outcome
        <select aria-label="Call outcome" className="h-[30px] rounded-md border bg-background px-2 text-compact" value={outcome} disabled={busy} onChange={event => setOutcome(event.target.value)}>
          {['Connected', 'Left voicemail', 'No answer', 'Wrong number'].map(value => <option key={value}>{value}</option>)}
        </select>
      </label>}
      {unavailable && <p className="mt-2 text-sm text-muted-foreground">Text sending is not configured. Connect and enable your SMS provider to send texts.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </>}
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <div role="group" aria-label="Compose action" className="flex flex-wrap gap-1.5">
        {modes.map(item => <button key={item} type="button" aria-pressed={mode === item} disabled={busy} onClick={() => {
          setMode(item); setError(null)
          if (item === 'Email') setEmailVisited(true)
        }} className={cn('rounded-full border px-2.5 py-0.5 font-medium transition-colors disabled:opacity-50',
          mode === item ? 'border-selected-border bg-selected text-selected-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent')}>{item}</button>)}
      </div>
      <span className="flex-1" />
      <span className="text-muted-foreground">{hint}</span>
      {mode !== 'Email' && <Button type="button" size="sm" className="h-7 px-2.5 text-compact" disabled={busy || unavailable || (mode !== 'Log call' && !body.trim())} onClick={() => void submit()}>{busy ? (mode === 'Text' || mode === 'Portal message' ? 'Sending…' : 'Saving…') : action}</Button>}
    </div>
  </section>
}
