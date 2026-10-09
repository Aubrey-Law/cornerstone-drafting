'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Briefcase,
  BookOpen,
  Clock,
  CalendarDays,
  ListTodo,
  ReceiptText,
  FilePenLine,
  MessageSquareText,
  Search,
  Settings,
  Sparkles,
  Sun,
  User,
  UsersRound,
  Zap,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useGlobalSearch } from '@/lib/search/useGlobalSearch'
import { recentHit, type SearchHit } from '@/lib/search/globalSearchSources'
import { useSharedSidebarMatters } from '@/lib/matters/SidebarMattersContext'
import { requestDeparture } from '@/lib/navigation/departure'

const NAV_ITEMS = [
  { label: 'Today', href: '/admin', icon: Sun },
  { label: 'Communications', href: '/admin/communications', icon: MessageSquareText },
  { label: 'Leads', href: '/admin/crm/opportunities', icon: UsersRound },
  { label: 'Matters', href: '/admin/matters/list', icon: Briefcase },
  { label: 'Contacts', href: '/admin/contacts', icon: User },
  { label: 'Tasks', href: '/admin/tasks', icon: ListTodo },
  { label: 'Calendar', href: '/admin/calendar', icon: CalendarDays },
  { label: 'Automations', href: '/admin/automations', icon: Zap },
  { label: 'Billing', href: '/admin/billing', icon: ReceiptText },
  { label: 'Drafting', href: '/admin/drafting', icon: FilePenLine },
  { label: 'Assistant', href: '/admin/assistant', icon: Sparkles },
  { label: 'Library', href: '/admin/works', icon: BookOpen },
  { label: 'Aging', href: '/admin/pipeline/aging', icon: Clock },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

const KIND_ICON = {
  matter: Briefcase,
  contact: User,
  task: ListTodo,
  invoice: ReceiptText,
} as const

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { hits, searching, error: searchError, failedSources } = useGlobalSearch(query, open)
  const router = useRouter()

  // The shell already fetches these for the sidebar, so the empty palette costs
  // no request. Null when the palette renders outside the shell's provider, in
  // which case there is simply nothing to suggest.
  const sidebarMatters = useSharedSidebarMatters()
  const recents = (sidebarMatters?.recent ?? []).slice(0, 5).map(recentHit)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const navigate = (href: string) => {
    requestDeparture({
      destination: href,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      proceed: () => {
        setOpen(false)
        setQuery('')
        router.push(href)
      },
    })
  }

  const typed = query.trim().length > 0
  const navMatches = NAV_ITEMS.filter(item =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const renderGroup = (heading: string, items: SearchHit[]) =>
    items.length > 0 && (
      <CommandGroup heading={heading}>
        {items.map(hit => {
          const Icon = KIND_ICON[hit.kind]
          return (
            <CommandItem
              key={`${hit.kind}:${hit.id}`}
              value={`${hit.kind}:${hit.id}`}
              tabIndex={-1}
              onPointerDown={event => event.currentTarget.focus()}
              onSelect={() => navigate(hit.href)}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{hit.label}</span>
              {hit.detail && (
                <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                  {hit.detail}
                </span>
              )}
            </CommandItem>
          )
        })}
      </CommandGroup>
    )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        aria-label="Search"
        data-testid="mobile-global-search-trigger"
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden max-w-sm flex-1 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-xs md:flex"
        aria-label="Search"
      >
        <span className="inline-flex items-center gap-2">
          <Search className="h-3.5 w-3.5" />
          Search everything…
        </span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1 py-px text-micro font-medium text-muted-foreground lg:inline-flex">
          <span>⌘</span>K
        </kbd>
      </button>

      <CommandDialog shouldFilter={false} open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search matters, contacts, tasks, invoices…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {searchError && (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {searchError}
            </p>
          )}
          <CommandEmpty>{searching ? 'Searching…' : searchError ?? 'No results.'}</CommandEmpty>

          {/* Before anything is typed: where you already were. ⌘K then Enter
              returns you to the matter you had open. */}
          {!typed && renderGroup('Recent matters', recents)}

          {renderGroup('Matters', hits.matters)}
          {renderGroup('Contacts', hits.contacts)}
          {renderGroup('Tasks', hits.tasks)}
          {renderGroup('Invoices', hits.invoices)}

          {/* Said once, under the results, rather than as an error over them:
              some of what was asked for came back, and some did not. */}
          {!searchError && failedSources > 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Some results could not be loaded.
            </p>
          )}

          {navMatches.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Navigate">
                {navMatches.map(item => (
                  <CommandItem key={item.href} tabIndex={-1} onPointerDown={event => event.currentTarget.focus()} onSelect={() => navigate(item.href)}>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
