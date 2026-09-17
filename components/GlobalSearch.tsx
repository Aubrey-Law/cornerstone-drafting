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
  MailSearch,
  Search,
  Settings,
  Sparkles,
  Sun,
  UsersRound,
} from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useMatterSearch } from '@/lib/matters/useMatterSearch'

const NAV_ITEMS = [
  { label: 'Today', href: '/admin', icon: Sun },
  { label: 'Email triage', href: '/admin/email-triage', icon: MailSearch },
  { label: 'Leads', href: '/admin/crm/opportunities', icon: UsersRound },
  { label: 'Matters', href: '/admin/matters/list', icon: Briefcase },
  { label: 'Tasks', href: '/admin/tasks', icon: ListTodo },
  { label: 'Calendar', href: '/admin/calendar', icon: CalendarDays },
  { label: 'Billing', href: '/admin/billing', icon: ReceiptText },
  { label: 'Drafting', href: '/admin/drafting', icon: FilePenLine },
  { label: 'Assistant', href: '/admin/assistant', icon: Sparkles },
  { label: 'Library', href: '/admin/works', icon: BookOpen },
  { label: 'Aging', href: '/admin/pipeline/aging', icon: Clock },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { matters, searching, error: searchError } = useMatterSearch(query, open)
  const router = useRouter()

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
    setOpen(false)
    setQuery('')
    router.push(href)
  }

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
          Search matters…
        </span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1 py-px text-micro font-medium text-muted-foreground lg:inline-flex">
          <span>⌘</span>K
        </kbd>
      </button>

      <CommandDialog shouldFilter={false} open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search matters or jump to a page…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {searchError && <p role="alert" className="px-3 py-2 text-sm text-destructive">{searchError}</p>}
          <CommandEmpty>{searching ? 'Searching…' : searchError ?? 'No results.'}</CommandEmpty>
          {matters.length > 0 && (
            <CommandGroup heading="Matters">
              {matters.map(m => (
                <CommandItem
                  key={m.matter_id}
                  value={`matter:${m.matter_id}`}
                  onSelect={() => navigate(`/admin/matters/${m.matter_id}`)}
                >
                  <Briefcase className="h-4 w-4" />
                  <span className="truncate">{m.client_name || m.matter_name || 'Untitled'}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.stage ?? ''}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Navigate">
            {NAV_ITEMS.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase())).map(item => (
              <CommandItem key={item.href} onSelect={() => navigate(item.href)}>
                <item.icon className="h-4 w-4" />
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
