'use client'

import { MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatContext } from './useChatContext'

interface FloatingChatButtonProps {
  isOpen: boolean
  onOpen: () => void
}

export function FloatingChatButton({ isOpen, onOpen }: FloatingChatButtonProps) {
  const chatContext = useChatContext()
  const hasLoadedContext = chatContext.type !== 'general'

  if (isOpen) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open AI assistant"
      className={cn(
        'fixed bottom-6 right-6 z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'bg-primary text-primary-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <MessageSquare size={22} strokeWidth={2} />
      {hasLoadedContext && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent"
        />
      )}
    </button>
  )
}
