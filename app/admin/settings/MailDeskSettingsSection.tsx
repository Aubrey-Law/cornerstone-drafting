'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { cn } from '@/lib/utils'

interface MailDeskSettings {
  emailTriageEnabled: boolean
  archiveNonClient: boolean
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-success' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function MailDeskSettingsSection() {
  const token = useAccessToken()
  const [data, setData] = useState<MailDeskSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<'enabled' | 'archive' | null>(null)

  const authHeaders = useCallback((): HeadersInit | undefined => {
    if (!token) return undefined
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/mail-desk', {
        cache: 'no-store',
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({})) as MailDeskSettings & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `Failed to load: ${res.status}`)
      setData({
        emailTriageEnabled: Boolean(json.emailTriageEnabled),
        archiveNonClient: json.archiveNonClient !== false,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load Mail Desk settings')
    } finally {
      setLoading(false)
    }
  }, [token, authHeaders])

  useEffect(() => { void load() }, [load])

  async function save(patch: Partial<MailDeskSettings>, which: 'enabled' | 'archive') {
    if (!data) return
    const previous = data
    setData({ ...data, ...patch })
    setPending(which)
    try {
      const body: Record<string, boolean> = {}
      if (typeof patch.emailTriageEnabled === 'boolean') {
        body.emailTriageEnabled = patch.emailTriageEnabled
      }
      if (typeof patch.archiveNonClient === 'boolean') {
        body.archiveNonClient = patch.archiveNonClient
      }
      const res = await fetch('/api/admin/settings/mail-desk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as MailDeskSettings & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `Save failed: ${res.status}`)
      setData({
        emailTriageEnabled: Boolean(json.emailTriageEnabled),
        archiveNonClient: json.archiveNonClient !== false,
      })
      toast.success('Mail Desk settings saved')
    } catch (err) {
      setData(previous)
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setPending(null)
    }
  }

  if (!token || loading || !data) {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {!token ? 'Signing in…' : 'Loading Mail Desk settings…'}
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-border p-6">
      <div className="mb-4 pb-3 border-b border-border">
        <h2 className="text-micro font-semibold uppercase tracking-wide text-foreground">
          Mail Desk
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Matter-aware triage on top of Gmail. Client and lead mail that still needs a reply stays
          in the Inbox; noise, ignored senders, internal mail, and handled threads get a{' '}
          <span className="font-medium">Cornerstone/…</span> label
          {data.archiveNonClient ? ' and leave the Inbox' : ' (Inbox left alone while archive is off)'}.
          Soft-automated mail is labelled Noise only until you trust the classifier.{' '}
          <Link href="/admin/email-triage" className="font-medium underline underline-offset-2">
            Open Mail Desk
          </Link>
          .
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-foreground">Scan the mailbox</p>
            <p className="mt-0.5 text-micro text-muted-foreground leading-snug">
              When on, cron and Refresh classify new mail into the Mail Desk queue.
            </p>
          </div>
          <Toggle
            checked={data.emailTriageEnabled}
            disabled={pending !== null}
            label="Toggle Mail Desk scanning"
            onChange={next => void save({ emailTriageEnabled: next }, 'enabled')}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-foreground">Archive non-client mail from Inbox</p>
            <p className="mt-0.5 text-micro text-muted-foreground leading-snug">
              When on (default), noise, ignored, handled, and internal threads leave the Gmail Inbox
              after labelling. Turn off for a label-only rollout.
            </p>
          </div>
          <Toggle
            checked={data.archiveNonClient}
            disabled={pending !== null || !data.emailTriageEnabled}
            label="Toggle archive non-client mail"
            onChange={next => void save({ archiveNonClient: next }, 'archive')}
          />
        </div>
      </div>
    </div>
  )
}
