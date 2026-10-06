'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { DEFAULT_ANNUAL_REVIEW_SETTINGS, formatDateKey, type AnnualReviewSettings, type OutreachPreview, type SkipReason } from '@/lib/annualReview/model'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatFirmDate } from '@/lib/format'

const SKIP_LABELS: Record<SkipReason, string> = {
  not_due: 'not due yet',
  not_signed: 'plan not signed',
  no_anchor: 'no signing date on file',
  no_email: 'no client email',
  opted_out: 'opted out',
  not_estate_planning: 'not an estate plan',
  archived: 'archived',
}

const STATUS_LABELS: Record<string, string> = {
  drafted: 'Waiting for approval',
  sent: 'Sent',
  skipped: 'Set aside',
  failed: 'Failed',
}

type Draft = { monthsAfterSigning: string; cadenceMonths: string; leadDays: string }

function toDraft(settings: AnnualReviewSettings): Draft {
  return {
    monthsAfterSigning: String(settings.monthsAfterSigning),
    cadenceMonths: String(settings.cadenceMonths),
    leadDays: String(settings.leadDays),
  }
}

/**
 * The annual review campaign: on or off, how long after signing the first
 * review comes, how often after that, how much notice, and who the next
 * weekday run would ask. Sends themselves obey the delegation dial.
 */
export function AnnualReviewSettingsSection({ isAdministrator }: { isAdministrator: boolean }) {
  const token = useAccessToken()
  const [settings, setSettings] = useState<AnnualReviewSettings>(DEFAULT_ANNUAL_REVIEW_SETTINGS)
  const [preview, setPreview] = useState<OutreachPreview | null>(null)
  const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_ANNUAL_REVIEW_SETTINGS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/annual-review', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({})) as { settings?: AnnualReviewSettings; preview?: OutreachPreview; error?: string }
      if (!res.ok || !body.settings) throw new Error(body.error ?? 'Failed to load annual review settings')
      setSettings(body.settings)
      setDraft(toDraft(body.settings))
      setPreview(body.preview ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load annual review settings')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function save(patch: Partial<AnnualReviewSettings>) {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/annual-review', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => ({})) as { settings?: AnnualReviewSettings; error?: string }
      if (!res.ok || !body.settings) throw new Error(body.error ?? 'Could not save')
      setSettings(body.settings)
      setDraft(toDraft(body.settings))
      toast.success(patch.enabled === undefined ? 'Annual review cadence saved' : patch.enabled ? 'Annual review invitations on' : 'Annual review invitations off')
      // Who is due depends on the cadence; refresh the preview to match.
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  function saveCadence() {
    const parse = (value: string) => Number.parseInt(value, 10)
    void save({
      monthsAfterSigning: parse(draft.monthsAfterSigning),
      cadenceMonths: parse(draft.cadenceMonths),
      leadDays: parse(draft.leadDays),
    })
  }

  const dirty = draft.monthsAfterSigning !== String(settings.monthsAfterSigning)
    || draft.cadenceMonths !== String(settings.cadenceMonths)
    || draft.leadDays !== String(settings.leadDays)

  if (loading && !preview) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </p>
    )
  }

  const skipped = preview ? (Object.entries(preview.skipped) as Array<[SkipReason, number]>).filter(([, count]) => count > 0) : []

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          A year after a plan is signed, the client hears from the firm: an email naming the life
          changes that make a plan stale, with a link to book a short review call. Each weekday
          morning the run finds who is due, drafts the invitation, and offers the send through the
          delegation dial, so at &ldquo;Propose&rdquo; each one waits for you on Today.
          {isAdministrator ? '' : ' Changing these settings requires the administrator role.'}
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Invite clients to annual reviews</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Off until you turn it on. Nothing is drafted or sent while it is off.
            </p>
          </div>
          <Switch
            aria-label="Invite clients to annual reviews"
            checked={settings.enabled}
            disabled={!isAdministrator || saving}
            onCheckedChange={checked => void save({ enabled: checked })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Months after signing</span>
            <Input
              className="h-9"
              inputMode="numeric"
              value={draft.monthsAfterSigning}
              disabled={!isAdministrator}
              onChange={e => setDraft(current => ({ ...current, monthsAfterSigning: e.target.value }))}
            />
            <span className="block text-xs text-muted-foreground">Before the first review.</span>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Months between reviews</span>
            <Input
              className="h-9"
              inputMode="numeric"
              value={draft.cadenceMonths}
              disabled={!isAdministrator}
              onChange={e => setDraft(current => ({ ...current, cadenceMonths: e.target.value }))}
            />
            <span className="block text-xs text-muted-foreground">After the first.</span>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Days of notice</span>
            <Input
              className="h-9"
              inputMode="numeric"
              value={draft.leadDays}
              disabled={!isAdministrator}
              onChange={e => setDraft(current => ({ ...current, leadDays: e.target.value }))}
            />
            <span className="block text-xs text-muted-foreground">How early the invitation goes out.</span>
          </label>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" disabled={!isAdministrator || !dirty || saving} onClick={saveCadence}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : 'Save cadence'}
          </Button>
        </div>
      </section>

      {preview && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Due in the next run</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.unavailable
                ? 'The outreach table has not reached this database yet; the run will do nothing until it does.'
                : `${preview.candidates} hired matter${preview.candidates === 1 ? '' : 's'} considered as of ${formatDateKey(preview.today)}.`}
              {!preview.enabled && !preview.unavailable ? ' The campaign is off, so these would only be asked once it is on.' : ''}
            </p>
          </div>
          {preview.due.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No one is due right now.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {preview.due.map(entry => (
                <li key={entry.matterId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/admin/matters/${entry.matterId}`} className="font-medium hover:underline">{entry.clientName}</Link>
                    <span className="block text-xs text-muted-foreground">
                      {entry.clientEmail ?? 'no email'} · {entry.yearsSinceSigning === 1 ? 'first review' : `review ${entry.yearsSinceSigning}`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">Due {formatDateKey(entry.dueOn)}</span>
                </li>
              ))}
            </ul>
          )}
          {skipped.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not asked: {skipped.map(([reason, count]) => `${count} ${SKIP_LABELS[reason]}`).join(', ')}.
            </p>
          )}
        </section>
      )}

      {preview && preview.recent.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Recent invitations</h3>
          <ul className="divide-y rounded-lg border">
            {preview.recent.map(row => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <Link href={`/admin/matters/${row.matterId}`} className="font-medium hover:underline">{row.matterName ?? row.toEmail}</Link>
                  <span className="block text-xs text-muted-foreground">
                    {row.toEmail} · review due {formatDateKey(row.cycleDueOn)}
                    {row.sentAt ? ` · sent ${formatFirmDate(row.sentAt)}` : ''}
                  </span>
                </div>
                <Badge variant={row.status === 'sent' ? 'default' : row.status === 'failed' ? 'destructive' : 'outline'}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
