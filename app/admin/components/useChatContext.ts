'use client'

import { usePathname } from 'next/navigation'

export type ChatContextType =
  | { type: 'matter'; id: string; label: string }
  | { type: 'lead'; id: string; label: string }
  | { type: 'general' }

export function chatContextForPath(pathname: string): ChatContextType {
  const matterMatch = pathname.match(/\/admin\/matters\/([a-zA-Z0-9-]+)/)
  if (matterMatch) {
    return { type: 'matter', id: matterMatch[1], label: 'This matter' }
  }

  const draftingMatch = pathname.match(/\/admin\/drafting\/([a-zA-Z0-9-]+)/)
  if (draftingMatch) {
    return { type: 'matter', id: draftingMatch[1], label: 'This matter' }
  }

  const leadMatch = pathname.match(/\/admin\/leads\/([a-zA-Z0-9-]+)/)
  if (leadMatch) {
    return { type: 'lead', id: leadMatch[1], label: 'This lead' }
  }

  return { type: 'general' }
}

export function useChatContext(): ChatContextType {
  return chatContextForPath(usePathname())
}
