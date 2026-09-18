'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ClipboardList, Copy, Download, Eye, FilePenLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabaseClient'
import { downloadCsvFromRoute } from '@/lib/browserDownload'
import { ChatMarkdown } from '@/components/chat/ChatMarkdown'
import type {
  DesignSheetImportPreviewRow,
  DesignSheetImportProposal,
} from '@/lib/designSheetImport/shared'

export type ToolStatus = 'running' | 'done' | 'error'

/** Tools whose result is a proposal the attorney must accept, never a write. */
const PROPOSAL_TOOLS = ['create_hold', 'propose_reschedule', 'create_task', 'create_lead', 'register_custom_template']

export interface ToolEvent {
  toolUseId: string
  tool: string
  status: ToolStatus
  filename?: string
  signedUrl?: string
  /** CSV export the attorney can download (lead or matter export). */
  downloadUrl?: string
  exportCount?: number
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
    kind: 'create_hold' | 'propose_reschedule' | 'create_task' | 'create_lead' | 'register_custom_template'
    payload: Record<string, unknown>
  }>
  error?: string
  /** The raw result the tool emitted, for cards that read fields no other chip knows. */
  detail?: Record<string, unknown>
}

/** Renders any proposed write — calendar hold, reschedule, task, lead. */
function ProposalCard({ event }: { event: ToolEvent }) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  const [acting, setActing] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const rows = event.proposal ?? []
  if (event.status === 'running') return <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">Preparing proposal…</div>
  if (event.status === 'error') return <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">Proposal failed: {event.error ?? 'Unknown error'}</div>

  async function accept(row: typeof rows[number]) {
    setActing(true)
    setFailed(null)
    try {
      const response = await fetch('/api/admin/assistant/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: row.kind, payload: row.payload }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (response.ok) {
        setAccepted(current => new Set(current).add(row.id))
      } else {
        // Silently leaving the row unchanged read as "nothing happened".
        setFailed(body.error ?? 'Could not apply this proposal.')
      }
    } catch {
      setFailed('Could not reach the server.')
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
          </div>
        </div>
      ))}
      {failed && (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
          {failed}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-muted px-3 py-2">
        <button
          type="button"
          disabled={acting || rows.every(row => accepted.has(row.id))}
          onClick={() => void Promise.all(rows.filter(row => !accepted.has(row.id)).map(accept))}
          className="font-semibold text-primary disabled:opacity-50"
        >
          Accept all {rows.length}
        </button>
        {rows.some(row => row.kind === 'create_hold' || row.kind === 'propose_reschedule') && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('calendar:preview-proposals', { detail: rows }))}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Eye className="h-3.5 w-3.5" /> Preview on calendar
          </button>
        )}
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
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ClipboardList className="h-3.5 w-3.5" />
        Review proposed updates
      </button>
    </div>
  )
}

interface ExportNoun {
  singular: string
  plural: string
  /** What the export is called, e.g. "Lead export". */
  label: string
  /** What the file holds, so the reader knows before downloading it. */
  columns: string
}

const EXPORT_TOOL_NOUNS: Record<string, ExportNoun> = {
  export_leads: {
    singular: 'lead',
    plural: 'leads',
    label: 'Lead export',
    columns: 'name, email and phone',
  },
  export_matters: {
    singular: 'matter',
    plural: 'matters',
    label: 'Matter export',
    columns: 'client, contact, stage and fee',
  },
}

const FALLBACK_EXPORT_NOUN: ExportNoun = {
  singular: 'row', plural: 'rows', label: 'Export', columns: 'the listed columns',
}

/**
 * A list export's download.
 *
 * The CSV routes are admin-only, so the file is fetched with the session token
 * and handed to the browser as a blob rather than linked to directly — a bare
 * link would download an "Unauthorized" JSON body whenever the cookie session
 * is not the one carrying the admin role.
 */
function ExportToolEventCard({ event }: { event: ToolEvent }) {
  const noun = EXPORT_TOOL_NOUNS[event.tool] ?? FALLBACK_EXPORT_NOUN
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  if (event.status === 'running') {
    return (
      <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        Building {noun.singular} export…
      </div>
    )
  }

  if (event.status === 'error') {
    return (
      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {noun.label} failed: {event.error ?? 'Unknown error'}
      </div>
    )
  }

  async function download(url: string, filename: string) {
    setDownloading(true)
    setFailed(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await downloadCsvFromRoute(url, filename, session?.access_token ?? null)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : `Could not download the ${noun.singular} export`)
    } finally {
      setDownloading(false)
    }
  }

  const count = event.exportCount
  const url = event.downloadUrl
  const filename = event.filename ?? `cornerstone-${noun.plural}.csv`

  return (
    <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
      <div className="font-semibold text-foreground">{noun.label} ready</div>
      <div className="mt-0.5 text-muted-foreground">
        {typeof count === 'number'
          ? `${count} ${count === 1 ? noun.singular : noun.plural} — ${noun.columns}`
          : noun.columns}
      </div>
      {url && (
        <button
          type="button"
          disabled={downloading}
          onClick={() => void download(url, filename)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {downloading ? 'Preparing…' : 'Download CSV'}
        </button>
      )}
      {failed && <div className="mt-1 text-destructive">{failed}</div>}
    </div>
  )
}

