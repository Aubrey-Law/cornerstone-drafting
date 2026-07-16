'use client'

import { useEffect, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface MatterSearchOption {
  id: string
  label: string
  matterName: string | null
  email: string | null
  stage: string | null
}

export function MatterSearchPicker({
  id,
  label,
  headers,
  value,
  onChange,
}: {
  id: string
  label: string
  headers: HeadersInit
  value: string
  onChange: (matterId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MatterSearchOption[]>([])
  const [selected, setSelected] = useState<MatterSearchOption | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (!value) setSelected(null)
  }, [value])

  useEffect(() => {
    const trimmed = query.trim()
    if (selected || trimmed.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    const handle = window.setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const response = await fetch(
          `/api/admin/settings/document-templates/matters?q=${encodeURIComponent(trimmed)}`,
          { headers },
        )
        const body = await response.json().catch(() => ({})) as {
          error?: string
          matters?: MatterSearchOption[]
        }
        if (!response.ok) throw new Error(body.error ?? 'Matter search failed')
        setResults(body.matters ?? [])
      } catch (error) {
        setResults([])
        setSearchError(error instanceof Error ? error.message : 'Matter search failed')
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => window.clearTimeout(handle)
  }, [headers, query, selected])

  if (selected) {
    return (
      <div className="flex max-w-xl items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{selected.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[selected.matterName, selected.email, selected.stage].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Choose a different matter"
          onClick={() => {
            setSelected(null)
            setQuery('')
            onChange('')
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="relative max-w-xl space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id={id}
          className="pl-9"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search by client, matter name, or email"
          autoComplete="off"
        />
      </div>
      {query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {searching ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </p>
          ) : searchError ? (
            <p className="px-3 py-2 text-sm text-destructive">{searchError}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matching matters.</p>
          ) : results.map(matter => (
            <button
              key={matter.id}
              type="button"
              className="block w-full rounded-sm px-3 py-2 text-left hover:bg-accent"
              onClick={() => {
                setSelected(matter)
                setQuery('')
                setResults([])
                onChange(matter.id)
              }}
            >
              <span className="block truncate text-sm font-medium">{matter.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[matter.matterName, matter.email, matter.stage].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
