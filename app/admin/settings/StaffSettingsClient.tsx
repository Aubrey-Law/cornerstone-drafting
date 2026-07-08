'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  ANTHROPIC_MODEL_OPTIONS,
  DEFAULT_ANTHROPIC_MODEL,
  type UserPreferences,
} from '@/lib/userPreferences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Tab = 'models' | 'api-keys' | 'connectors'

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

export function StaffSettingsClient({ initialTab = 'models' }: { initialTab?: Tab }) {
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

  useEffect(() => {
    if (!token) return
    void (async () => {
      const [pRes, kRes, cRes] = await Promise.all([
        fetch('/api/admin/me/preferences', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/api-keys', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/me/connectors', { headers: { Authorization: `Bearer ${token}` } }),
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
    })()
  }, [token])

  const saveModel = async (modelId: string) => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/me/preferences', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences: { models: { anthropicModel: modelId } } }),
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

  const selectedModel = prefs.models?.anthropicModel || DEFAULT_ANTHROPIC_MODEL

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Model preferences, bring-your-own API keys, and MCP connectors for drafting tools.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ['models', 'Models'],
            ['api-keys', 'API Keys'],
            ['connectors', 'Connectors'],
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
      </div>

      {tab === 'models' && (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="anthropic-model">Preferred Anthropic model</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Used by the matter assistant, AI redline, design-sheet import, and tabular review.
            </p>
            <select
              id="anthropic-model"
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedModel}
              disabled={saving}
              onChange={e => void saveModel(e.target.value)}
            >
              {ANTHROPIC_MODEL_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
              {!ANTHROPIC_MODEL_OPTIONS.some(o => o.id === selectedModel) ? (
                <option value={selectedModel}>{selectedModel}</option>
              ) : null}
            </select>
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
                  <p className="text-[11px] text-muted-foreground">
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
                    <p className="truncate text-[11px] text-muted-foreground">
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
    </div>
  )
}
