'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { useConfirm } from '@/components/useConfirm'
import { AiUsagePanel } from './AiUsagePanel'
import { EmailSettingsSection } from './EmailSettingsSection'
import { MailDeskSettingsSection } from './MailDeskSettingsSection'
import { MailDeskIgnoreRulesSection } from './MailDeskIgnoreRulesSection'
import { SchedulingSettingsSection } from './SchedulingSettingsSection'
import { CalendlyLinksSection } from './CalendlyLinksSection'
import { LawmaticsSettingsSection } from './LawmaticsSettingsSection'
import { StatularSettingsSection } from './StatularSettingsSection'
import { MicrosoftTeamsSection } from './MicrosoftTeamsSection'
import { PipelineSlaSettings } from './PipelineSlaSettings'
import { DelegationSettingsSection } from './DelegationSettingsSection'
import { AnnualReviewSettingsSection } from './AnnualReviewSettingsSection'
import { FileClosingSettingsSection } from './FileClosingSettingsSection'
import { ProbateDeadlinesSettingsSection } from './ProbateDeadlinesSettingsSection'
import { resolveSettingsTab, settingsTabHref, settingsTabItem, type SettingsTab } from './settingsNav'

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
  isAdministrator = false,
}: {
  isAdministrator?: boolean
}) {
  const token = useAccessToken()
  const router = useRouter()
  const searchParams = useSearchParams()
  // The side menu (SettingsNav) links to `?tab=…`, so the URL is the only tab state.
  const tab = resolveSettingsTab(searchParams.get('tab'), isAdministrator)
  const setTab = (next: SettingsTab) => router.push(settingsTabHref(next))
  const tabItem = settingsTabItem(tab)
  const [prefs, setPrefs] = useState<UserPreferences>({})
  const [keys, setKeys] = useState<ApiKeyStatus[]>([])
  const [connectors, setConnectors] = useState<ConnectorRow[]>([])
  const [saving, setSaving] = useState(false)
  const { confirm, confirmDialog } = useConfirm()
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [focusKeyProvider, setFocusKeyProvider] = useState<string | null>(null)
  useEffect(() => {
    if (tab !== 'api-keys' || !focusKeyProvider) return
    document.getElementById(`api-key-${focusKeyProvider}`)?.focus()
    setFocusKeyProvider(null)
  }, [tab, focusKeyProvider])
  const [newConnector, setNewConnector] = useState({
    name: '',
    serverUrl: '',
    authSecret: '',
  })
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(null)
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
  }, [])

  useEffect(() => {
    if (!token) return
    void (async () => {
      const [pRes, kRes, cRes, gRes] = await Promise.all([
        fetch('/api/admin/me/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/api-keys', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/connectors', { headers: { Authorization: `Bearer ${token}` } }),
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
    const confirmed = await confirm({
      title: `Remove your personal ${provider} key?`,
      body: 'Requests fall back to the shared environment key if one is set, and stop working if it is not.',
      confirmLabel: 'Remove key',
      destructive: true,
    })
    if (!confirmed) return
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

  /**
   * Asks before disconnecting: reconnecting means going back out to Google's
   * consent screen, so this is not the one-click toggle the button looks like.
   */
  const disconnectMailbox = async () => {
    if (!token) return
    const confirmed = await confirm({
      title: 'Disconnect Google?',
      body: 'Mail and calendar sync stop, and reconnecting means signing in to Google again.',
      confirmLabel: 'Disconnect Google',
      destructive: true,
    })
    if (!confirmed) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/google/status', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Disconnect failed')
      setGoogle(g => (g ? { ...g, connected: false, email: null } : g))
      toast.success('Google disconnected')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disconnect failed')
    } finally {
      setSaving(false)
    }
  }

  const removeConnector = async (id: string) => {
    if (!token) return
    const confirmed = await confirm({
      title: 'Remove this connector?',
      body: 'Anything relying on it stops working until it is set up again.',
      confirmLabel: 'Remove connector',
      destructive: true,
    })
    if (!confirmed) return
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
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title={tabItem?.label ?? 'Settings'} description={tabItem?.description} />

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
                      API key configured for {LLM_PROVIDER_LABELS[activeLlm.provider]}
                      {key?.source === 'user' && key.hint ? ` (${key.hint})` : ''}
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
                    {key?.configured ? (
                      <span className="text-micro text-muted-foreground">Key configured</span>
                    ) : (
                      <button
                        type="button"
                        className="text-micro text-primary underline hover:no-underline"
                        onClick={() => {
                          setFocusKeyProvider(provider)
                          setTab('api-keys')
                        }}
                      >
                        Key missing
                      </button>
                    )}
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
            Keys are stored encrypted and never shown again after you save them. Your own key is used
            first; without one, requests use the firm&rsquo;s key.
          </p>
          {keys.map(k => (
            <div key={k.provider} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{LLM_PROVIDER_LABELS[k.provider as LlmProvider] ?? k.provider}</p>
                  <p className="text-micro text-muted-foreground">
                    {k.configured
                      ? k.source === 'env'
                        ? 'Configured from the server environment'
                        : `Configured (${k.source}${k.hint ? ` · ${k.hint}` : ''})`
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
                  id={`api-key-${k.provider}`}
                  type="password"
                  placeholder={`Paste your ${LLM_PROVIDER_LABELS[k.provider as LlmProvider] ?? k.provider} API key`}
                  aria-label={`${LLM_PROVIDER_LABELS[k.provider as LlmProvider] ?? k.provider} API key`}
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
            Add an MCP server by URL (and a bearer token if it needs one). <strong>Test</strong>{' '}checks
            that it connects and lists its tools; enabled connectors&rsquo; tools are offered to the
            drafting assistant automatically.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="conn-name">Name</Label>
              <Input
                id="conn-name"
                value={newConnector.name}
                onChange={e => setNewConnector(p => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conn-url">Server URL</Label>
              <Input
                id="conn-url"
                placeholder="https://…"
                value={newConnector.serverUrl}
                onChange={e => setNewConnector(p => ({ ...p, serverUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
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
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              {/* Say what it means first; the variable names are for whoever deploys. */}
              <p className="text-sm font-medium text-foreground">Google isn&rsquo;t set up on this server yet</p>
              <p className="mt-1">Calendar features stay off and email sends through Resend until it is.</p>
              <p className="mt-2">
                Setup{google.configIssue ? ` (${google.configIssue})` : ''}: set GOOGLE_CALENDAR_CLIENT_ID,
                GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REDIRECT_URI (pointing at
                /api/admin/google/callback), then redeploy.
              </p>
            </div>
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
                  onClick={() => void disconnectMailbox()}
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
                    Mail Desk
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

      {tab === 'google' && <MicrosoftTeamsSection />}

      {tab === 'email' && (
        <>
          <MailDeskSettingsSection />
          <MailDeskIgnoreRulesSection />
          <EmailSettingsSection />
        </>
      )}

      {tab === 'scheduling' && (
        <div className="space-y-6">
          <SchedulingSettingsSection />
          <CalendlyLinksSection />
        </div>
      )}

      {tab === 'lawmatics' && <LawmaticsSettingsSection />}

      {tab === 'statular' && <StatularSettingsSection />}

      {tab === 'ai-usage' && <AiUsagePanel />}

      {tab === 'sla' && <PipelineSlaSettings />}

      {tab === 'delegation' && <DelegationSettingsSection isAdministrator={isAdministrator} />}

      {tab === 'annual-review' && <AnnualReviewSettingsSection isAdministrator={isAdministrator} />}
      {tab === 'file-closing' && <FileClosingSettingsSection isAdministrator={isAdministrator} />}
      {tab === 'probate-deadlines' && <ProbateDeadlinesSettingsSection isAdministrator={isAdministrator} />}
      {confirmDialog}
    </div>
  )
}
