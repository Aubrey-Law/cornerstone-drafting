'use client'

import { useState } from 'react'
import { Check, ClipboardList, Copy } from 'lucide-react'
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
  error?: string
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
        <div className="font-semibold text-foreground">Task added to matter</div>
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

  return (
    <div className={cn('mb-3 flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[82%] break-words px-3 py-2.5 text-sm leading-relaxed shadow-xs',
          isUser
            ? 'whitespace-pre-wrap rounded-[12px_12px_2px_12px] bg-accent text-accent-foreground'
            : 'rounded-[12px_12px_12px_2px] border border-border bg-muted text-foreground',
        )}
      >
        {isUser ? message.content : <ChatMarkdown content={message.content} />}
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
