'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { contactPickerKeyAction } from '@/lib/contactPickerKeyboard'
import { usePhoneDirectory, type DirectoryEntry } from '@/components/softphone/usePhoneDirectory'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { railRecordForPath } from './RailActivityPane'

/** Who the pane is addressed to, and which route sends it. */
interface SmsRecipient {
  kind: 'matter' | 'lead' | 'contact'
  id: string
  name: string
  detail: string | null
  digits: string | null
}

function formatDigits(digits: string | null): string | null {
  if (!digits || digits.length !== 10) return digits
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * A directory entry names a person; the record it belongs to decides the send
 * route. Matters win over leads over contacts, matching how comms thread.
 */
function recipientFromEntry(entry: DirectoryEntry): SmsRecipient | null {
  const base = { name: entry.name, detail: entry.detail, digits: entry.digits }
  if (entry.matterId) return { kind: 'matter', id: entry.matterId, ...base }
  if (entry.leadId) return { kind: 'lead', id: entry.leadId, ...base }
  if (entry.contactId) return { kind: 'contact', id: entry.contactId, ...base }
  return null
}

const RECORD_HREF: Record<SmsRecipient['kind'], (id: string) => string> = {
  matter: id => `/admin/matters/${id}?tab=communications&channel=sms`,
  lead: id => `/admin/leads/${id}?tab=communications`,
  contact: id => `/admin/contacts?selected=contact:${id}`,
}

interface RailSmsPaneProps {
  /** False when no SMS provider is configured; the composer explains instead. */
  smsConfigured: boolean
}

/**
 * Send a text from anywhere in the admin, with AI drafting — the rail twin of
 * the email pane. Defaults to whoever the current page is about, and searches
 * the whole firm directory otherwise, so fiduciaries and referrers are one
 * lookup away rather than requiring a trip to their record.
 */
export function RailSmsPane({ smsConfigured }: RailSmsPaneProps) {
  const pathname = usePathname()
  const token = useAccessToken()
  const record = railRecordForPath(pathname ?? '')
  const { entries } = usePhoneDirectory()

  const [manual, setManual] = useState<SmsRecipient | null>(null)
  const [search, setSearch] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  // The page's own record, resolved to a name once the directory loads.
  const pageRecipient = useMemo<SmsRecipient | null>(() => {
    if (!record) return null
    const match = entries.find(entry =>
      (record.type === 'matter' && entry.matterId === record.id) ||
      (record.type === 'lead' && entry.leadId === record.id),
    )
    return {
      kind: record.type,
      id: record.id,
      name: match?.name ?? 'This record',
      detail: match?.detail ?? null,
      digits: match?.digits ?? null,
    }
  }, [record, entries])

  // Navigating to another record retargets the pane, unless one was picked.
  const recordKey = record ? `${record.type}:${record.id}` : ''
  useEffect(() => { setManual(null) }, [recordKey])

  const recipient = manual ?? pageRecipient
  const maxChars = recipient?.kind === 'matter' ? MAX_SMS_BODY_LENGTH : MAX_LEAD_SMS_BODY_LENGTH

  const results = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query.length < 2) return []
    const queryDigits = query.replace(/\D/g, '')
    return entries
      .filter(entry =>
        entry.name.toLowerCase().includes(query) ||
        (entry.detail?.toLowerCase().includes(query) ?? false) ||
        (queryDigits.length >= 3 && entry.digits.includes(queryDigits)),
      )
      .slice(0, 6)
  }, [entries, search])

  useEffect(() => { setSearchIndex(0) }, [search])

  const choose = useCallback((entry: DirectoryEntry) => {
    const next = recipientFromEntry(entry)
    if (!next) {
      toast.error(`${entry.name} isn’t linked to a record we can text from yet.`)
      return
    }
    setManual(next)
    setSearch('')
  }, [])

  const send = useCallback(async () => {
    if (!token || !recipient || !body.trim()) return
    setSending(true)
    try {
      const segment = recipient.kind === 'matter' ? 'matters' : recipient.kind === 'lead' ? 'leads' : 'contacts'
      const payload = recipient.kind === 'matter'
        ? { recipient: 'client', body: body.trim() }
        : { body: body.trim() }
      const response = await fetch(`/api/admin/${segment}/${recipient.id}/send-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not send text')
      toast.success(`Text sent to ${recipient.name}`)
      setBody('')
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not send text')
    } finally {
      setSending(false)
    }
  }, [token, recipient, body])

  const overLimit = body.length > maxChars
  const ready = smsConfigured && Boolean(recipient) && Boolean(body.trim()) && !overLimit && !sending

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* ── recipient ─────────────────────────────────────────────── */}
        {recipient ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{recipient.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {[formatDigits(recipient.digits), recipient.detail].filter(Boolean).join(' · ') || 'No number on file'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild type="button" size="sm" variant="ghost" className="h-7 px-2" title="Open the full thread">
                <Link href={RECORD_HREF[recipient.kind](recipient.id)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              {manual && (
                <Button
                  type="button" size="sm" variant="ghost" className="h-7 px-2"
                  aria-label="Clear recipient"
                  onClick={() => setManual(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Search for whoever you want to text — clients, leads, and everyone in the contact book.
          </p>
        )}

        {/* ── directory search ──────────────────────────────────────── */}
        <div className="relative">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              const action = contactPickerKeyAction(event.key, searchIndex, results.length, true)
              if (action.preventDefault) event.preventDefault()
              setSearchIndex(action.activeIndex)
              if (action.selectIndex !== null && results[action.selectIndex]) {
                choose(results[action.selectIndex])
              }
              if (!action.open) setSearch('')
            }}
            placeholder="Search people…"
            aria-label="Search people to text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="rail-sms-results"
            className="h-8 w-full rounded-[10px] border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>

        {results.length > 0 && (
          <div
            id="rail-sms-results"
            role="listbox"
            aria-label="People"
            className="overflow-hidden rounded-[10px] border border-border"
          >
            {results.map((entry, index) => (
              <button
                key={`${entry.digits}-${entry.name}`}
                type="button"
                role="option"
                aria-selected={index === searchIndex}
                onMouseEnter={() => setSearchIndex(index)}
                onClick={() => choose(entry)}
                className={cn(
                  'block w-full px-2.5 py-2 text-left',
                  index === searchIndex ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="block truncate text-xs font-medium">{entry.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {entry.detail ?? formatDigits(entry.digits)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── composer ──────────────────────────────────────────────── */}
        {smsConfigured ? (
          <div className="space-y-1.5">
            <Textarea
              className="min-h-32 text-sm"
              maxLength={maxChars}
              disabled={!recipient}
              placeholder={
                recipient
                  ? `Write to ${recipient.name.split(' ')[0]}, or let AI draft it…`
                  : 'Pick someone to text first'
              }
              value={body}
              onChange={event => setBody(event.target.value.slice(0, maxChars))}
              aria-label="Text message"
            />
            <div className="flex items-center justify-between gap-2">
              <span className={cn('text-[11px]', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
                {body.length}/{maxChars}
              </span>
              {recipient && (
                <DraftWithAiButton
                  apiPath={`/api/admin/${recipient.kind === 'matter' ? 'matters' : recipient.kind === 'lead' ? 'leads' : 'contacts'}/${recipient.id}/draft-reply`}
                  channel="sms"
                  notes={body}
                  maxChars={maxChars}
                  onDraft={next => setBody(next.slice(0, maxChars))}
                />
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            Texting is not configured yet. Add the SMS provider credentials to send from here.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <Button type="button" className="w-full" disabled={!ready} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send text'}
        </Button>
      </div>
    </div>
  )
}
