'use client'

import { useState, type KeyboardEvent } from 'react'
import { Send, Square, Workflow, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResizableTextarea } from '@/components/ui/drag-resize'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WorkflowPickerContent } from '@/components/works/WorkflowPickerContent'
import type { WorkflowRef } from './useAssistantStream'

interface AssistantComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  workflow: WorkflowRef | null
  onWorkflowChange: (workflow: WorkflowRef | null) => void
  autoFocus?: boolean
  placeholder?: string
  /**
   * Why a send would be refused right now, with the fix. The server refuses a
   * matter-scoped workflow in a general chat; holding the message here saves
   * the round trip and says what to do.
   */
  sendBlocked?: { reason: string; actionLabel?: string; onAction?: () => void } | null
}

export function AssistantComposer({
  value, onChange, onSend, onStop, streaming, workflow, onWorkflowChange, autoFocus, placeholder, sendBlocked = null,
}: AssistantComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const canSend = !streaming && Boolean(value.trim()) && !sendBlocked

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      {workflow && (
        <div className="mb-2 flex items-center gap-1 px-1">
          <Badge variant="secondary" className="gap-1 pr-1">
            <Workflow className="h-3 w-3" />
            {workflow.title}
            <button type="button" aria-label="Remove workflow" onClick={() => onWorkflowChange(null)} className="rounded-full p-0.5 hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </Badge>
          <span className="text-micro text-muted-foreground">will guide this message</span>
        </div>
      )}
      {sendBlocked && (
        <div role="note" className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span>{sendBlocked.reason}</span>
          {sendBlocked.onAction && (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={sendBlocked.onAction}>
              {sendBlocked.actionLabel ?? 'Fix'}
            </Button>
          )}
        </div>
      )}
      <ResizableTextarea
        handleLabel="Resize the message box"
        handleEdge="top"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Ask anything — drafting, matters, Massachusetts estate planning…'}
        autoFocus={autoFocus}
        rows={3}
        className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0"
        handleClassName="rounded-none border-0 bg-transparent"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
          <Workflow className="h-4 w-4" /> Workflows
        </Button>
        {streaming ? (
          <Button type="button" variant="outline" size="sm" onClick={onStop}>
            <Square className="h-3.5 w-3.5" /> Stop
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={!canSend} onClick={onSend}>
            <Send className="h-3.5 w-3.5" /> Send
          </Button>
        )}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Attach a workflow</DialogTitle>
            <DialogDescription>The assistant reads the workflow and follows it for your next message.</DialogDescription>
          </DialogHeader>
          <WorkflowPickerContent
            typeFilter="assistant"
            executionMode="chat"
            pickLabel="Attach workflow"
            onPick={skill => {
              onWorkflowChange({
                id: skill.id,
                title: skill.name,
                matterScoped: Array.isArray(skill.allowed_context) && skill.allowed_context.includes('matter'),
              })
              setPickerOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
