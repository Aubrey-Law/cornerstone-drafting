'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'

type StatularSettings = {
  syncEnabled: boolean
  config: { clientConfigured: boolean; matterConfigured: boolean; generationConfigured: boolean }
}

/** Settings → Statular: webhook readiness and the create-on-fit toggle. */
export function StatularSettingsSection() {
  const token = useAccessToken()
  const [settings, setSettings] = useState<StatularSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/statular', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to load Statular settings')
      setSettings(body as StatularSettings)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load Statular settings')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(syncEnabled: boolean) {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/statular', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncEnabled }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      setSettings(body as StatularSettings)
      toast.success(syncEnabled
        ? 'Statular clients will be created when a lead is marked a fit'
        : 'Automatic Statular clients turned off')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Statular settings…
      </div>
    )
  }

  if (!settings) return null
  const ready = settings.config.clientConfigured && settings.config.generationConfigured

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Statular webhook</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Set in Vercel as <span className="font-mono">STATULAR_CLIENT_WEBHOOK_URL</span> and{' '}
              <span className="font-mono">STATULAR_WEBHOOK_GENERATION</span>. Push to Statular on a lead or matter
              works as soon as these are set.
            </p>
          </div>
          <Badge variant={ready ? 'secondary' : 'outline'}>{ready ? 'Configured' : 'Not configured'}</Badge>
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor="statular-sync-enabled" className="text-sm font-semibold">
              Create Statular client when a lead is marked a fit
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Choosing &ldquo;Proceed — good fit&rdquo; in a lead&apos;s key dates creates the client in Statular.
              Not-a-fit leads are never sent. Statular can&apos;t update or delete clients, so later corrections
              are made in Statular.
            </p>
            {!ready && (
              <p className="mt-2 text-xs text-destructive">
                The Statular webhook isn&apos;t configured, so nothing can be sent yet.
              </p>
            )}
          </div>
          <Switch
            id="statular-sync-enabled"
            checked={settings.syncEnabled}
            disabled={saving}
            onCheckedChange={checked => void toggle(checked)}
          />
        </div>
      </section>
    </div>
  )
}
