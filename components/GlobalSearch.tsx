'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Briefcase,
  BookOpen,
  Clock,
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
import { supabase } from '@/lib/supabaseClient'

interface MatterResult {
  matter_id: string
  matter_name: string | null
  client_name: string | null
  stage: string | null
}

const NAV_ITEMS = [
  { label: 'Today', href: '/admin', icon: Sun },
  { label: 'Email triage', href: '/admin/email-triage', icon: MailSearch },
  { label: 'Leads', href: '/admin/crm/opportunities', icon: UsersRound },
  { label: 'Matters', href: '/admin/matters/list', icon: Briefcase },
  { label: 'Drafting', href: '/admin/drafting', icon: FilePenLine },
  { label: 'Assistant', href: '/admin/assistant', icon: Sparkles },
  { label: 'Library', href: '/admin/works', icon: BookOpen },
  { label: 'Aging', href: '/admin/pipeline/aging', icon: Clock },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
]

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matters, setMatters] = useState<MatterResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Calendar owns ⌘K for Quick book while that working surface is active.
        if (pathname === '/admin/calendar') return
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [pathname])

  const searchWork = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setMatters([])
      setSearchError(null)
      return
    }

    const term = trimmed.replace(/[%,]/g, ' ')
    setSearching(true)
    setSearchError(null)
    try {
      const { data, error } = await supabase
        .from('v_matter_pipeline')
        .select('matter_id, matter_name, client_name, stage')
        .or(`matter_name.ilike.%${term}%,client_name.ilike.%${term}%,client_email.ilike.%${term}%`)
        .limit(8)

      if (error) throw error
      setMatters((data ?? []) as MatterResult[])
    } catch {
      setMatters([])
      setSearchError('Some results may be unavailable. Try again.')
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void searchWork(query)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, searchWork])

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
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
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
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground lg:inline-flex">
          <span>⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search matters or jump to a page…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{searching ? 'Searching…' : searchError ?? 'No results.'}</CommandEmpty>
          {matters.length > 0 && (
            <CommandGroup heading="Matters">
              {matters.map(m => (
                <CommandItem
                  key={m.matter_id}
                  value={`${m.client_name ?? ''} ${m.matter_name ?? ''}`}
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
            {NAV_ITEMS.map(item => (
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
