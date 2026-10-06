'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { DEFAULT_FILE_CLOSING_SETTINGS, formatDateKey, type FileClosingSettings, type RetentionCandidate } from '@/lib/fileClosing/model'
import type { RetentionOverview } from '@/lib/fileClosing/server'
import { usePrompt } from '@/components/useConfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { formatFirmDate } from '@/lib/format'

/**
 * File closing and retention: how long closed files are kept, the closing
 * notice switch, which files are past their date (with a hold and a destroy
 * action each), which are held, and what was destroyed lately.
 */
export function FileClosingSettingsSection({ isAdministrator }: { isAdministrator: boolean }) {
  const token = useAccessToken()
  const [overview, setOverview] = useState<RetentionOverview | null>(null)
  const [settings, setSettings] = useState<FileClosingSettings>(DEFAULT_FILE_CLOSING_SETTINGS)
  const [yearsDraft, setYearsDraft] = useState(String(DEFAULT_FILE_CLOSING_SETTINGS.retentionYears))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyMatter, setBusyMatter] = useState<string | null>(null)
  // The app's own dialogs: a reason for a hold, and type-to-confirm before a
  // file is destroyed. Never the browser's, which can be silenced.
  const { prompt, promptDialog } = usePrompt()

  const headers = useCallback((json = false) => ({
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }), [token])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/file-closing', { headers: headers() })
      const body = await res.json().catch(() => ({})) as Partial<RetentionOverview> & { error?: string }
      if (!res.ok || !body.settings) throw new Error(body.error ?? 'Failed to load file closing settings')
      setOverview(body as RetentionOverview)
      setSettings(body.settings)
      setYearsDraft(String(body.settings.retentionYears))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load file closing settings')
    } finally {
      setLoading(false)
    }
  }, [headers, token])

  useEffect(() => { void load() }, [load])

  async function save(patch: Partial<FileClosingSettings>) {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/file-closing', { method: 'PATCH', headers: headers(true), body: JSON.stringify(patch) })
      const body = await res.json().catch(() => ({})) as { settings?: FileClosingSettings; error?: string }
      if (!res.ok || !body.settings) throw new Error(body.error ?? 'Could not save')
      setSettings(body.settings)
      setYearsDraft(String(body.settings.retentionYears))
      toast.success(patch.retentionYears !== undefined ? 'Retention period saved' : patch.closingNoticeEnabled ? 'Closing notice on' : 'Closing notice off')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function setHold(candidate: RetentionCandidate, hold: boolean) {
    if (!token) return
    let reason: string | null = null
    if (hold) {
      reason = await prompt({
        title: 'Hold this file',
        body: `${candidate.clientName ?? candidate.matterName} stays out of the destruction list until the hold is removed.`,
        label: 'Reason (optional)',
        placeholder: 'A dispute, a client request, an open estate…',
        confirmLabel: 'Place on hold',
      })
      // null is Cancel; '' is an optional reason left blank.
      if (reason === null) return
    }
    setBusyMatter(candidate.matterId)
    try {
      for (const [field, value] of [['retention_hold', hold], ['retention_hold_reason', hold ? (reason || null) : null]] as const) {
        const res = await fetch('/api/admin/matter-details', {
          method: 'PATCH',
          headers: headers(true),
          body: JSON.stringify({ matterId: candidate.matterId, field, value }),
        })
        const body = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(body.error ?? 'Could not update the hold')
      }
      toast.success(hold ? 'File placed on hold' : 'Hold removed')
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the hold')
    } finally {
      setBusyMatter(null)
    }
  }

  async function destroy(candidate: RetentionCandidate) {
    if (!token) return
    const typed = await prompt({
      title: 'Destroy this file?',
      body: `${candidate.clientName ?? candidate.matterName}: the matter, its documents, and the client's portal copies are permanently removed. The deletion is logged with who did it and why. This cannot be undone.`,
      label: 'Type DESTROY to confirm',
      placeholder: 'DESTROY',
      requireExact: 'DESTROY',
      confirmLabel: 'Destroy file',
      destructive: true,
    })
    if (typed === null) return
    setBusyMatter(candidate.matterId)
    try {
      const res = await fetch(`/api/admin/matters/${candidate.matterId}`, {
        method: 'DELETE',
        headers: headers(true),
        body: JSON.stringify({ confirm: true, reason: `Retention period ended ${candidate.retentionUntil ?? ''}`.trim() }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not destroy the file')
      toast.success(`${candidate.clientName ?? candidate.matterName}: file destroyed and logged`)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not destroy the file')
    } finally {
      setBusyMatter(null)
    }
  }

  if (loading && !overview) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </p>
    )
  }

  const yearsDirty = yearsDraft !== String(settings.retentionYears)

  function FileRow({ candidate, actions }: { candidate: RetentionCandidate; actions: boolean }) {
    const busy = busyMatter === candidate.matterId
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
        <div className="min-w-0">
          <Link href={`/admin/matters/${candidate.matterId}`} className="font-medium hover:underline">
            {candidate.clientName ?? candidate.matterName}
          </Link>
          <span className="block text-xs text-muted-foreground">
            {candidate.closedOn ? `Closed ${formatDateKey(candidate.closedOn)}` : 'Closed'}
            {candidate.retentionUntil ? ` · kept until ${formatDateKey(candidate.retentionUntil)}` : ' · no retention date'}
            {candidate.hold && candidate.holdReason ? ` · hold: ${candidate.holdReason}` : ''}
          </span>
        </div>
        {actions && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Hold
              <Switch
                aria-label={`Hold ${candidate.clientName ?? candidate.matterName}`}
                checked={candidate.hold}
                disabled={busy}
                onCheckedChange={checked => void setHold(candidate, checked)}
              />
            </label>
            {!candidate.hold && isAdministrator && (
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void destroy(candidate)}>
                Destroy file
              </Button>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Closing a matter runs the billing check, moves it to closed on both axes, stamps the
          closed date and the day the retention period ends, and offers the client a closing notice
          through the delegation dial. Each Monday the files past their date are listed here and a
          review task is proposed for each. Nothing is destroyed on its own: destruction is a
          person&apos;s decision, and every one is logged.
          {isAdministrator ? '' : ' Changing these settings and destroying a file require the administrator role.'}
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="space-y-1.5 text-sm">
            <span className="block text-xs font-medium text-muted-foreground">Years a closed file is kept</span>
            <Input
              className="h-9 w-24"
              inputMode="numeric"
              value={yearsDraft}
              disabled={!isAdministrator}
              onChange={e => setYearsDraft(e.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              Counted from the closed date. Massachusetts Rule of Professional Conduct 1.15A asks for at least six.
            </span>
          </label>
          <Button type="button" size="sm" variant="outline" disabled={!isAdministrator || !yearsDirty || saving} onClick={() => void save({ retentionYears: Number.parseInt(yearsDraft, 10) })}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : 'Save'}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-3 border-t pt-4">
          <div>
            <h2 className="text-sm font-semibold">Closing notice to the client</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              When a matter closes, draft the client&apos;s closing notice (the work is done, where their
              documents live, what to keep safe, how long the file is kept) and offer the send through
              the dial.
            </p>
          </div>
          <Switch
            aria-label="Closing notice to the client"
            checked={settings.closingNoticeEnabled}
            disabled={!isAdministrator || saving}
            onCheckedChange={checked => void save({ closingNoticeEnabled: checked })}
          />
        </div>
      </section>

      {overview && (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Past their retention date</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {overview.unavailable
                  ? 'The retention columns have not reached this database yet.'
                  : `As of ${formatDateKey(overview.today)}. Hold a file to keep it, or destroy it; destruction removes the matter, its documents and its portal copies, and writes the deletion record.`}
              </p>
            </div>
            {overview.due.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No closed file is past its retention date.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {overview.due.map(candidate => <FileRow key={candidate.matterId} candidate={candidate} actions />)}
              </ul>
            )}
          </section>

          {overview.held.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">On hold</h3>
              <ul className="divide-y rounded-lg border">
                {overview.held.map(candidate => <FileRow key={candidate.matterId} candidate={candidate} actions />)}
              </ul>
            </section>
          )}

          {overview.undated.length > 0 && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Closed without a retention date</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Closed before this shipped and without a closed date on record. Record the closed date on the matter&apos;s Close-out card and the weekly run stamps the rest.
                </p>
              </div>
              <ul className="divide-y rounded-lg border">
                {overview.undated.map(candidate => <FileRow key={candidate.matterId} candidate={candidate} actions={false} />)}
              </ul>
            </section>
          )}

          {overview.retained.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Within their retention period</h3>
              <ul className="divide-y rounded-lg border">
                {overview.retained.map(candidate => <FileRow key={candidate.matterId} candidate={candidate} actions={false} />)}
              </ul>
            </section>
          )}

          {overview.recentDestructions.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Recently destroyed</h3>
              <ul className="divide-y rounded-lg border">
                {overview.recentDestructions.map(row => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{row.matterName ?? row.matterNumber ?? 'Matter'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatFirmDate(row.deletedAt)}{row.deletedByEmail ? ` · ${row.deletedByEmail}` : ''}{row.reason ? ` · ${row.reason}` : ''}
                      </span>
                    </div>
                    <Badge variant="outline">Destroyed</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {promptDialog}
    </div>
  )
}
