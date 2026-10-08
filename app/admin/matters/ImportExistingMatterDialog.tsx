'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { firmTodayKey } from '@/lib/firmDate'
import { formatPhoneInput } from '@/lib/phone'
import { PRACTICE_AREA_OPTIONS, type PracticeAreaCode } from '@/lib/practiceArea'
import { MATTER_WORK_STAGES as STAGES, type MatterStage } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type PlanMode = 'none' | 'remaining'

const DATE_FIELDS = [
  { key: 'openedOn', label: 'Opened' },
  { key: 'engagementSignedOn', label: 'Engagement signed' },
  { key: 'draftsSentOn', label: 'Drafts sent' },
  { key: 'signedOn', label: 'Documents signed' },
  { key: 'fundingCompletedOn', label: 'Funding completed' },
  { key: 'closedOn', label: 'Closed' },
] as const

type DateKey = (typeof DATE_FIELDS)[number]['key']

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Bring in a matter that began outside Cornerstone: land it on the stage it
 * has really reached, with its real dates, and without the new-client
 * workflow — no plan by default, and nothing emailed to the client.
 */
export default function ImportExistingMatterDialog({ open, onOpenChange }: Props) {
  const router = useRouter()
  const token = useAccessToken()
  const today = useMemo(() => firmTodayKey(), [])
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [practiceArea, setPracticeArea] = useState<PracticeAreaCode>('EP')
  const [matterNumber, setMatterNumber] = useState('')
  const [stage, setStage] = useState<MatterStage>('closed')
  const [plan, setPlan] = useState<PlanMode>('none')
  const [dates, setDates] = useState<Partial<Record<DateKey, string>>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const closed = stage === 'closed'

  function reset() {
    setRequestId(crypto.randomUUID())
    setClientName('')
    setClientEmail('')
    setClientPhone('')
    setPracticeArea('EP')
    setMatterNumber('')
    setStage('closed')
    setPlan('none')
    setDates({})
    setNotes('')
  }

  async function submit() {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/matters/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          clientName,
          clientEmail,
          clientPhone: clientPhone || null,
          practiceArea,
          matterNumber: matterNumber || null,
          stage,
          plan: closed ? 'none' : plan,
          // Only the closed date depends on the stage; drop it if the stage moved.
          dates: closed ? dates : { ...dates, closedOn: undefined },
          notes: notes || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Could not import that matter')
        return
      }
      for (const warning of (body.warnings ?? []) as string[]) toast.warning(warning)
      toast.success(
        body.created === false
          ? 'That matter was already imported'
          : 'Matter imported — upload its executed documents next',
      )
      onOpenChange(false)
      reset()
      router.push(`/admin/matters/${body.matterId}?tab=documents`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bring in an existing matter</DialogTitle>
          <DialogDescription>
            For a client whose matter began outside Cornerstone. It lands on the stage it has
            reached, with its real dates. Nothing is emailed to the client.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="import-client-name">Client name</Label>
            <Input id="import-client-name" value={clientName} onChange={e => setClientName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-client-email">Client email</Label>
              <Input id="import-client-email" type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="import-client-phone">Phone (optional)</Label>
              <Input
                id="import-client-phone"
                type="tel"
                value={clientPhone}
                onChange={e => setClientPhone(formatPhoneInput(e.target.value))}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Practice area</Label>
              <Select value={practiceArea} onValueChange={v => setPracticeArea(v as PracticeAreaCode)}>
                <SelectTrigger aria-label="Practice area"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRACTICE_AREA_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="import-matter-number">Existing matter number (optional)</Label>
              <Input id="import-matter-number" value={matterNumber} onChange={e => setMatterNumber(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Where the matter is now</Label>
            <Select value={stage} onValueChange={v => setStage(v as MatterStage)}>
              <SelectTrigger aria-label="Stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map(s => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium">Task plan</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="import-plan"
                className="mt-1"
                checked={closed || plan === 'none'}
                onChange={() => setPlan('none')}
              />
              <span>
                No plan
                <span className="block text-xs text-muted-foreground">
                  Nothing is scheduled and no reminders go out. You can generate a plan later from the Tasks tab.
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${closed ? 'opacity-50' : ''}`}>
              <input
                type="radio"
                name="import-plan"
                className="mt-1"
                disabled={closed}
                checked={!closed && plan === 'remaining'}
                onChange={() => setPlan('remaining')}
              />
              <span>
                Plan the remaining work
                <span className="block text-xs text-muted-foreground">
                  Earlier stages are skipped. What is left is scheduled from today, and its client reminders are live.
                </span>
              </span>
            </label>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            {DATE_FIELDS.filter(field => field.key !== 'closedOn' || closed).map(field => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`import-${field.key}`}>{field.label} (optional)</Label>
                <Input
                  id={`import-${field.key}`}
                  type="date"
                  max={today}
                  value={dates[field.key] ?? ''}
                  onChange={e => setDates(prev => ({ ...prev, [field.key]: e.target.value || undefined }))}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="import-notes">Notes (optional)</Label>
            <Textarea
              id="import-notes"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Drafted in WealthCounsel; originals in the vault"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || !clientName.trim() || !clientEmail.trim()}>
            {submitting ? 'Importing…' : 'Import matter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
