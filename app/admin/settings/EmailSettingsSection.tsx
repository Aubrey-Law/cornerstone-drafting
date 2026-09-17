'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { EmailMode, EmailProvider, EmailCategoryMeta } from '@/lib/email/categories'

interface CategoryRow extends EmailCategoryMeta {
  mode: EmailMode
  provider: EmailProvider
  updatedAt: string | null
  updatedBy: string | null
  lastSentAt: string | null
  lastSendStatus: string | null
}

interface SettingsResponse {
  categories: CategoryRow[]
  envHardKilled: boolean
  testInbox: string
  allowlist: string[]
  emailLogoHeader: boolean
  gmail: {
    available: boolean
    accountEmail: string | null
    missingScope: boolean
  }
  migrationRequired?: boolean
}

const MODE_LABELS: Record<EmailMode, string> = {
  on: 'On',
  off: 'Off',
  redirect: 'Redirect to test inbox',
}

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  resend: 'Resend',
  gmail: 'Gmail',
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type ConfirmOnTarget =
  | { type: 'single'; category: string; label: string }
  | { type: 'bulk'; count: number }
  | null

export function EmailSettingsSection() {
  const token = useAccessToken()
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingCats, setPendingCats] = useState<ReadonlySet<string>>(new Set())
  const [confirmOn, setConfirmOn] = useState<ConfirmOnTarget>(null)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  // Bumped by every load() and every optimistic mutation so a stale in-flight
  // GET can never overwrite newer local state.
  const loadSeqRef = useRef(0)

  function setCatPending(category: string, pending: boolean) {
    setPendingCats(prev => {
      const next = new Set(prev)
      if (pending) next.add(category)
      else next.delete(category)
      return next
    })
  }

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const load = useCallback(async (initial = false) => {
    if (!token) return
    const seq = ++loadSeqRef.current
    if (initial) setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/email', {
        cache: 'no-store',
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? `Failed to load: ${res.status}`)
      }
      if (seq === loadSeqRef.current) setData(json as SettingsResponse)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      if (initial) setLoading(false)
    }
  }, [token, authHeaders])

  useEffect(() => { void load(true) }, [load])

  /** Optimistically apply a mode to local state; returns the previous mode for rollback. */
  function applyModeLocally(category: string, mode: EmailMode): EmailMode | null {
    let previous: EmailMode | null = null
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        categories: prev.categories.map(c => {
          if (c.category !== category) return c
          previous = c.mode
          return { ...c, mode }
        }),
      }
    })
    return previous
  }

  async function setMode(category: string, mode: EmailMode) {
    const previous = data?.categories.find(c => c.category === category)?.mode ?? null
    applyModeLocally(category, mode)
    loadSeqRef.current++ // invalidate any in-flight GET so it can't clobber this toggle
    setCatPending(category, true)
    try {
      const res = await fetch('/api/admin/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category, mode }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Save failed: ${res.status}`)
      }
      toast.success(`Saved: ${category} → ${MODE_LABELS[mode]}`)
      // Background refresh keeps updatedAt/lastSent in sync without blanking the UI.
      void load()
    } catch (err) {
      if (previous) {
        applyModeLocally(category, previous)
        loadSeqRef.current++
      }
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCatPending(category, false)
    }
  }

  /** Gate switching a category to live "on" behind an explicit confirmation. */
  function requestMode(category: CategoryRow, mode: EmailMode) {
    if (mode === 'on' && category.mode !== 'on') {
      setConfirmOn({ type: 'single', category: category.category, label: category.label })
      return
    }
    void setMode(category.category, mode)
  }

  async function setProvider(category: string, provider: EmailProvider) {
    setCatPending(category, true)
    try {
      const res = await fetch('/api/admin/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ category, provider }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Save failed: ${res.status}`)
      }
      toast.success(`Saved: ${category} → ${PROVIDER_LABELS[provider]}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setCatPending(category, false)
    }
  }

  const [logoPending, setLogoPending] = useState(false)

  async function setLogoHeader(enabled: boolean) {
    const previous = data?.emailLogoHeader ?? true
    setData(prev => (prev ? { ...prev, emailLogoHeader: enabled } : prev))
    loadSeqRef.current++
    setLogoPending(true)
    try {
      const res = await fetch('/api/admin/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ emailLogoHeader: enabled }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Save failed: ${res.status}`)
      }
      toast.success(`Logo header ${enabled ? 'enabled' : 'disabled'} for emails`)
    } catch (err) {
      setData(prev => (prev ? { ...prev, emailLogoHeader: previous } : prev))
      loadSeqRef.current++
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLogoPending(false)
    }
  }

  async function bulkSet(mode: EmailMode) {
    if (!data) return
    const targets = data.categories.filter(c => c.mode !== mode)
    if (targets.length === 0) {
      toast.success(`All categories are already ${MODE_LABELS[mode]}`)
      return
    }
    setBulkProgress({ done: 0, total: targets.length })
    let failed = 0
    try {
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i]
        const res = await fetch('/api/admin/settings/email', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ category: c.category, mode }),
        })
        if (res.ok) {
          applyModeLocally(c.category, mode)
        } else {
          failed++
        }
        setBulkProgress({ done: i + 1, total: targets.length })
      }
    } finally {
      setBulkProgress(null)
    }
    if (failed > 0) {
      toast.error(`${failed} of ${targets.length} categories failed to update`)
    } else {
      toast.success(`All categories set to ${MODE_LABELS[mode]}`)
    }
    await load()
  }

  /** Bulk "on" needs an explicit confirmation; off/redirect are safe to apply directly. */
  function requestBulkSet(mode: EmailMode) {
    if (!data) return
    if (mode === 'on') {
      const count = data.categories.filter(c => c.mode !== 'on').length
      if (count === 0) {
        toast.success('All categories are already on')
        return
      }
      setConfirmOn({ type: 'bulk', count })
      return
    }
    void bulkSet(mode)
  }

  function handleConfirmOn() {
    if (!confirmOn) return
    if (confirmOn.type === 'single') {
      void setMode(confirmOn.category, 'on')
    } else {
      void bulkSet('on')
    }
    setConfirmOn(null)
  }

  if (!token || loading || !data) {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {!token ? 'Signing in…' : 'Loading email settings…'}
      </div>
    )
  }

  const offCount = data.categories.filter(c => c.mode === 'off').length
  const redirectCount = data.categories.filter(c => c.mode === 'redirect').length

  return (
    <div className="p-6">
      <div className="mb-5 pb-3 border-b border-border">
        <div>
          <h2 className="text-micro font-semibold uppercase tracking-wide text-foreground">Email Sending</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Per-category control over outbound email. Sets to <strong>Off</strong> by default — turn each category on after you&apos;ve verified the flow.
          </p>
        </div>
      </div>

      {data.migrationRequired && (
        <div className="mb-4 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
          Email settings migration not applied yet. Run{' '}
          <code className="font-sans">npx supabase db push</code> and confirm{' '}
          <code className="font-sans">20260719000000_lite_email_settings.sql</code> to enable
          provider selection, templates, and the logo header toggle.
        </div>
      )}

      {data.envHardKilled && (
        <div className="mb-4 rounded-md border border-red-strong-border bg-red-bg px-3 py-2 text-xs text-red">
          <strong>EMAILS_ENABLED=false</strong> is set in the environment. All outbound email is suppressed regardless of the toggles below. Clear the env var to re-enable.
        </div>
      )}

      {data.allowlist.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
          Allowlist active (<code className="font-sans">EMAIL_ALLOWLIST</code>): only sends to <strong>{data.allowlist.join(', ')}</strong> will be delivered. Other recipients are suppressed even when a category is on.
        </div>
      )}

      <div className="mb-4 rounded-md border border-blue-strong-border bg-blue-bg px-3 py-2 text-xs text-blue">
        <strong>Redirect mode</strong> sends the email to the test inbox <code className="font-sans">{data.testInbox}</code> instead of the real recipient (override with <code className="font-sans">EMAIL_TEST_INBOX</code>). Subject is prefixed and a banner is added so you can&apos;t mistake a test for a real send.
      </div>

      <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
        <div>
          <p className="text-xs font-medium text-foreground">AUBREY LAW logo header</p>
          <p className="mt-0.5 text-micro text-muted-foreground leading-snug">
            Wraps Settings-template emails with the branded wordmark header &amp; footer. When off, those emails send as a plain body.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data.emailLogoHeader}
          aria-label="Toggle logo header on emails"
          disabled={logoPending}
          onClick={() => setLogoHeader(!data.emailLogoHeader)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
            data.emailLogoHeader ? 'bg-success' : 'bg-muted-foreground/30',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              data.emailLogoHeader ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {data.gmail.missingScope && (
        <div className="mb-4 rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
          <strong>Google account missing the Gmail send permission.</strong>{' '}
          Reconnect from <Link href="/admin/settings?tab=google" className="underline">Settings → Google</Link> to grant it.
        </div>
      )}
      {data.gmail.available && data.gmail.accountEmail && (
        <div className="mb-4 rounded-md border border-green/40 bg-green-bg px-3 py-2 text-xs text-green">
          <strong>Gmail connected:</strong> categories set to <em>Gmail</em> will send from <code className="font-sans">{data.gmail.accountEmail}</code> and land in that account&rsquo;s Sent Mail.
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => requestBulkSet('off')}
          disabled={bulkProgress !== null}
          className="rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          All off
        </button>
        <button
          onClick={() => requestBulkSet('redirect')}
          disabled={bulkProgress !== null}
          className="rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          All redirect
        </button>
        <button
          onClick={() => requestBulkSet('on')}
          disabled={bulkProgress !== null}
          className="rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          All on
        </button>
        {bulkProgress && (
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            Updating {bulkProgress.done} of {bulkProgress.total}…
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.categories.length - offCount - redirectCount} on · {redirectCount} redirect · {offCount} off
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-compact">
          <thead className="bg-muted text-micro uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Category</th>
              <th className="px-3 py-2 text-left font-medium">Recipient</th>
              <th className="px-3 py-2 text-left font-medium">Last activity</th>
              <th className="px-3 py-2 text-left font-medium">Provider</th>
              <th className="px-3 py-2 text-left font-medium">Mode</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c, i) => (
              <tr key={c.category} className={cn(i > 0 && 'border-t border-border')}>
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-foreground">{c.label}</div>
                  <div className="mt-0.5 text-micro text-muted-foreground leading-snug">{c.description}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-micro',
                    c.recipient === 'client' && 'bg-green-bg text-green',
                    c.recipient === 'internal' && 'bg-muted text-muted-foreground',
                  )}>
                    {c.recipient}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                  {c.lastSentAt
                    ? <>{formatTime(c.lastSentAt)} <span className="text-muted-foreground/70">({c.lastSendStatus})</span></>
                    : <span className="text-muted-foreground/60">never</span>}
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex gap-1" role="radiogroup" aria-label={`Provider for ${c.label}`}>
                    {(['resend','gmail'] as EmailProvider[]).map(p => {
                      const disabledByGmail = p === 'gmail' && !data.gmail.available
                      const disabled = pendingCats.has(c.category) || disabledByGmail
                      const tooltip = disabledByGmail
                        ? data.gmail.missingScope
                          ? 'Reconnect Google with the Gmail send permission to enable.'
                          : 'Connect the firm Google account in Settings → Google to enable.'
                        : undefined
                      return (
                        <button
                          key={p}
                          role="radio"
                          aria-checked={c.provider === p}
                          disabled={disabled}
                          onClick={() => setProvider(c.category, p)}
                          title={tooltip}
                          className={cn(
                            'rounded-[5px] border px-2 py-1 text-micro font-medium transition-colors',
                            c.provider === p
                              ? p === 'gmail' ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                              :                 'border-violet-300 bg-violet-50 text-violet-900'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent',
                            disabled && 'opacity-50',
                          )}
                        >
                          {PROVIDER_LABELS[p]}
                        </button>
                      )
                    })}
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex gap-1" role="group" aria-label={`Mode for ${c.label}`}>
                    {(['off','redirect','on'] as EmailMode[]).map(m => {
                      const disabled = pendingCats.has(c.category) || bulkProgress !== null
                      const tooltip = m === 'redirect' ? `Redirect to ${data.testInbox}` : undefined
                      return (
                        <button
                          key={m}
                          aria-label={`Set ${c.label} to ${MODE_LABELS[m]}`}
                          aria-pressed={c.mode === m}
                          disabled={disabled}
                          onClick={() => requestMode(c, m)}
                          title={tooltip}
                          className={cn(
                            'rounded-[5px] border px-2 py-1 text-micro font-medium transition-colors',
                            c.mode === m
                              ? m === 'on'       ? 'border-green/40 bg-green-bg text-green'
                              : m === 'redirect' ? 'border-blue-strong-border bg-blue-bg text-blue'
                              :                    'border-border bg-muted text-muted-foreground'
                              : 'border-border bg-card text-muted-foreground hover:bg-accent',
                            disabled && 'opacity-50',
                          )}
                        >
                          {MODE_LABELS[m]}
                        </button>
                      )
                    })}
                  </div>
                  {c.mode === 'redirect' && (
                    <div className="mt-1 text-micro text-blue">
                      Redirects to <code className="font-sans">{data.testInbox}</code>
                    </div>
                  )}
                  {c.updatedAt && (
                    <div className="mt-1 text-micro text-muted-foreground/70">
                      Updated {formatTime(c.updatedAt)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AlertDialog open={confirmOn !== null} onOpenChange={open => { if (!open) setConfirmOn(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOn?.type === 'bulk'
                ? `Enable live email for ${confirmOn.count} ${confirmOn.count === 1 ? 'category' : 'categories'}?`
                : `Enable live email for ${confirmOn?.label ?? 'this category'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmOn?.type === 'bulk'
                ? `This will turn on live sending for ${confirmOn.count} ${confirmOn.count === 1 ? 'category' : 'categories'} that ${confirmOn.count === 1 ? 'is' : 'are'} currently off or redirected. Real email will go to actual clients and staff. Make sure you have verified each template first — consider Redirect mode for a dry run.`
                : 'This will send real email to clients for this category. Make sure you have verified the template first — consider Redirect mode for a dry run.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOn}>
              {confirmOn?.type === 'bulk' ? 'Turn all on' : 'Turn on'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
