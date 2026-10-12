'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { useConfirm } from '@/components/useConfirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatFirmDate } from '@/lib/format'
import { cn } from '@/lib/utils'

type IgnoreRuleKind = 'domain' | 'address'

interface IgnoreRule {
  id: string
  kind: IgnoreRuleKind
  value: string
  note: string | null
  createdAt: string
}

/**
 * Review and undo Mail Desk "never this sender / domain" rules (and add new
 * ones by hand). Rows live in `email_triage_ignore_rules`.
 */
export function MailDeskIgnoreRulesSection() {
  const token = useAccessToken()
  const { confirm, confirmDialog } = useConfirm()
  const [rules, setRules] = useState<IgnoreRule[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<IgnoreRuleKind>('domain')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const authHeaders = useCallback((json = false): HeadersInit | undefined => {
    if (!token) return undefined
    return {
      Authorization: `Bearer ${token}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }, [token])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/mail-desk/ignore-rules', {
        cache: 'no-store',
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({})) as { rules?: IgnoreRule[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? `Failed to load: ${res.status}`)
      setRules(Array.isArray(json.rules) ? json.rules : [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load ignored senders')
    } finally {
      setLoading(false)
    }
  }, [token, authHeaders])

  useEffect(() => { void load() }, [load])

  async function addRule(event: FormEvent) {
    event.preventDefault()
    if (!token || !value.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/admin/settings/mail-desk/ignore-rules', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          kind,
          value: value.trim(),
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({})) as { rule?: IgnoreRule; error?: string }
      if (!res.ok) throw new Error(json.error ?? `Could not add: ${res.status}`)
      setValue('')
      setNote('')
      toast.success(kind === 'domain' ? 'Domain ignored' : 'Sender ignored')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add ignore rule')
    } finally {
      setAdding(false)
    }
  }

  async function removeRule(rule: IgnoreRule) {
    const label = rule.kind === 'domain' ? `domain ${rule.value}` : rule.value
    const confirmed = await confirm({
      title: 'Stop ignoring this?',
      body: `Mail from ${label} can show up in Mail Desk again on the next scan.`,
      confirmLabel: 'Remove ignore',
      destructive: true,
    })
    if (!confirmed) return

    setRemovingId(rule.id)
    try {
      const res = await fetch(`/api/admin/settings/mail-desk/ignore-rules/${rule.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `Could not remove: ${res.status}`)
      setRules(prev => (prev ?? []).filter(r => r.id !== rule.id))
      toast.success('Ignore removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove ignore rule')
    } finally {
      setRemovingId(null)
    }
  }

  if (!token || loading || !rules) {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {!token ? 'Signing in…' : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading ignored senders…
          </span>
        )}
      </div>
    )
  }

  const domains = rules.filter(r => r.kind === 'domain')
  const addresses = rules.filter(r => r.kind === 'address')

  return (
    <div className="mb-6 rounded-lg border border-border p-6">
      {confirmDialog}
      <div className="mb-4 pb-3 border-b border-border">
        <h2 className="text-micro font-semibold uppercase tracking-wide text-foreground">
          Ignored senders &amp; domains
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Mail Desk skips these on every scan — from “Never this sender / domain” in the queue,
          seeds, or entries you add here. Remove a row to undo an accidental ignore.
        </p>
      </div>

      <form onSubmit={e => void addRule(e)} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-micro text-muted-foreground">
          Type
          <select
            value={kind}
            onChange={e => setKind(e.target.value === 'address' ? 'address' : 'domain')}
            className="h-9 rounded-md border border-border bg-card px-2 text-xs text-foreground"
            aria-label="Ignore rule type"
          >
            <option value="domain">Domain</option>
            <option value="address">Sender</option>
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-micro text-muted-foreground">
          {kind === 'domain' ? 'Domain' : 'Email'}
          <Input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={kind === 'domain' ? 'vendor.com' : 'name@vendor.com'}
            className="h-9 text-xs"
            autoComplete="off"
            required
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-micro text-muted-foreground">
          Note (optional)
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why this is ignored"
            className="h-9 text-xs"
            autoComplete="off"
          />
        </label>
        <Button type="submit" size="sm" disabled={adding || !value.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </Button>
      </form>

      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ignored senders or domains yet.</p>
      ) : (
        <div className="space-y-4">
          <RuleGroup
            title="Domains"
            empty="No domains ignored."
            rules={domains}
            removingId={removingId}
            onRemove={removeRule}
          />
          <RuleGroup
            title="Senders"
            empty="No individual senders ignored."
            rules={addresses}
            removingId={removingId}
            onRemove={removeRule}
          />
        </div>
      )}
    </div>
  )
}

function RuleGroup({
  title,
  empty,
  rules,
  removingId,
  onRemove,
}: {
  title: string
  empty: string
  rules: IgnoreRule[]
  removingId: string | null
  onRemove: (rule: IgnoreRule) => void
}) {
  return (
    <div>
      <h3 className="mb-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="ml-1.5 normal-case tracking-normal">({rules.length})</span>
      </h3>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rules.map(rule => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-2 bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{rule.value}</p>
                <p className="mt-0.5 text-micro text-muted-foreground">
                  {rule.note ? `${rule.note} · ` : ''}
                  added {formatFirmDate(rule.createdAt)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={removingId === rule.id}
                aria-label={`Remove ignore for ${rule.value}`}
                onClick={() => void onRemove(rule)}
                className={cn('shrink-0 text-muted-foreground hover:text-destructive')}
              >
                {removingId === rule.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
                <span className="ml-1.5">Remove</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
