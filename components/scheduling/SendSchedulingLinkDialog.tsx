'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResizableTextarea } from '@/components/ui/drag-resize'

export interface SchedulingLinkTarget {
  kind: 'lead' | 'matter'
  id: string
}

interface TypeOption {
  key: string
  label: string
  configured: boolean
  links: { email: string; sms: string; portal: string } | null
  embedUrl: string | null
}

interface DialogData {
  recipient: { name: string; email: string | null; phone: string | null }
  smsConfigured: boolean
  portalAvailable: boolean
  types: TypeOption[]
}

type Channel = 'email' | 'sms' | 'portal'

function defaultMessage(name: string, label: string, link: string): string {
  const first = name.split(' ')[0]
  return `Hi ${first},\n\nPlease use this link to schedule your ${label}:\n${link}\n\nIf none of the times work, let us know and we'll find one that does.`
}

export function SendSchedulingLinkDialog({
  target,
  open,
  onOpenChange,
}: {
  target: SchedulingLinkTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const token = useAccessToken()
  const [data, setData] = useState<DialogData | null>(null)
  const [typeKey, setTypeKey] = useState<string>('')
  const [channel, setChannel] = useState<Channel>('email')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const [subjectDirty, setSubjectDirty] = useState(false)
  const [sending, setSending] = useState(false)

  const query = target.kind === 'lead' ? `leadId=${target.id}` : `matterId=${target.id}`

  useEffect(() => {
    if (!open || !token) return
    setData(null)
    fetch(`/api/admin/scheduling-links/send?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load')
        return json as DialogData
      })
      .then(json => {
        setData(json)
        const firstConfigured = json.types.find(t => t.configured)
        setTypeKey(firstConfigured?.key ?? '')
        setChannel(json.recipient.email ? 'email' : 'sms')
        setDirty(false)
        setSubjectDirty(false)
      })
      .catch(e => toast.error(e instanceof Error ? e.message : 'Failed to load scheduling links'))
  }, [open, token, query])

  const selected = useMemo(
    () => data?.types.find(t => t.key === typeKey) ?? null,
    [data, typeKey],
  )

  // Keep the prefilled message in sync with type/channel until the user edits it.
  useEffect(() => {
    if (!data || !selected?.links) return
    if (!subjectDirty) setSubject(`Schedule your ${selected.label}`)
    if (!dirty) {
      setMessage(defaultMessage(data.recipient.name, selected.label, selected.links[channel]))
    }
  }, [data, selected, channel, dirty, subjectDirty])

  const send = useCallback(async () => {
    setSending(true)
    try {
      const res = await fetch('/api/admin/scheduling-links/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          target: target.kind === 'lead' ? { leadId: target.id } : { matterId: target.id },
          meetingTypeKey: typeKey,
          channel,
          subject: channel === 'email' ? subject : undefined,
          message,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      toast.success(
        channel === 'portal' ? 'Posted to the client portal' : `Scheduling link ${json.status}`,
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [token, target, typeKey, channel, subject, message, onOpenChange])

  const channelDisabled = (c: Channel): string | null => {
    if (!data) return 'Loading'
    if (c === 'email' && !data.recipient.email) return 'no email on file'
    if (c === 'sms' && !data.smsConfigured) return 'SMS not configured'
    if (c === 'sms' && !data.recipient.phone) return 'no phone on file'
    if (c === 'portal' && !data.portalAvailable) return 'portal is for hired clients'
    return null
  }

  const CHANNEL_LABELS: Record<Channel, string> = {
    email: 'Email',
    sms: 'Text message',
    portal: 'Client portal',
  }

  const recipientDetail = data
    ? channel === 'email'
      ? data.recipient.email
      : channel === 'sms'
        ? data.recipient.phone
        : 'client portal message'
    : null

  const disabledReasons = data
    ? (['email', 'sms', 'portal'] as const)
        .map(c => {
          const reason = channelDisabled(c)
          return reason ? `${CHANNEL_LABELS[c]} unavailable — ${reason}` : null
        })
        .filter(Boolean)
    : []

  const sendLabel = channel === 'email' ? 'Send email' : channel === 'sms' ? 'Send text' : 'Post to portal'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* min-w-0 throughout: DialogContent is a grid, so children default to
          min-width:auto and the long appointment-type labels (Button sets
          whitespace-nowrap + shrink-0) would otherwise force the whole dialog
          wider than its max-width and produce a horizontal scrollbar. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Send scheduling link</DialogTitle>
          {data && (
            <p className="text-sm text-muted-foreground">
              To: <span className="font-medium text-foreground">{data.recipient.name}</span>
              {recipientDetail ? <> · {recipientDetail}</> : null}
            </p>
          )}
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="min-w-0 space-y-5">
            <div className="min-w-0 space-y-1.5">
              <Label>Appointment type</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.types.map(type => (
                  <Button
                    key={type.key}
                    type="button"
                    variant={typeKey === type.key ? 'default' : 'outline'}
                    // h-auto + whitespace-normal so long labels wrap to a second
                    // line instead of being clipped or widening the dialog.
                    className="h-auto min-w-0 w-full justify-start whitespace-normal py-2 text-left"
                    disabled={!type.configured}
                    title={type.configured ? undefined : 'Add the link in Settings → Scheduling'}
                    onClick={() => { setTypeKey(type.key); setDirty(false); setSubjectDirty(false) }}
                  >
                    {type.label}
                  </Button>
                ))}
              </div>
              {!data.types.some(t => t.configured) && (
                <p className="text-xs text-destructive">
                  No Calendly links configured yet — add them in Settings → Scheduling.
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>Send via</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                {(['email', 'sms', 'portal'] as const).map(c => {
                  const reason = channelDisabled(c)
                  return (
                    <Button
                      key={c}
                      type="button"
                      variant={channel === c ? 'default' : 'outline'}
                      className="min-w-0 flex-1"
                      disabled={Boolean(reason)}
                      title={reason ?? undefined}
                      onClick={() => setChannel(c)}
                    >
                      {CHANNEL_LABELS[c]}
                    </Button>
                  )
                })}
              </div>
              {disabledReasons.length > 0 && (
                <p className="text-xs text-muted-foreground">{disabledReasons.join(' · ')}</p>
              )}
            </div>
            {channel === 'email' && (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="scheduling-link-subject">Subject</Label>
                <Input
                  id="scheduling-link-subject"
                  value={subject}
                  onChange={e => { setSubject(e.target.value); setSubjectDirty(true) }}
                />
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="scheduling-link-message">Message</Label>
              {/* break-words: the prefilled Calendly URL is one long unbroken
                  token and would otherwise scroll sideways inside the field. */}
              <ResizableTextarea
                id="scheduling-link-message"
                handleLabel="Resize message"
                rows={10}
                className="w-full [overflow-wrap:anywhere]"
                value={message}
                onChange={e => { setMessage(e.target.value); setDirty(true) }}
              />
              <p className="text-xs text-muted-foreground">
                The booking link is included automatically if you remove it from the message.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="min-w-32"
                onClick={send}
                disabled={sending || !typeKey || !selected?.configured}
              >
                {sending ? 'Sending…' : sendLabel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
