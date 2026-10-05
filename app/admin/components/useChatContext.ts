'use client'

import { usePathname } from 'next/navigation'

export type ChatContextType =
  | { type: 'matter'; id: string; label: string }
  | { type: 'lead'; id: string; label: string }
  | { type: 'general' }

/**
 * Static routes that sit beside a `[id]` segment. Without this, the matters
 * list at `/admin/matters/list` reads as a matter whose id is "list": the
 * assistant scopes itself to "This matter" and looks up a row that is not there.
 */
const STATIC_SIBLINGS: Record<string, ReadonlySet<string>> = {
  matters: new Set(['list']),
  drafting: new Set(['real-estate-transfer']),
}

export function chatContextForPath(pathname: string): ChatContextType {
  const matterMatch = pathname.match(/\/admin\/matters\/([a-zA-Z0-9-]+)/)
  if (matterMatch && !STATIC_SIBLINGS.matters.has(matterMatch[1])) {
    return { type: 'matter', id: matterMatch[1], label: 'This matter' }
  }

  const draftingMatch = pathname.match(/\/admin\/drafting\/([a-zA-Z0-9-]+)/)
  if (draftingMatch && !STATIC_SIBLINGS.drafting.has(draftingMatch[1])) {
    return { type: 'matter', id: draftingMatch[1], label: 'This matter' }
  }

  const leadMatch = pathname.match(/\/admin\/(?:leads|crm\/opportunities)\/([a-zA-Z0-9-]+)/)
  if (leadMatch) {
    return { type: 'lead', id: leadMatch[1], label: 'This opportunity' }
  }

  return { type: 'general' }
}

export function useChatContext(): ChatContextType {
  return chatContextForPath(usePathname())
}
