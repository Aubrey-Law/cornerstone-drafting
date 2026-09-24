'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LawmaticsOptionIdMap, LawmaticsOptionKind } from '@/lib/integrations/lawmatics/pushFields'
import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type LeadSourceRow = { key: string; label: string; count: number }

type OptionList = { ok: true; options: { id: string; name: string }[] } | { ok: false; error: string }
type OptionLists = Partial<Record<LawmaticsOptionKind, OptionList>>

const KIND_LABELS: Record<LawmaticsOptionKind, string> = {
  practice_area: 'practice areas',
  source: 'sources',
  campaign: 'campaigns',
}

function clone(map: LawmaticsOptionIdMap): LawmaticsOptionIdMap {
  return { practice_area: { ...map.practice_area }, source: { ...map.source }, campaign: { ...map.campaign } }
}

function sameMap(a: LawmaticsOptionIdMap, b: LawmaticsOptionIdMap): boolean {
  return (Object.keys(a) as LawmaticsOptionKind[]).every(kind => {
    const keys = new Set([...Object.keys(a[kind]), ...Object.keys(b[kind])])
    return [...keys].every(key => (a[kind][key] ?? '').trim() === (b[kind][key] ?? '').trim())
  })
}

const MANUAL = '__manual__'

/**
 * Picks a Lawmatics option for one Cornerstone value: a dropdown of the firm's
 * options when Lawmatics returned them, otherwise a box for the numeric ID.
 * The dropdown can switch to the ID box for options Lawmatics doesn't list
 * (archived or inactive ones, for example).
 */
function OptionPicker({ list, value, onChange, label }: {
  list: OptionList | undefined
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const [manual, setManual] = useState(false)
  if (list?.ok && !manual) {
    const known = list.options.some(option => option.id === value)
    return (
      <select
        className="h-8 w-full max-w-xs rounded-md border border-input bg-background px-2 text-xs"
        value={value}
        onChange={event => {
          if (event.target.value === MANUAL) setManual(true)
          else onChange(event.target.value)
        }}
        aria-label={label}
      >
        <option value="">Not matched</option>
        {!known && value && <option value={value}>ID {value} (not in Lawmatics list)</option>}
        {list.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        <option value={MANUAL}>Not listed — enter ID…</option>
      </select>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 max-w-xs font-mono text-xs"
        value={value}
        onChange={event => onChange(event.target.value.replace(/[^\d]/g, ''))}
        placeholder={list ? 'Lawmatics ID' : 'Loading…'}
        inputMode="numeric"
        aria-label={label}
        autoComplete="off"
      />
      {list?.ok && (
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setManual(false)}>
          Pick from list
        </Button>
      )}
    </div>
  )
}

/** Settings → Lawmatics: match Cornerstone practice areas and lead sources to Lawmatics picklist options. */
export function LawmaticsPicklistMapping({ token, saved, leadSources, onSaved }: {
  token: string
  saved: LawmaticsOptionIdMap
  leadSources: LeadSourceRow[]
  onSaved: (map: LawmaticsOptionIdMap) => void
}) {
  const [drafts, setDrafts] = useState<LawmaticsOptionIdMap>(() => clone(saved))
  const [lists, setLists] = useState<OptionLists>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDrafts(clone(saved)) }, [saved])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/settings/lawmatics/options', { headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json().catch(() => ({}))
        if (!cancelled) setLists(res.ok ? body as OptionLists : {
          practice_area: { ok: false, error: 'Lawmatics lists could not be loaded.' },
          source: { ok: false, error: 'Lawmatics lists could not be loaded.' },
          campaign: { ok: false, error: 'Lawmatics lists could not be loaded.' },
        })
      } catch {
        if (!cancelled) setLists({
          practice_area: { ok: false, error: 'Lawmatics lists could not be loaded.' },
          source: { ok: false, error: 'Lawmatics lists could not be loaded.' },
          campaign: { ok: false, error: 'Lawmatics lists could not be loaded.' },
        })
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const dirty = useMemo(() => !sameMap(saved, drafts), [saved, drafts])
  const failures = (Object.entries(lists) as [LawmaticsOptionKind, OptionList][])
    .filter(([, list]) => !list.ok)
    .map(([kind]) => KIND_LABELS[kind])

  function set(kind: LawmaticsOptionKind, key: string, value: string) {
    setDrafts(current => ({ ...current, [kind]: { ...current[kind], [key]: value } }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/lawmatics', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIdMap: drafts }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      onSaved(body.optionIdMap as LawmaticsOptionIdMap)
      toast.success('Lawmatics picklist matching saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Push to Lawmatics — practice area, source and campaign</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These are dropdowns in Lawmatics, so each Cornerstone value is matched to one of your Lawmatics options.
          Values left unmatched are not sent, and Lawmatics keeps whatever it already has.
        </p>
        {failures.length > 0 && (
          <p className="mt-1 text-xs text-amber-strong">
            Your Lawmatics {failures.join(', ')} couldn&apos;t be loaded, so enter those option IDs by hand. The ID is
            usually the number in the address bar when you edit the option in Lawmatics settings.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Practice area</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cornerstone practice area</TableHead>
              <TableHead>Lawmatics practice area</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PRACTICE_AREA_OPTIONS.map(area => (
              <TableRow key={area.value}>
                <TableCell className="font-medium">{area.label}</TableCell>
                <TableCell>
                  <OptionPicker
                    list={lists.practice_area}
                    value={drafts.practice_area[area.value] ?? ''}
                    onChange={value => set('practice_area', area.value, value)}
                    label={`Lawmatics practice area for ${area.label}`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead source</h3>
        <p className="text-xs text-muted-foreground">
          Each lead source used in Cornerstone can set both the Lawmatics Source and the Lawmatics Campaign.
          If a Lawmatics option is missing from a list, pick &ldquo;Not listed — enter ID…&rdquo; and type its ID.
        </p>
        {leadSources.length === 0 ? (
          <p className="text-xs text-muted-foreground">No leads have a lead source yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cornerstone lead source</TableHead>
                <TableHead>Lawmatics source</TableHead>
                <TableHead>Lawmatics campaign</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadSources.map(source => (
                <TableRow key={source.key}>
                  <TableCell>
                    <span className="font-medium">{source.label}</span>
                    <p className="text-micro text-muted-foreground">{source.count} {source.count === 1 ? 'lead' : 'leads'}</p>
                  </TableCell>
                  <TableCell>
                    <OptionPicker
                      list={lists.source}
                      value={drafts.source[source.key] ?? ''}
                      onChange={value => set('source', source.key, value)}
                      label={`Lawmatics source for ${source.label}`}
                    />
                  </TableCell>
                  <TableCell>
                    <OptionPicker
                      list={lists.campaign}
                      value={drafts.campaign[source.key] ?? ''}
                      onChange={value => set('campaign', source.key, value)}
                      label={`Lawmatics campaign for ${source.label}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => setDrafts(clone(saved))}>
          Discard changes
        </Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Save matching
        </Button>
      </div>
    </section>
  )
}
