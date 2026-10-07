'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { REQUEST_SECTIONS, REQUEST_SECTION_LABELS, type ProbateSetOption } from '@/lib/documentRequests/probateSet'

interface ProbateRequestListPanelProps {
  matterId: string
  onSent: () => void | Promise<void>
  onClose: () => void
}

/**
 * The standard probate list, ticked by default where every estate needs the
 * item. The attorney unticks what this estate does not need and sends the rest
 * in one step; the client gets one notice and the list in their portal.
 */
export function ProbateRequestListPanel({ matterId, onSent, onClose }: ProbateRequestListPanelProps) {
  const token = useAccessToken()
  const [items, setItems] = useState<ProbateSetOption[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [dueOn, setDueOn] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const result = await apiRequest<{ items: ProbateSetOption[] }>(
        `/api/admin/matters/${matterId}/document-requests/probate-list`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setItems(result.items)
      setChosen(new Set(result.items.filter(item => item.defaultSelected && !item.alreadyRequested).map(item => item.key)))
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'The probate list is unavailable')
      onClose()
    }
  }, [token, matterId, onClose])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => REQUEST_SECTIONS
    .map(section => ({ section, items: (items ?? []).filter(item => item.section === section) }))
    .filter(group => group.items.length > 0), [items])

  function toggle(key: string, on: boolean) {
    setChosen(current => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function send() {
    if (!token || chosen.size === 0) return
    setSending(true)
    try {
      const result = await apiRequest<{ created: unknown[] }>(`/api/admin/matters/${matterId}/document-requests/probate-list`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [...chosen], dueOn: dueOn || null }),
      }, 'Could not send the list')
      const count = result.created.length
      toast.success(count === 0
        ? 'The client already has every item you chose'
        : `${count} ${count === 1 ? 'request' : 'requests'} sent; the client will see the list in their portal`)
      await onSent()
      onClose()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send the list')
    } finally {
      setSending(false)
    }
  }

  if (!items) {
    return <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">Loading the probate list…</p>
  }

  return (
    <div className="space-y-3 border-b border-border px-4 py-3" data-testid="probate-request-list">
      <p className="text-xs text-muted-foreground">
        Untick anything this estate does not need. Items the client has already been asked for are greyed out.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(group => (
          <fieldset key={group.section} className="space-y-1.5">
            <legend className="text-xs font-semibold text-foreground">{REQUEST_SECTION_LABELS[group.section]}</legend>
            {group.items.map(item => {
              const id = `probate-item-${item.key}`
              return (
                <div key={item.key} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={item.alreadyRequested || chosen.has(item.key)}
                    disabled={item.alreadyRequested || sending}
                    onCheckedChange={checked => toggle(item.key, checked === true)}
                  />
                  <Label htmlFor={id} className={item.alreadyRequested ? 'text-xs font-normal text-muted-foreground' : 'text-xs font-normal'}>
                    {item.title}
                    {item.alreadyRequested && <span className="ml-1">(already asked)</span>}
                  </Label>
                </div>
              )
            })}
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label htmlFor="probate-list-due" className="text-xs">Due (optional)</Label>
          <Input id="probate-list-due" type="date" className="h-9" value={dueOn} onChange={event => setDueOn(event.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" className="gap-1.5" disabled={sending || chosen.size === 0} onClick={() => void send()}>
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Ask the client for {chosen.size} {chosen.size === 1 ? 'item' : 'items'}
          </Button>
        </div>
      </div>
    </div>
  )
}
