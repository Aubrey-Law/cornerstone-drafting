'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  emailHtmlIsEmpty,
  emailHtmlToText,
  RichTextEmailEditor,
} from '@/components/admin/RichTextEmailEditor'
import {
  renderEmailTemplateBodyHtml, renderEmailTemplateText,
} from '@/lib/email/templateShared'

type Template = {
  id: string
  name: string
  subject: string
  body: string
}

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
}

export function LeadCommunicationDialog(props: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('none')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [messageHtml, setMessageHtml] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open || props.channel !== 'email' || !props.token) return
    void fetch('/api/admin/settings/email/templates?category=manual&active=true', {
      headers: { Authorization: `Bearer ${props.token}` },
    })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load email templates')
        setTemplates(Array.isArray(body.templates) ? body.templates : [])
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Could not load email templates'))
  }, [props.channel, props.open, props.token])

  useEffect(() => {
    if (!props.open) {
      setTemplateId('none')
      setSubject('')
      setMessage('')
      setMessageHtml('')
      setError(null)
    }
  }, [props.open])

  function chooseTemplate(id: string) {
    setTemplateId(id)
    if (id === 'none') {
      setSubject('')
      setMessage('')
      setMessageHtml('')
      return
    }
    const template = templates.find(row => row.id === id)
    if (!template) return
    const variables = {
      client_name: props.clientName,
      client_first_name: props.clientFirstName,
      first_name: props.clientFirstName,
      lead_name: props.clientName,
    }
    setSubject(renderEmailTemplateText(template.subject, variables))
    setMessageHtml(renderEmailTemplateBodyHtml(template.body, variables))
  }

  async function send() {
    if (!props.token) return
    setSending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/leads/${props.leadId}/send-${props.channel}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${props.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(props.channel === 'email'
          ? {
              subject: subject.trim(),
              text: emailHtmlToText(messageHtml),
              html: messageHtml,
            }
          : { body: message.trim() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Could not send ${props.channel === 'email' ? 'email' : 'text'}`)
      await props.onSent()
      props.onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const email = props.channel === 'email'
  const ready = email
    ? Boolean(subject.trim()) && !emailHtmlIsEmpty(messageHtml)
    : Boolean(message.trim())
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
          {email && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lead-email-template">Template</Label>
                <Select value={templateId} onValueChange={chooseTemplate}>
                  <SelectTrigger id="lead-email-template"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">One-off email</SelectItem>
                    {templates.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-email-subject">Subject</Label>
                <Input id="lead-email-subject" value={subject} onChange={event => setSubject(event.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lead-communication-body">{email ? 'Message' : 'Text message'}</Label>
            {email ? (
              <RichTextEmailEditor
                id="lead-communication-body"
                ariaLabel="Message"
                valueHtml={messageHtml}
                onChange={setMessageHtml}
                disabled={sending}
                placeholder="Write your message"
              />
            ) : (
              <>
                <Textarea
                  id="lead-communication-body"
                  className="min-h-40"
                  maxLength={1600}
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                />
                <p className="text-right text-xs text-muted-foreground">{message.length}/1600</p>
              </>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={() => void send()} disabled={sending || !ready}>
            {sending ? 'Sending…' : email ? 'Send email' : 'Send text'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
