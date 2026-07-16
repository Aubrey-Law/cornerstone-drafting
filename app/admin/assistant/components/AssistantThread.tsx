'use client'

import { useEffect, useRef } from 'react'
import { Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ChatMessage } from '@/app/admin/components/ChatMessage'
import type { AssistantMessage } from './useAssistantStream'

interface AssistantThreadProps {
  messages: AssistantMessage[]
  streaming: boolean
}

export function AssistantThread({ messages, streaming }: AssistantThreadProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-4">
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' && message.workflowAttached && (
            <div className="mb-1 flex justify-end">
              <Badge variant="secondary" className="gap-1">
                <Workflow className="h-3 w-3" /> {message.workflowAttached.title}
              </Badge>
            </div>
          )}
          {message.role === 'assistant' && message.workflowApplied && (
            <div className="mb-1">
              <Badge variant="outline" className="gap-1 text-xs">
                <Workflow className="h-3 w-3" /> Following “{message.workflowApplied.title}”
              </Badge>
            </div>
          )}
          <ChatMessage
            message={{
              id: message.id,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              toolEvents: message.toolEvents,
            }}
          />
        </div>
      ))}
      {streaming && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
        <p className="px-2 text-sm text-muted-foreground">Thinking…</p>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