/** Verb and noun for each read-only tool, in the running and finished tenses. */
const TOOL_ACTIVITY_LABELS: Record<string, { running: string; done: string }> = {
  find_matter: { running: 'Searching records', done: 'Searched records' },
  read_matter_record: { running: 'Reading matter record', done: 'Read matter record' },
  read_document_text: { running: 'Reading document', done: 'Read document' },
  read_design_sheet_status: { running: 'Checking design sheet', done: 'Checked design sheet' },
  list_workflows: { running: 'Listing workflows', done: 'Listed workflows' },
  read_workflow: { running: 'Reading workflow', done: 'Read workflow' },
  list_calendar_range: { running: 'Reading calendar', done: 'Read calendar' },
  find_open_slots: { running: 'Finding open slots', done: 'Found open slots' },
  list_matter_dates: { running: 'Reading matter dates', done: 'Read matter dates' },
  list_overdue_followups: { running: 'Reading overdue follow-ups', done: 'Read overdue follow-ups' },
  week_review: { running: 'Reviewing the week', done: 'Reviewed the week' },
  draft_reschedule_email: { running: 'Drafting reschedule email', done: 'Drafted reschedule email' },
  analyze_template_upload: { running: 'Analyzing upload', done: 'Analyzed upload' },
  list_template_fields: { running: 'Searching template fields', done: 'Searched template fields' },
  apply_template_edits: { running: 'Applying template edits', done: 'Applied template edits' },
  preview_template_render: { running: 'Rendering preview', done: 'Rendered preview' },
  list_master_templates: { running: 'Listing document masters', done: 'Listed document masters' },
  stage_master_template_version: { running: 'Staging master version', done: 'Staged master version' },
}

function humanizeToolName(tool: string) {
  return tool.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())
}

/** What a read touched, from whichever result fields the tool emitted. */
function toolActivityDetail(event: ToolEvent): string | null {
  const detail = event.detail ?? {}
  const parts: string[] = []
  if (typeof detail.matter_label === 'string' && detail.matter_label) parts.push(detail.matter_label)
  if (Array.isArray(detail.sections) && detail.sections.length) parts.push(detail.sections.join(', '))
  if (typeof detail.match_count === 'number') {
    const query = typeof detail.query === 'string' ? ` for “${detail.query}”` : ''
    parts.push(`${detail.match_count} ${detail.match_count === 1 ? 'match' : 'matches'}${query}`)
  }
  if (typeof detail.name === 'string' && detail.name && event.tool === 'read_document_text') parts.push(detail.name)
  if (detail.truncated === true) parts.push('truncated')
  if (typeof detail.blocking_count === 'number') parts.push(`${detail.blocking_count} blocking`)
  if (typeof detail.count === 'number' && !parts.length) parts.push(`${detail.count} found`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * The chip for any tool without a card of its own — the read-only tools.
 * Without it the attorney saw "Thinking…" and then an answer, with no sign the
 * record had been pulled and no way to tell when it had not been.
 */
function ToolActivityCard({ event }: { event: ToolEvent }) {
  const labels = TOOL_ACTIVITY_LABELS[event.tool] ?? { running: humanizeToolName(event.tool), done: humanizeToolName(event.tool) }
  if (event.status === 'error') {
    return (
      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
        {labels.done} failed: {event.error ?? 'Unknown error'}
      </div>
    )
  }
  const detail = event.status === 'done' ? toolActivityDetail(event) : null
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span>
        {event.status === 'running' ? `${labels.running}…` : labels.done}
        {detail ? <span className="text-foreground"> · {detail}</span> : null}
      </span>
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

  if (event.tool === 'export_leads' || event.tool === 'export_matters') {
    return <ExportToolEventCard event={event} />
  }

  // A proposed write renders as a proposal whichever tool emitted it — the
  // mutating tools all propose now rather than writing on the model's say-so.
  if (event.proposal?.length || PROPOSAL_TOOLS.includes(event.tool)) {
    return <ProposalCard event={event} />
  }

  if (event.tool !== 'create_metlife_claim_guide') return <ToolActivityCard event={event} />

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
          className="mt-1 inline-block font-semibold text-primary hover:underline"
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
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-brand-navy p-3 text-micro leading-relaxed text-sidebar-foreground">
        {segment.content}
      </pre>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {matterId ? (
          <Link
            href={`/admin/drafting/${matterId}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-accent"
          >
            <FilePenLine className="h-3.5 w-3.5" aria-hidden />
            Send to drafting
          </Link>
        ) : (
          <span className="text-micro text-muted-foreground">
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
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
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
      className="mt-1 inline-flex items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-foreground"
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
            ? 'whitespace-pre-wrap rounded-[12px_12px_2px_12px] bg-primary text-primary-foreground'
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
