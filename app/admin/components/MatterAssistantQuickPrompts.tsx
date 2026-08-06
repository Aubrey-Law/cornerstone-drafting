'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { openCornerstoneAssistant } from './adminChatEvents'

interface QuickPrompt {
  label: string
  prompt: string
}

interface MatterAssistantQuickPromptsProps {
  prompts: QuickPrompt[]
  className?: string
}

export function MatterAssistantQuickPrompts({ prompts, className }: MatterAssistantQuickPromptsProps) {
  return (
    <div className={className}>
      {prompts.map(item => (
        <Button
          key={item.prompt}
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={() => openCornerstoneAssistant({ prompt: item.prompt, send: true })}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {item.label}
        </Button>
      ))}
    </div>
  )
}
