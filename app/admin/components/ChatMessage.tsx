'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ClipboardList, Copy, Eye, FilePenLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import type {
  DesignSheetImportPreviewRow,
  DesignSheetImportProposal,
} from '@/lib/designSheetImport/shared'

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolEvent {
  toolUseId: string
  tool: string
  status: ToolStatus
  filename?: string
  signedUrl?: string
  totalClaim?: number
  matterId?: string
  taskId?: string
  taskTitle?: string
  preview?: DesignSheetImportPreviewRow[]
  proposed?: DesignSheetImportProposal
  proposal?: Array<{
    id: string
    title: string
    rationale: string
    kind: 'create_hold' | 'propose_reschedule'
    payload: Record<string, unknown>
  }>
  error?: string
}

function CalendarProposalCard({ event }: { event: ToolEvent }) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [acting, setActing] = useState(false)
  const rows = event.proposal ?? []
  if (event.status === 'running') return <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">Preparing calendar proposal…</div>
  if (event.status === 'error') return <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Calendar proposal failed: {event.error ?? 'Unknown error'}</div>

  async function accept(row: typeof rows[number]) {
    setActing(true)
      try {
        const response = await fetch('/api/admin/calendar/proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: row.kind, payload: row.payload }),
        })
        if (response.ok) {
          await response.json().catch(() => ({}))
          setAccepted(current => new Set(current).add(row.id))
        }
      } finally {
        setActing(false)
      }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border bg-card text-xs text-foreground">
              {rows.map(row => (
                <div key={row.id} className="border-b border-border px-3 py-2 last:border-0">
                  <div className="font-semibold">{row.title}</div>
                  <div className="mt-0.5 text-muted-foreground">{row.rationale}</div>
                  <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={acting || accepted.has(row.id)}
                    onClick={() => void accept(row)}
                    className="rounded-md bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-60"
                  >
              {accepted.has(row.id) ? 'Accepted' : 'Accept'}
                    </button>
            <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted">Alternative</button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          disabled={acting || rows.every(row => accepted.has(row.id))}
          onClick={() => void Promise.all(rows.filter(row => !accepted.has(row.id)).map(accept))}
          className="font-semibold text-primary disabled:opacity-50"
        >
          Accept all {rows.length}
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('calendar:preview-proposals', { detail: rows }))}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" /> Preview on calendar
        </button>
      </div>
    </div>
  )
}

export interface FloatingChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  contextSnapshot?: { type: string; id?: string }
  toolEvents?: ToolEvent[]
}

interface ChatMessageProps {
  message: FloatingChatMessage
  onReviewDesignSheetImport?: (event: ToolEvent) => void
}

function DesignSheetImportToolEventCard({
  event,
  onReviewDesignSheetImport,
}: {
  event: ToolEvent
  onReviewDesignSheetImport?: (event: ToolEvent) => void
}) {
  if (event.status === 'running') {
    return (
      <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        Mapping design sheet updates…
      </div>
    )
  }

  if (event.status === 'error') {
    return (
      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Design sheet import failed: {event.error ?? 'Unknown error'}
      </div>
    )
  }

  const count = event.preview?.length ?? 0

  return (
    <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
      <div className="font-semibold text-foreground">Design sheet proposal ready</div>
      <div className="mt-0.5 text-muted-foreground">
        {count} proposed update{count === 1 ? '' : 's'}
      </div>
      <button
        type="button"
        onClick={() => onReviewDesignSheetImport?.(event)}
        disabled={!event.preview?.length || !event.proposed || !onReviewDesignSheetImport}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-semibold text-accent transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ClipboardList className="h-3.5 w-3.5" />
        Review proposed updates
      </button>
    </div>
  )
}

