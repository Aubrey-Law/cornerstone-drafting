'use client'

import Link from 'next/link'
import { Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { getNavBadge, type SidebarCounts } from '@/lib/sidebarBadges'
import { formatLastMilestone, matterRecencyTone } from '@/lib/matters/cardFacts'
import { MatterActionsMenu, MatterContextMenu } from '@/components/matter/MatterActionsMenu'
import { matterHref } from '@/lib/matters/matterActions'
import type { MatterNavRow } from '@/lib/queries/sidebarMatters'
import type { SidebarMattersState } from '@/lib/matters/useSidebarMatters'

export interface AdminNavItem {
  href: string
  label: string
  icon: React.ElementType
  group: string
  exact?: boolean
}

interface AdminSidebarProps {
  pathname: string
  compact: boolean
  badgeCounts: SidebarCounts
  matters: SidebarMattersState
  /**
   * Passed in rather than imported. `adminNavItems` has to stay a literal in
   * AdminLayoutClient.tsx because two tests read that file as text, and importing
   * it here would make the shell and this component import each other.
   */
  navItems: readonly AdminNavItem[]
  navGroups: readonly string[]
  /** Closes the mobile sheet; a no-op in the desktop column. */
  onNavigate: () => void
}

function MatterRow({
  matter,
  active,
  isPinned,
  onTogglePin,
  onMovePin,
  onNavigate,
}: {
  matter: MatterNavRow
  active: boolean
  isPinned: boolean
  onTogglePin: (id: string) => void
  onMovePin?: (id: string, direction: -1 | 1) => void
  onNavigate: () => void
}) {
  const milestone = matter.last_milestone_at ? Date.parse(matter.last_milestone_at) : null
  const milestoneMs = milestone !== null && Number.isFinite(milestone) ? milestone : null
  const subtitle = [matter.client_name, formatLastMilestone(milestoneMs)]
    .filter(Boolean)
    .join(' · ')

  return (
    <MatterContextMenu
      matter={{ matterId: matter.matter_id, title: matter.title, isPinned }}
      onTogglePin={onTogglePin}
      onMovePin={onMovePin}
    >
      {/*
        A div wrapping a link rather than a link wrapping everything: the action
        cluster must not be nested inside the anchor, or a click on the kebab
        would also navigate.
      */}
      <div
        className={cn(
          'group/matter relative rounded-md border-l-2',
          active
            ? 'border-selected-border bg-selected font-medium text-selected-foreground'
            : 'border-transparent hover:bg-accent',
        )}
      >
        <Link
          href={matterHref(matter.matter_id)}
          onClick={onNavigate}
          title={[matter.title, matter.client_name, matter.matter_number].filter(Boolean).join(' — ')}
          className="flex flex-col py-1.5 pl-3 pr-14"
        >
          <span className="truncate text-sm">{matter.title}</span>
          {/*
            Present but sub-audible: legible when you look for it, quiet when you
            are scanning the list above it.
          */}
          <span
            className={cn(
              'truncate text-micro leading-tight opacity-60 transition-opacity duration-200 group-hover/matter:opacity-100',
              matterRecencyTone(milestoneMs),
            )}
          >
            {subtitle || '—'}
          </span>
        </Link>

        <div
          // A pinned row keeps its affordance visible without hovering, so the
          // pin state is legible from the list alone.
          data-pinned={isPinned || undefined}
          className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/matter:opacity-100 data-[pinned]:opacity-100"
        >
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            aria-label={isPinned ? `Unpin ${matter.title}` : `Pin ${matter.title}`}
            onClick={() => onTogglePin(matter.matter_id)}
          >
            {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
          <MatterActionsMenu
            matter={{ matterId: matter.matter_id, title: matter.title, isPinned }}
            onTogglePin={onTogglePin}
            onMovePin={onMovePin}
          />
        </div>
      </div>
    </MatterContextMenu>
  )
}

/**
 * Worklists without a nav entry of their own, and the item that owns them:
 * the close-out lists open from the Matters dashboard, field audits sit with
 * Reviews and the playbook builder.
 */
const NAV_SECTION_OWNERS: Record<string, readonly string[]> = {
  '/admin/matters/list': ['/admin/funding', '/admin/execution', '/admin/fiduciaries'],
  '/admin/review': ['/admin/field-audits', '/admin/playbooks'],
}

function isOwnedSection(href: string, pathname: string): boolean {
  return (NAV_SECTION_OWNERS[href] ?? []).some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** Whether a nav item is the section the current route belongs to. */
export function isNavItemActive(item: Pick<AdminNavItem, 'href' | 'exact'>, pathname: string): boolean {
  return (
    pathname === item.href
    || (!item.exact && pathname.startsWith(`${item.href}/`))
    || (item.href === '/admin/matters/list' && pathname.startsWith('/admin/matters/'))
    || (item.href === '/admin/crm/opportunities' && pathname.startsWith('/admin/leads/'))
    || isOwnedSection(item.href, pathname)
  )
}

export function AdminSidebar({
  pathname,
  compact,
  badgeCounts,
  matters,
  navItems,
  navGroups,
  onNavigate,
}: AdminSidebarProps) {
  // `new` and `list` are sibling routes, not matter ids — without excluding them
  // visiting the list would highlight a row called "list" that does not exist.
  const activeMatterId = pathname.match(/^\/admin\/matters\/(?!new$|list$)([^/]+)/)?.[1]

  return (
    <nav className="flex min-h-0 flex-1 flex-col p-2">
      {navGroups.map(group => (
        <div key={group} className={cn('flex flex-col gap-1', compact ? 'py-1' : 'pb-2')}>
          {!compact ? (
            <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group}
            </p>
          ) : null}
          {navItems
            .filter(item => item.group === group)
            .map(item => {
              const active = isNavItemActive(item, pathname)
              const Icon = item.icon
              const badge = getNavBadge(item.href, badgeCounts)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={compact ? item.label : undefined}
                  className={cn(
                    'flex items-center rounded-md text-sm font-medium transition-colors',
                    compact ? 'justify-center px-2 py-2.5' : 'gap-2 px-3 py-2',
                    active
                      ? 'bg-selected text-selected-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon className="h-4 w-4 shrink-0" />
                    {compact && badge && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -right-1 -top-1 h-2 w-2 rounded-full',
                          // Hollow, not filled: at 8px a hue change is not a
                          // signal, but a ring against a dot is.
                          badge.stale
                            ? 'border border-border-strong bg-card'
                            : badge.tone === 'destructive'
                              ? 'bg-destructive'
                              : 'bg-primary',
                        )}
                      />
                    )}
                  </span>
                  {!compact ? (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {badge && (
                        <span
                          // An outline instead of a fill, so a stale count is
                          // told apart by shape rather than by shade alone.
                          className={cn(
                            'ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-micro font-medium tabular-nums',
                            badge.stale
                              ? 'border border-dashed border-border-strong text-muted-foreground'
                              : badge.tone === 'destructive'
                                ? 'bg-destructive/15 text-destructive'
                                : 'bg-primary/15 text-primary',
                          )}
                          title={badge.stale ? 'Last known count — this could not be refreshed' : undefined}
                        >
                          {badge.value}
                          {badge.stale && <span className="sr-only"> (last known count, could not be refreshed)</span>}
                        </span>
                      )}
                    </>
                  ) : (
                    // The rail's badge is an 8px dot, hidden from assistive
                    // tech along with its count — so the one thing it must
                    // still say is that the count behind it is out of date.
                    <span className="sr-only">
                      {item.label}
                      {badge?.stale ? ' (last known count, could not be refreshed)' : ''}
                    </span>
                  )}
                </Link>
              )
            })}
        </div>
      ))}

      {/*
        Matter rows are two lines of text, which the 56px icon rail cannot show —
        so they are hidden there rather than rendered unreadably, the same way the
        group labels are.
      */}
      {!compact && (matters.pinned.length > 0 || matters.recent.length > 0) && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
          {matters.pinned.length > 0 && (
            <div className="flex min-h-0 flex-col">
              <p className="px-3 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground/70">
                Pinned
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {matters.pinned.map(matter => (
                  <MatterRow
                    key={matter.matter_id}
                    matter={matter}
                    active={matter.matter_id === activeMatterId}
                    isPinned
                    onTogglePin={matters.togglePin}
                    onMovePin={matters.movePin}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          )}

          {/*
            No heading. The recent list reads as a continuation of the matters
            above it rather than as a second, separately-titled thing.
          */}
          {matters.recent.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {matters.recent.map(matter => (
                <MatterRow
                  key={matter.matter_id}
                  matter={matter}
                  active={matter.matter_id === activeMatterId}
                  isPinned={false}
                  onTogglePin={matters.togglePin}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
