'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  FileText,
  Info,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { supabase } from '@/lib/supabaseClient'

/**
 * Read-only activity feed for whichever record the admin is looking at.
 * Reuses the rows the matter/lead detail pages already render — the rail never
 * writes activity, so there is no new API surface here.
 */

export type RailRecord = { type: 'matter'; id: string } | { type: 'lead'; id: string }

interface RailActivityRow {
  id: string
  eventType: string
  title: string
  detail: string | null
  actorName: string | null
  createdAt: string
}

const ROW_LIMIT = 50

const EVENT_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  stage_changed: { icon: Activity, tone: 'text-accent bg-accent/10' },
  intake_sent: { icon: Send, tone: 'text-accent bg-accent/10' },
  intake_completed: { icon: CheckCircle2, tone: 'text-success bg-success/10' },
  email_sent: { icon: Send, tone: 'text-muted-foreground bg-muted' },
  sms_sent: { icon: Send, tone: 'text-muted-foreground bg-muted' },
  draft_generated: { icon: FileText, tone: 'text-accent bg-accent/10' },
  draft_promoted_to_review: { icon: CheckCircle2, tone: 'text-success bg-success/10' },
  note: { icon: Info, tone: 'text-muted-foreground bg-muted' },
}

const FALLBACK_ICON = { icon: Info, tone: 'text-muted-foreground bg-muted' }

/**
 * The rail's record scope is intentionally separate from `useChatContext`:
 * the assistant only understands matter/general, but activity also exists for
 * leads, and widening the chat context would change what the chat API is sent.
 */
export function railRecordForPath(pathname: string): RailRecord | null {
  const matter = pathname.match(/^\/admin\/(?:matters|drafting)\/([a-zA-Z0-9-]+)/)
  if (matter && matter[1] !== 'new') return { type: 'matter', id: matter[1] }

  const lead = pathname.match(/^\/admin\/leads\/([a-zA-Z0-9-]+)/)
  if (lead && lead[1] !== 'new') return { type: 'lead', id: lead[1] }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toRow(raw: unknown): RailActivityRow | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    eventType: typeof raw.event_type === 'string' ? raw.event_type : 'note',
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Activity',
    detail: typeof raw.detail === 'string' && raw.detail.trim() ? raw.detail : null,
    actorName: typeof raw.actor_name === 'string' && raw.actor_name.trim() ? raw.actor_name : null,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
  }
}

export function RailActivityPane() {
  const pathname = usePathname()
  const record = railRecordForPath(pathname)
  const token = useAccessToken()
  const [rows, setRows] = useState<RailActivityRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recordType = record?.type ?? null
  const recordId = record?.id ?? null

  useEffect(() => {
    if (!recordType || !recordId) {
      setRows([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        let raw: unknown[] = []
        if (recordType === 'matter') {
          const { data, error: queryError } = await supabase
            .from('matter_activity')
            .select('id, event_type, title, detail, actor_name, created_at')
            .eq('matter_id', recordId)
            .order('created_at', { ascending: false })
            .limit(ROW_LIMIT)
          if (queryError) throw new Error(queryError.message)
          raw = data ?? []
        } else {
          const res = await fetch(`/api/admin/leads/${recordId}/activity`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          })
          const body = await res.json().catch(() => ({})) as { activity?: unknown[]; error?: string }
          if (!res.ok) throw new Error(body.error ?? 'Could not load activity')
          raw = Array.isArray(body.activity) ? body.activity.slice(0, ROW_LIMIT) : []
        }
        if (cancelled) return
        setRows(raw.map(toRow).filter((row): row is RailActivityRow => row !== null))
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message || 'Could not load activity')
        setRows([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [recordType, recordId, token])

  if (!record) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Open a lead or matter to see its activity here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {record.type === 'matter' ? 'Matter activity' : 'Lead activity'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        ) : error ? (
          <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">No activity yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Stage changes, intake, comms, and drafting events appear here.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {rows.map(row => {
              const meta = EVENT_ICONS[row.eventType] ?? FALLBACK_ICON
              const EventIcon = meta.icon
              return (
                <li key={row.id} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', meta.tone)}
                  >
                    <EventIcon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-snug">{row.title}</p>
                    {row.detail && (
                      <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{row.detail}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                      {row.actorName ? ` · ${row.actorName}` : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
