import { ExternalLink, Link2, Pencil, Pin, PinOff, Trash2, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * The actions a matter offers, derived once as data.
 *
 * The kebab menu and the right-click menu are different Radix primitives, so they
 * cannot share a component — but they can share this list. Building the actions
 * here and rendering them twice is what keeps a matter offering the same things
 * however you reach for them; a hand-maintained second copy would drift the first
 * time somebody added an action to only one of them.
 */

export interface MatterActionTarget {
  matterId: string
  /** Used in the confirm copy and in the menu's accessible name. */
  title: string
  isPinned: boolean
}

/**
 * Handlers the surface supplies. Rename and delete are optional on purpose: an
 * action with nowhere to go is omitted rather than rendered dead, and both need
 * surface-local UI (an inline input, a confirm dialog) that this module has no
 * business owning.
 */
export interface MatterActionHandlers {
  onTogglePin: (matterId: string) => void
  onRename?: (matterId: string) => void
  onDelete?: (matterId: string) => void
}

export interface MatterActionItem {
  key: string
  label: string
  icon: LucideIcon
  onSelect: () => void
  variant?: 'default' | 'destructive'
  /** Renders a divider above this item. */
  separatorBefore?: boolean
}

export function matterHref(matterId: string): string {
  return `/admin/matters/${matterId}`
}

export function buildMatterActions(
  target: MatterActionTarget,
  handlers: MatterActionHandlers,
): MatterActionItem[] {
  const items: MatterActionItem[] = [
    {
      key: 'open-new-tab',
      label: 'Open in new tab',
      icon: ExternalLink,
      onSelect: () => {
        window.open(matterHref(target.matterId), '_blank', 'noopener,noreferrer')
      },
    },
  ]

  if (handlers.onRename) {
    const onRename = handlers.onRename
    items.push({
      key: 'rename',
      label: 'Rename',
      icon: Pencil,
      onSelect: () => onRename(target.matterId),
    })
  }

  items.push({
    key: 'copy-link',
    label: 'Copy link',
    icon: Link2,
    onSelect: () => {
      // Absolute, so the link is useful once it leaves this tab.
      const url = new URL(matterHref(target.matterId), window.location.origin).toString()
      void copyToClipboard(url).then(ok => {
        if (ok) toast.success('Link copied')
        else toast.error('Could not copy the link')
      })
    },
  })

  items.push({
    key: 'toggle-pin',
    label: target.isPinned ? 'Unpin' : 'Pin',
    icon: target.isPinned ? PinOff : Pin,
    onSelect: () => handlers.onTogglePin(target.matterId),
  })

  if (handlers.onDelete) {
    const onDelete = handlers.onDelete
    items.push({
      key: 'delete',
      label: 'Delete matter',
      icon: Trash2,
      variant: 'destructive',
      separatorBefore: true,
      onSelect: () => onDelete(target.matterId),
    })
  }

  return items
}
