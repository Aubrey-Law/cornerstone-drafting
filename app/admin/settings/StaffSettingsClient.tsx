'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_OPENAI_MODEL,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  type LlmProvider,
  type ModelsUserPreferences,
  modelOptionsForProvider,
  resolveActiveLlmPreference,
  type UserPreferences,
} from '@/lib/userPreferences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/PageHeader'
import { AiUsagePanel } from './AiUsagePanel'
import { EmailSettingsSection } from './EmailSettingsSection'
import { SchedulingSettingsSection } from './SchedulingSettingsSection'
import { CalendlyLinksSection } from './CalendlyLinksSection'
import { PipelineSlaSettings } from './PipelineSlaSettings'
import { TemplateCenter } from './TemplateCenter'

type Tab =
  | 'models'
  | 'api-keys'
  | 'connectors'
  | 'outlook'
  | 'google'
  | 'email'
  | 'scheduling'
  | 'sla'
  | 'ai-usage'
  | 'templates'

/**
 * Settings surfaces that are real routes rather than tabs. They render server-side
 * with their own data fetching, so they cannot live in this client component's tab
 * switch — but they belong to Settings, so the tab strip links to them.
 */
const SETTINGS_SUBROUTES = [
  { href: '/admin/settings/estate-tax', label: 'Estate tax' },
  { href: '/admin/settings/style-sets', label: 'Style sets' },
  { href: '/admin/settings/sync', label: 'Sync' },
] as const

interface ApiKeyStatus {
  provider: string
  configured: boolean
  source: 'user' | 'env' | null
  hint: string | null
}

interface ConnectorRow {
  id: string
  name: string
  serverUrl: string
  transport: string
  authMode: string
  enabled: boolean
  hasAuthConfig: boolean
}

