'use client'

import { useState, type KeyboardEvent } from 'react'
import { Send, Square, Workflow, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
}

export function AssistantComposer({
  value, onChange, onSend, onStop, streaming, workflow, onWorkflowChange, autoFocus, placeholder,
}: AssistantComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!streaming && value.trim()) onSend()
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      {workflow && (
        <div className="mb-2 flex items-center gap-1 px-1">
          <Badge variant="secondary" className="gap-1 pr-1">
            <Workflow className="h-3 w-3" />
            {workflow.title}
            <button type="button" aria-label="Remove workflow" onClick={() => onWorkflowChange(null)} className="rounded-full p-0.5 hover:bg-muted">
              <X className="h-3 w-3" />
            </button>
          </Badge>
          <span className="text-[11px] text-muted-foreground">will guide this message</span>
        </div>
      )}
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Ask anything — drafting, matters, Massachusetts estate planning…'}
        autoFocus={autoFocus}
        rows={3}
        className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0"
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
          <Button type="button" size="sm" disabled={!value.trim()} onClick={onSend}>
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
            pickLabel="Attach workflow"
            onPick={skill => {
              onWorkflowChange({ id: skill.id, title: skill.name })
              setPickerOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
