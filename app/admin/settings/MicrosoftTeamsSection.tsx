'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/useConfirm'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

interface TeamsStatus {
  envConfigured: boolean
  configIssue: string | null
  connected: boolean
  email: string | null
  hasTeamsScope: boolean
  canRefresh: boolean
  ownConnection: boolean
}

/**
 * The Microsoft 365 connection that creates Teams meetings. The calendar stays
 * on Google; this only supplies Teams join links for appointments.
 */
export function MicrosoftTeamsSection() {
  const token = useAccessToken()
  const { confirm, confirmDialog } = useConfirm()
  const [status, setStatus] = useState<TeamsStatus | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/admin/microsoft/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setStatus((await res.json()) as TeamsStatus)
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('msteams_connected') === '1') toast.success('Microsoft Teams connected')
    const err = sp.get('msteams_error')
    if (err) toast.error(err)
  }, [])

  const disconnect = async () => {
    if (!token) return
    const confirmed = await confirm({
      title: 'Disconnect Microsoft Teams?',
      body: 'New Teams meetings cannot be created until you connect again. Existing join links keep working.',
      confirmLabel: 'Disconnect Teams',
      destructive: true,
    })
    if (!confirmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/microsoft/status', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Disconnect failed')
      toast.success('Microsoft Teams disconnected')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Microsoft Teams</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect a Microsoft 365 work account to put Teams meetings on appointments. Appointments
          stay on Google Calendar; the Teams join link replaces the Google Meet link on the invite
          and in the client&rsquo;s emails. Choose Teams when booking a virtual meeting, or use{' '}
          <em>Add Teams meeting</em> on any upcoming appointment in the calendar.
        </p>
      </div>
      {!status ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : !status.envConfigured ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          Microsoft Teams is not configured.
          {status.configIssue ? ` ${status.configIssue}.` : ''} Set MICROSOFT_CLIENT_ID,
          MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI (pointing at
          /api/admin/microsoft/callback), then redeploy.
        </p>
      ) : status.connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Connected as{' '}
              <span className="font-medium">{status.email || 'Microsoft 365 account'}</span>
            </p>
            {status.ownConnection ? (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <a href="/api/admin/microsoft/connect">Use my account</a>
              </Button>
            )}
          </div>
          {!status.canRefresh && (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              This connection has no refresh token, so it will stop working within the hour. Connect
              again.
            </p>
          )}
          {!status.hasTeamsScope && (
            <p className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
              This connection was not granted OnlineMeetings.ReadWrite, so Teams meetings cannot be
              created. Reconnect, and have a Microsoft 365 admin grant consent if prompted.
            </p>
          )}
        </div>
      ) : (
        <Button size="sm" asChild>
          <a href="/api/admin/microsoft/connect">Connect Microsoft Teams</a>
        </Button>
      )}
      {confirmDialog}
    </section>
  )
}