function ToolEventCard({
  event,
  onReviewDesignSheetImport,
}: {
  event: ToolEvent
  onReviewDesignSheetImport?: (event: ToolEvent) => void
}) {
  if (event.tool === 'propose_design_sheet_updates') {
    return (
      <DesignSheetImportToolEventCard
        event={event}
        onReviewDesignSheetImport={onReviewDesignSheetImport}
      />
    )
  }

  if (event.tool === 'create_hold' || event.tool === 'propose_reschedule') {
    return <CalendarProposalCard event={event} />
  }

  if (event.tool === 'create_task') {
    if (event.status === 'running') {
      return (
        <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Creating task…
        </div>
      )
    }

    if (event.status === 'error') {
      return (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Task creation failed: {event.error ?? 'Unknown error'}
        </div>
      )
    }

    return (
      <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
        <div className="font-semibold text-foreground">Task created</div>
        {event.taskTitle && <div className="mt-0.5 text-muted-foreground">{event.taskTitle}</div>}
      </div>
    )
  }

  if (event.tool !== 'create_metlife_claim_guide') return null

  if (event.status === 'running') {
    return (
      <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        Generating MetLife claim guide…
      </div>
    )
  }

  if (event.status === 'error') {
    return (
      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        MetLife claim failed: {event.error ?? 'Unknown error'}
      </div>
    )
  }

  const total = typeof event.totalClaim === 'number'
    ? `$${event.totalClaim.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null

  return (
    <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
      <div className="font-semibold text-foreground">✓ MetLife claim guide saved to Drafts</div>
      {event.filename && <div className="mt-0.5 text-muted-foreground">{event.filename}</div>}
      {total && <div className="mt-0.5 text-muted-foreground">Total: {total}</div>}
      {event.signedUrl && (
        <a
          href={event.signedUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-semibold text-accent hover:underline"
        >
          Open
        </a>
      )}
    </div>
  )
}

/**
 * Skill handoff blocks the assistant emits at the end of the trust / incapacity
 * intake interviews (see docs/ai-chat-design-prompts.md). They are structured
 * drafting input, not prose, so they get their own panel instead of markdown.
 */
const HANDOFF_PATTERN = /=== (TRUST|INCAPACITY) DRAFTING SKILL INPUT ===[\s\S]*?=== END ===/g

type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'handoff'; kind: 'trust' | 'incapacity'; content: string }

export function splitHandoffBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let cursor = 0

  for (const match of content.matchAll(HANDOFF_PATTERN)) {
    if (match.index === undefined) continue
    let start = match.index
    let end = start + match[0].length

    // Claude emits the block fenced; swallow the fence so no stray ``` is left behind.
    const openFence = content.slice(cursor, start).match(/```[\w-]*[ \t]*\r?\n[ \t]*$/)
    if (openFence) start -= openFence[0].length
    const closeFence = content.slice(end).match(/^[ \t]*\r?\n[ \t]*```/)
    if (closeFence) end += closeFence[0].length

    const leading = content.slice(cursor, start)
    if (leading.trim()) segments.push({ type: 'text', content: leading })
    segments.push({
      type: 'handoff',
      kind: match[1] === 'TRUST' ? 'trust' : 'incapacity',
      content: match[0],
    })
    cursor = end
  }

  const trailing = content.slice(cursor)
  if (trailing.trim()) segments.push({ type: 'text', content: trailing })
  return segments
}

function HandoffBlock({
  segment,
  matterId,
}: {
  segment: Extract<MessageSegment, { type: 'handoff' }>
  matterId?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="my-2">
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-brand-navy p-3 text-[11px] leading-relaxed text-sidebar-foreground">
        {segment.content}
      </pre>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {matterId ? (
          <Link
            href={`/admin/drafting/${matterId}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
          >
            <FilePenLine className="h-3.5 w-3.5" aria-hidden />
            Send to drafting
          </Link>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            Open this from a matter to send it to drafting.
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(segment.content).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy block'}
        </button>
      </div>
    </div>
  )
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy message"
      className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(content).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function ChatMessage({ message, onReviewDesignSheetImport }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const hasToolEvents = !isUser && (message.toolEvents?.length ?? 0) > 0
  const segments = isUser ? null : splitHandoffBlocks(message.content)
  const hasHandoff = segments?.some(segment => segment.type === 'handoff') ?? false
  const matterId = message.contextSnapshot?.type === 'matter' ? message.contextSnapshot.id : undefined

  return (
    <div className={cn('mb-3 flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'break-words px-3 py-2.5 text-sm leading-relaxed shadow-xs',
          hasHandoff ? 'w-full' : 'max-w-[82%]',
          isUser
            ? 'whitespace-pre-wrap rounded-[12px_12px_2px_12px] bg-accent text-accent-foreground'
            : 'rounded-[12px_12px_12px_2px] border border-border bg-muted text-foreground',
        )}
      >
        {isUser
          ? message.content
          : segments!.map((segment, index) =>
              segment.type === 'handoff' ? (
                <HandoffBlock key={`handoff-${index}`} segment={segment} matterId={matterId} />
              ) : (
                <ChatMarkdown key={`text-${index}`} content={segment.content} />
              ),
            )}
        {hasToolEvents && (
          <div className="mt-1">
            {message.toolEvents!.map(event => (
              <ToolEventCard
                key={event.toolUseId}
                event={event}
                onReviewDesignSheetImport={onReviewDesignSheetImport}
              />
            ))}
          </div>
        )}
      </div>
      {!isUser && message.content ? <CopyMessageButton content={message.content} /> : null}
    </div>
  )
}
