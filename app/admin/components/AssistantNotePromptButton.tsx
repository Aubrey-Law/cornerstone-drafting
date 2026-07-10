'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MATTER_ACTIVITY_PREFILL,
  MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT,
  MATTER_INTERNAL_ACTIVITY_NOTE_PROMPT,
  MATTER_NOTE_ASSISTANT_PROMPT,
  openCornerstoneAssistant,
} from './adminChatEvents'

interface AssistantNotePromptButtonProps {
  className?: string
}

export function AssistantNotePromptButton({ className }: AssistantNotePromptButtonProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <AssistantChip
        label="Internal note"
        onClick={() =>
          openCornerstoneAssistant({
            prompt: MATTER_NOTE_ASSISTANT_PROMPT,
            send: true,
            noteType: 'internal',
          })
        }
      />
      <AssistantChip
        label="Log activity"
        onClick={() =>
          openCornerstoneAssistant({
            prompt: MATTER_INTERNAL_ACTIVITY_NOTE_PROMPT,
            prefill: MATTER_ACTIVITY_PREFILL,
            noteType: 'internal',
          })
        }
      />
      <AssistantChip
        label="Client comm."
        onClick={() =>
          openCornerstoneAssistant({
            prompt: MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT,
            prefill: MATTER_ACTIVITY_PREFILL,
            noteType: 'client_comm',
          })
        }
      />
    </div>
  )
}

function AssistantChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Sparkles className="h-3 w-3 text-accent" />
      {label}
    </button>
  )
}
