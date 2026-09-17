'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronsUpDown, Pin } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useSharedSidebarMatters } from '@/lib/matters/SidebarMattersContext'
import { useMatterSearch } from '@/lib/matters/useMatterSearch'

export function MatterSwitcher({ matterId, label }: { matterId: string; label: string }) {
  const shortcuts = useSharedSidebarMatters()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const search = useMatterSearch(query, open)
  const choose = (id: string) => { setOpen(false); setQuery(''); router.push(`/admin/matters/${id}`) }
  return (
    <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery('') }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Switch matter: ${label}`} className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-1 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="truncate">{label}</span><ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label="Switch matter">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Find a matter…" value={query} onValueChange={setQuery} />
          <CommandList>
            {search.error && <p role="alert" className="p-3 text-sm text-destructive">{search.error}</p>}
            <CommandEmpty>{search.searching || (!query && shortcuts?.loading) ? 'Loading matters…' : 'No matters found.'}</CommandEmpty>
            {query.trim() ? (
              <CommandGroup heading="Search results">{search.matters.map(item => <CommandItem key={item.matter_id} value={item.matter_id} onSelect={() => choose(item.matter_id)}><span className="truncate">{item.client_name || item.matter_name || 'Untitled'}</span>{item.matter_id === matterId && <span className="ml-auto text-xs text-muted-foreground">Current</span>}</CommandItem>)}</CommandGroup>
            ) : (
              <>{(['pinned', 'recent'] as const).map(kind => (shortcuts?.[kind]?.length ?? 0) > 0 && <CommandGroup key={kind} heading={kind === 'pinned' ? 'Pinned' : 'Recent'}>{shortcuts?.[kind].map(item => <CommandItem key={item.matter_id} value={item.matter_id} onSelect={() => choose(item.matter_id)}>
                {kind === 'pinned' && <Pin className="size-3" aria-hidden />}<span className="min-w-0 flex-1"><span className="block truncate">{item.title}</span>{item.matter_number && <span className="text-xs text-muted-foreground">{item.matter_number}</span>}</span>{item.matter_id === matterId && <span className="text-xs text-muted-foreground">Current</span>}
              </CommandItem>)}</CommandGroup>)}</>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
