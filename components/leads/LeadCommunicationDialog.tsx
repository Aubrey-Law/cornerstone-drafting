'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'

type Props = {
  open: boolean
  channel: 'email' | 'sms'
  leadId: string
  clientName: string
  clientFirstName: string
  email: string
  phone: string
  token: string | null
  onOpenChange: (open: boolean) => void
  onSent: () => void | Promise<void>
  intakeUrl?: string | null
  initialMessage?: string
}

export function LeadCommunicationDialog(props: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) {
      setMessage('')
      setError(null)
    } else if (props.channel === 'sms' && props.initialMessage) {
      setMessage(props.initialMessage.slice(0, MAX_LEAD_SMS_BODY_LENGTH))
    }
  }, [props.channel, props.initialMessage, props.open])

  async function send() {
    if (!props.token) return
    if (message.length > MAX_LEAD_SMS_BODY_LENGTH) {
      setError(`Message must be ${MAX_LEAD_SMS_BODY_LENGTH} characters or fewer`)
      return
    }
    setSending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/leads/${props.leadId}/send-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${props.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: message.trim() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not send text')
      await props.onSent()
      props.onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const email = props.channel === 'email'
  if (email) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="p-0 sm:max-w-2xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Email lead</DialogTitle>
            <DialogDescription>{props.email} · {props.clientName}</DialogDescription>
          </DialogHeader>
          <ManualEmailComposer
            embedded
            recordOverride={{ type: 'lead', id: props.leadId }}
            initialContext={{
              recordType: 'lead',
              recordId: props.leadId,
              recipientName: props.clientName,
              recipientEmail: props.email,
              spouseName: null,
              spouseEmail: null,
              alternateEmails: [],
              documents: [],
            }}
            templateCategories={['manual', 'intake_invite']}
            variableValues={{
              client_name: props.clientName,
              client_first_name: props.clientFirstName,
              first_name: props.clientFirstName,
              lead_name: props.clientName,
              intake_link: props.intakeUrl,
              intakeUrl: props.intakeUrl,
            }}
            onSent={async () => {
              await props.onSent()
              props.onOpenChange(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  }
  const ready = Boolean(message.trim()) && message.length <= MAX_LEAD_SMS_BODY_LENGTH
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{email ? 'Email lead' : 'Text lead'}</DialogTitle>
          <DialogDescription>
            {email ? props.email : props.phone} · {props.clientName}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
            <div className="space-y-1.5">
            <Label htmlFor="lead-communication-body">Text message</Label>
            <Textarea
              id="lead-communication-body"
              className="min-h-40"
              maxLength={MAX_LEAD_SMS_BODY_LENGTH}
              value={message}
              onChange={event => setMessage(event.target.value.slice(0, MAX_LEAD_SMS_BODY_LENGTH))}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length}/{MAX_LEAD_SMS_BODY_LENGTH}</p>
            <DraftWithAiButton
              apiPath={`/api/admin/leads/${props.leadId}/draft-reply`}
              channel="sms"
              notes={message}
              maxChars={MAX_LEAD_SMS_BODY_LENGTH}
              onDraft={next => setMessage(next.slice(0, MAX_LEAD_SMS_BODY_LENGTH))}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={() => void send()} disabled={sending || !ready}>
            {sending ? 'Sending…' : 'Send text'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