export function StaffSettingsClient({
  initialTab = 'models',
  isAdministrator = false,
  currentUserId = '',
}: {
  initialTab?: Tab
  isAdministrator?: boolean
  currentUserId?: string
}) {
  const token = useAccessToken()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [prefs, setPrefs] = useState<UserPreferences>({})
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [connectors, setConnectors] = useState<ConnectorRow[]>([])
  const [saving, setSaving] = useState(false)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [newConnector, setNewConnector] = useState({
    name: '',
    serverUrl: '',
    authSecret: '',
  })
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(null)
  const [outlook, setOutlook] = useState<{
    connected: boolean
    email: string | null
  } | null>(null)
  const [google, setGoogle] = useState<{
    envConfigured: boolean
    configIssue: string | null
    connected: boolean
    email: string | null
    canRefresh: boolean
    hasGmailSendScope: boolean
    hasGmailModifyScope: boolean
  } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get('tab')
    if (
      t === 'outlook' ||
      t === 'google' ||
      t === 'email' ||
      t === 'scheduling' ||
      t === 'models' ||
      t === 'api-keys' ||
      t === 'connectors' ||
      t === 'sla' ||
      t === 'ai-usage' ||
      (t === 'templates' && isAdministrator)
    ) {
      setTab(t)
    }
    const err = sp.get('mscal_error')
    if (err) toast.error(err)
    if (sp.get('gcal_connected') === '1') {
      toast.success('Google connected')
    }
    const gerr = sp.get('gcal_error')
    // Google's failures are long and specific (a redirect URI that does not
    // match, a consent that returned no refresh token) and the whole message is
    // the instruction, so it is not truncated.
    if (gerr) toast.error(gerr)
  }, [isAdministrator])

  useEffect(() => {
    if (!token) return
    void (async () => {
      const [pRes, kRes, cRes, oRes, gRes] = await Promise.all([
        fetch('/api/admin/me/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/api-keys', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/connectors', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/microsoft/status', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/google/status', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (pRes.ok) {
        const body = await pRes.json()
        setPrefs(body.preferences ?? {})
      }
      if (kRes.ok) {
        const body = await kRes.json()
        setKeys(body.keys ?? [])
      }
      if (cRes.ok) {
        const body = await cRes.json()
        setConnectors(body.connectors ?? [])
      }
      if (oRes.ok) {
        const body = await oRes.json()
        setOutlook({ connected: Boolean(body.connected), email: body.email ?? null })
      }
      if (gRes.ok) {
        const body = await gRes.json()
        setGoogle({
          envConfigured: Boolean(body.envConfigured),
          configIssue: body.configIssue ?? null,
          connected: Boolean(body.connected),
          email: body.email ?? null,
          canRefresh: Boolean(body.canRefresh),
          hasGmailSendScope: Boolean(body.hasGmailSendScope),
          hasGmailModifyScope: Boolean(body.hasGmailModifyScope),
        })
      }
    })()
  }, [token])

  const saveModelsPatch = async (patch: Partial<ModelsUserPreferences>) => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/me/preferences', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences: { models: patch } }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      setPrefs(body.preferences ?? {})
      toast.success('Model preference saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const saveKey = async (provider: string) => {
    if (!token) return
    const key = keyDrafts[provider]?.trim()
    if (!key) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/me/api-keys', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider, key }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      setKeys(body.keys ?? [])
      setKeyDrafts(prev => ({ ...prev, [provider]: '' }))
      toast.success('API key saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save key')
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async (provider: string) => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/me/api-keys', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Delete failed')
      setKeys(body.keys ?? [])
      toast.success('Personal key removed (env fallback still applies if set)')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete key')
    } finally {
      setSaving(false)
    }
  }

  const addConnector = async () => {
    if (!token) return
    if (!newConnector.name.trim() || !newConnector.serverUrl.trim()) {
      toast.error('Name and server URL required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/me/connectors', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newConnector.name,
          serverUrl: newConnector.serverUrl,
          authMode: newConnector.authSecret ? 'bearer' : 'none',
          authSecret: newConnector.authSecret || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Create failed')
      setConnectors(prev => [...prev, body.connector])
      setNewConnector({ name: '', serverUrl: '', authSecret: '' })
      toast.success('Connector saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add connector')
    } finally {
      setSaving(false)
    }
  }

  const removeConnector = async (id: string) => {
    if (!token) return
    const res = await fetch(`/api/admin/me/connectors/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      toast.error('Could not delete connector')
      return
    }
    setConnectors(prev => prev.filter(c => c.id !== id))
  }

  const testConnector = async (id: string) => {
    if (!token || testingConnectorId) return
    setTestingConnectorId(id)
    try {
      const res = await fetch(`/api/admin/me/connectors/${id}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Test failed')
      if (body.ok) {
        const toolList = Array.isArray(body.tools) && body.tools.length > 0
          ? body.tools.slice(0, 8).join(', ')
          : 'no tools listed'
        toast.success(
          body.serverName
            ? `Connected to ${body.serverName} · tools: ${toolList}`
            : `Connected · tools: ${toolList}`,
        )
      } else {
        toast.error(body.error ?? 'Connection failed')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Connection test failed')
    } finally {
      setTestingConnectorId(null)
    }
  }

  const activeLlm = resolveActiveLlmPreference(prefs)
  const defaultProvider = prefs.models?.defaultProvider ?? DEFAULT_LLM_PROVIDER

  const keyForProvider = (provider: LlmProvider) =>
    keys.find(k => k.provider === provider)

  const modelFieldForProvider = (provider: LlmProvider): keyof ModelsUserPreferences => {
    switch (provider) {
      case 'anthropic':
        return 'anthropicModel'
      case 'openai':
        return 'openaiModel'
      case 'gemini':
        return 'geminiModel'
    }
  }

  const selectedModelForProvider = (provider: LlmProvider): string => {
    switch (provider) {
      case 'anthropic':
        return prefs.models?.anthropicModel || DEFAULT_ANTHROPIC_MODEL
      case 'openai':
        return prefs.models?.openaiModel || DEFAULT_OPENAI_MODEL
      case 'gemini':
        return prefs.models?.geminiModel || DEFAULT_GEMINI_MODEL
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Settings"
        description="Model preferences, API keys, MCP connectors, Google, firm templates, AI usage, and matter stage SLA."
      />

      <div className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ['models', 'Models'],
            ['api-keys', 'API Keys'],
            ['connectors', 'Connectors'],
            ['google', 'Google'],
            ['email', 'Email'],
            ['scheduling', 'Scheduling'],
            // Only while a stored Microsoft connection is still holding events
            // from before the firm left Microsoft 365.
            ...(outlook?.connected ? [['outlook', 'Outlook (legacy)'] as const] : []),
            ...(isAdministrator ? [['templates', 'Templates'] as const] : []),
            ['ai-usage', 'AI Usage'],
            ['sla', 'Stage SLA'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === id
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
        {/*
          Style sets and Sync are their own routes rather than tabs — they are server
          components with their own data fetching. They sit in the strip so they stay
          discoverable, but they navigate instead of setting tab state.
        */}
        {SETTINGS_SUBROUTES.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === 'models' && (
        <section className="space-y-5 rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="default-provider">Default AI provider</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose which vendor powers the matter assistant, AI redline, design-sheet import,
              tabular review, and draft refinement. Each provider uses its model selection and API key below.
            </p>
            <select
              id="default-provider"
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={defaultProvider}
              disabled={saving}
              onChange={e => void saveModelsPatch({ defaultProvider: e.target.value as LlmProvider })}
            >
              {LLM_PROVIDERS.map(provider => (
                <option key={provider} value={provider}>
                  {LLM_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </select>
            {(() => {
              const key = keyForProvider(activeLlm.provider)
              const configured = key?.configured
              return (
                <p className="mt-2 text-xs">
                  {configured ? (
                    <span className="text-green">
                      API key configured for {LLM_PROVIDER_LABELS[activeLlm.provider]} (
                      {key?.source}
                      {key?.hint ? ` · ${key.hint}` : ''})
                    </span>
                  ) : (
                    <span className="text-amber">
                      No API key for {LLM_PROVIDER_LABELS[activeLlm.provider]}.{' '}
                      <button
                        type="button"
                        className="underline hover:no-underline"
                        onClick={() => setTab('api-keys')}
                      >
                        Add one in API Keys
                      </button>
                    </span>
                  )}
                </p>
              )
            })()}
          </div>

          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground">Model per provider</p>
            {LLM_PROVIDERS.map(provider => {
              const options = modelOptionsForProvider(provider)
              const selected = selectedModelForProvider(provider)
              const field = modelFieldForProvider(provider)
              const isDefault = provider === defaultProvider
              const key = keyForProvider(provider)
              return (
                <div
                  key={provider}
                  className={`rounded-md border p-3 ${
                    isDefault ? 'border-primary/40 bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={`model-${provider}`} className="text-sm">
                      {LLM_PROVIDER_LABELS[provider]}
                      {isDefault ? (
                        <span className="ml-2 text-micro font-normal uppercase text-primary">
                          default
                        </span>
                      ) : null}
                    </Label>
                    <span className="text-micro text-muted-foreground">
                      {key?.configured ? 'Key configured' : 'Key missing'}
                    </span>
                  </div>
                  <select
                    id={`model-${provider}`}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={selected}
                    disabled={saving}
                    onChange={e =>
                      void saveModelsPatch({ [field]: e.target.value } as Partial<ModelsUserPreferences>)
                    }
                  >
                    {options.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                    {!options.some(o => o.id === selected) ? (
                      <option value={selected}>{selected}</option>
                    ) : null}
                  </select>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'api-keys' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">
            Keys are encrypted at rest with <code>USER_API_KEYS_ENCRYPTION_SECRET</code>. GET responses
            never include raw secrets. Resolution order: your key → firm env fallback.
          </p>
          {keys.map(k => (
            <div key={k.provider} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium capitalize">{k.provider}</p>
                  <p className="text-micro text-muted-foreground">
                    {k.configured
                      ? `Configured (${k.source}${k.hint ? ` · ${k.hint}` : ''})`
                      : 'Not configured'}
                  </p>
                </div>
                {k.source === 'user' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={saving}
                    onClick={() => void removeKey(k.provider)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder={`Paste ${k.provider} API key`}
                  value={keyDrafts[k.provider] ?? ''}
                  onChange={e =>
                    setKeyDrafts(prev => ({ ...prev, [k.provider]: e.target.value }))
                  }
                />
                <Button
                  size="sm"
                  disabled={saving || !keyDrafts[k.provider]?.trim()}
                  onClick={() => void saveKey(k.provider)}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          ))}
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              API key storage is unavailable until the SQL migration is applied.
            </p>
          ) : null}
        </section>
      )}

      {tab === 'connectors' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">
            Store MCP server URLs and bearer tokens. Use <strong>Test</strong> to verify initialize +
            tools/list. Enabled connectors expose tools to the drafting assistant automatically.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="conn-name">Name</Label>
              <Input
                id="conn-name"
                value={newConnector.name}
                onChange={e => setNewConnector(p => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="conn-url">Server URL</Label>
              <Input
                id="conn-url"
                placeholder="https://…"
                value={newConnector.serverUrl}
                onChange={e => setNewConnector(p => ({ ...p, serverUrl: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="conn-secret">Bearer token (optional)</Label>
              <Input
                id="conn-secret"
                type="password"
                value={newConnector.authSecret}
                onChange={e => setNewConnector(p => ({ ...p, authSecret: e.target.value }))}
              />
            </div>
          </div>
          <Button size="sm" disabled={saving} onClick={() => void addConnector()}>
            Add connector
          </Button>

          <ul className="divide-y divide-border rounded-md border border-border">
            {connectors.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted-foreground">No connectors yet.</li>
            ) : (
              connectors.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-micro text-muted-foreground">
                      {c.serverUrl} · {c.authMode}
                      {c.hasAuthConfig ? ' · auth stored' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      disabled={testingConnectorId === c.id}
                      onClick={() => void testConnector(c.id)}
                    >
                      {testingConnectorId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => void removeConnector(c.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {tab === 'google' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">Google Calendar &amp; Gmail</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect the firm&rsquo;s Google account. One consent covers both: appointments
              and holds are written to Google Calendar, and email categories set to
              <em> Gmail</em> send from this mailbox. Without it, calendar features are
              unavailable and email falls back to Resend.
            </p>
          </div>
          {!google ? (
            <p className="text-sm text-muted-foreground">Loading&hellip;</p>
          ) : !google.envConfigured ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              Google is not configured.
              {google.configIssue ? ` ${google.configIssue}` : ''} Set
              GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET and
              GOOGLE_CALENDAR_REDIRECT_URI (pointing at /api/admin/google/callback), then
              redeploy so the new values are visible.
            </p>
          ) : google.connected ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  Connected as{' '}
                  <span className="font-medium">{google.email || 'Google account'}</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    if (!token) return
                    void (async () => {
                      setSaving(true)
                      try {
                        const res = await fetch('/api/admin/google/status', {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` },
                        })
                        if (!res.ok) throw new Error('Disconnect failed')
                        setGoogle((g) => (g ? { ...g, connected: false, email: null } : g))
                        toast.success('Google disconnected')
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Disconnect failed')
                      } finally {
                        setSaving(false)
                      }
                    })()
                  }}
                >
                  Disconnect
                </Button>
              </div>
              {!google.canRefresh && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  This connection has no refresh token, so it will stop working within the hour.
                  Remove Cornerstone at myaccount.google.com/permissions and connect again.
                </p>
              )}
              {/* A connection made before Gmail was wired in has the calendar
                  scope and not the mail one, and nothing about it looks wrong
                  until a client email fails. */}
              {!google.hasGmailSendScope && (
                <p className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
                  This connection cannot send mail — it predates Gmail sending. Reconnect to
                  grant the send permission; email stays on Resend until you do.
                </p>
              )}
              {/* Triage reads the mailbox, which sending never did. Without the
                  scope the queue is simply empty, which reads as "no email
                  needs a reply" rather than as a missing permission. */}
              {!google.hasGmailModifyScope && (
                <p className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
                  This connection cannot read the mailbox, so{' '}
                  <Link href="/admin/email-triage" className="font-medium underline underline-offset-2">
                    email triage
                  </Link>{' '}
                  stays empty. Reconnect to grant the read permission.
                </p>
              )}
            </div>
          ) : (
            <Button size="sm" asChild>
              <a href="/api/admin/google/connect">Connect Google</a>
            </Button>
          )}

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            New appointments and holds go to{' '}
            <span className="font-medium">
              {google?.connected ? 'Google Calendar' : 'no calendar — nothing is connected'}
            </span>
            .
          </p>
        </section>
      )}

      {tab === 'outlook' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">Outlook (legacy)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The firm no longer runs on Microsoft 365, and nothing new is written here.
              This connection stays only so appointments booked before the switchover can
              still be cancelled and moved in the calendar that actually holds them.
              Disconnecting leaves those events in place — they would then have to be
              cancelled in Outlook by hand.
            </p>
          </div>
          {!outlook ? (
            <p className="text-sm text-muted-foreground">Loading&hellip;</p>
          ) : outlook.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Connected as <span className="font-medium">{outlook.email || 'Outlook'}</span>
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (!token) return
                  void (async () => {
                    setSaving(true)
                    try {
                      const res = await fetch('/api/admin/microsoft/status', {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                      })
                      if (!res.ok) throw new Error('Disconnect failed')
                      setOutlook((o) => (o ? { ...o, connected: false, email: null } : o))
                      setTab('google')
                      toast.success('Outlook disconnected')
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Disconnect failed')
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              No Outlook connection is stored. Cornerstone cannot reconnect one — the
              firm&rsquo;s calendar and mailbox are Google.
            </p>
          )}
        </section>
      )}

      {tab === 'email' && <EmailSettingsSection />}

      {tab === 'scheduling' && (
        <div className="space-y-6">
          <SchedulingSettingsSection />
          <CalendlyLinksSection />
        </div>
      )}

      {tab === 'templates' && isAdministrator && <TemplateCenter currentUserId={currentUserId} />}

      {tab === 'ai-usage' && <AiUsagePanel />}

      {tab === 'sla' && <PipelineSlaSettings />}
    </div>
  )
}
