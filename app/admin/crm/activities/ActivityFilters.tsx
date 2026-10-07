'use client'
import { useEffect, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import type { ActivityFilters as Filters } from '@/lib/activities/feed'
import { ACTIVITY_SOURCES } from '@/lib/activities/feed'

function Lookup({ name, label, initial }: { name: 'record' | 'person' | 'actor'; label: string; initial: string }) {
  const token = useAccessToken()
  const [search, setSearch] = useState('')
  const [value, setValue] = useState(initial)
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState(false)
  useEffect(() => { setValue(initial) }, [initial])
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const url = name === 'record' ? `/api/admin/tasks/records?q=${encodeURIComponent(search)}` : `/api/admin/activities/options?kind=${name}&q=${encodeURIComponent(search)}`
        const response = await fetch(url, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
        if (!response.ok) throw new Error()
        const data = await response.json()
        setOptions(data.options ?? data.records ?? [])
        setError(false)
      } catch { if (!controller.signal.aborted) setError(true) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [name, search, token])
  return <fieldset className="min-w-40 space-y-1"><legend className="text-xs font-medium">{label}</legend>
    <input aria-label={`Search ${label.toLowerCase()}`} className="w-full rounded border bg-background p-2 text-sm" placeholder={`Search ${label.toLowerCase()}…`} value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-label={label} name={name} value={value} onChange={event => setValue(event.target.value)} className="w-full max-w-64 rounded border bg-background p-2 text-sm"><option value="">All</option>{value && !options.some(option => option.id === value) && <option value={value}>Selected {label.toLowerCase()}</option>}{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
    {error && <p role="status" className="text-xs text-destructive">Search unavailable. Try again.</p>}
  </fieldset>
}
export function ActivityFilters({ filters }: { filters: Filters }) {
  return <form action="/admin/crm/activities" className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
    <Lookup name="record" label="Record" initial={filters.record} />
    <Lookup name="person" label="Person" initial={filters.person} />
    <Lookup name="actor" label="Actor" initial={filters.actor} />
    <label className="space-y-1 text-xs">Source<select name="source" defaultValue={filters.source} className="block rounded border bg-background p-2 text-sm"><option value="">All sources</option>{ACTIVITY_SOURCES.map(source => <option key={source} value={source}>{source === 'crm' ? 'CRM' : source[0].toUpperCase() + source.slice(1)}</option>)}</select></label>
    <label className="space-y-1 text-xs">Event type<select name="event" defaultValue={filters.event} className="block rounded border bg-background p-2 text-sm"><option value="">All events</option>{[['task_created', 'Task added'], ['task_completed', 'Task completed'], ['draft_generation_started', 'Document generation'], ['review_started', 'Document review'], ['field_audit_started', 'Field audit'], ['proofread_started', 'Proofreading'], ['issues_started', 'Issue spotting'], ['note', 'Note added'], ['stage_changed', 'Stage changed'], ['email_sent', 'Email sent'], ['sms_sent', 'Text sent']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}{filters.event && <option value={filters.event}>{filters.event.replaceAll('_', ' ')}</option>}</select></label>
    <label className="space-y-1 text-xs">From<input type="date" name="from" defaultValue={filters.from} className="block rounded border bg-background p-2 text-sm" /></label>
    <label className="space-y-1 text-xs">Through<input type="date" name="to" defaultValue={filters.to} className="block rounded border bg-background p-2 text-sm" /></label>
    <Button type="submit" size="sm">Apply filters</Button><a href="/admin/crm/activities" className="p-2 text-sm underline">Clear</a>
  </form>
}
