'use client'

import { Fragment } from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  buildMatterActions,
  type MatterActionHandlers,
  type MatterActionItem,
  type MatterActionTarget,
} from '@/lib/matters/matterActions'

/**
 * The kebab and the right-click menu for a matter.
 *
 * Both render the same `buildMatterActions` list, so a surface that offers one
 * offers the other identically. They are separate components only because Radix
 * ships dropdown and context menus as separate primitives.
 */

interface MatterMenuProps extends MatterActionHandlers {
  matter: MatterActionTarget
}

/**
 * Radix builds its keyboard-navigation collection by walking the DOM under the
 * popup, so items must not be wrapped in an element. Fragments render no node,
 * which is what lets one helper emit both the separator and the item.
 */
type ItemComponent = React.ComponentType<{
  variant?: 'default' | 'destructive'
  onSelect?: (event: Event) => void
  children?: React.ReactNode
}>
type SeparatorComponent = React.ComponentType<Record<string, never>>

function renderItems(
  items: MatterActionItem[],
  Item: ItemComponent,
  Separator: SeparatorComponent,
) {
  return items.map(item => {
    const Icon = item.icon
    return (
      <Fragment key={item.key}>
        {item.separatorBefore && <Separator />}
        <Item variant={item.variant ?? 'default'} onSelect={() => item.onSelect()}>
          <Icon aria-hidden />
          {item.label}
        </Item>
      </Fragment>
    )
  })
}

/** The hover-revealed kebab. */
export function MatterActionsMenu({ matter, ...handlers }: MatterMenuProps) {
  const items = buildMatterActions(matter, handlers)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-5"
          aria-label={`More actions for ${matter.title}`}
          // The row is itself clickable; without this the menu would navigate.
          onClick={event => event.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {renderItems(items, DropdownMenuItem, DropdownMenuSeparator)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Wraps a row or card so right-clicking it opens the same actions. Radix anchors
 * the popup at the cursor, so nothing here tracks pointer position.
 */
export function MatterContextMenu({
  matter,
  children,
  ...handlers
}: MatterMenuProps & { children: React.ReactNode }) {
  const items = buildMatterActions(matter, handlers)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {renderItems(items, ContextMenuItem, ContextMenuSeparator)}
      </ContextMenuContent>
    </ContextMenu>
  )
}
