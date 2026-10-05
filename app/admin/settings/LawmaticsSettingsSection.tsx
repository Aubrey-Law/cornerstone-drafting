'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  LAWMATICS_PUSH_FIELDS, normalizeLawmaticsCustomFieldId, type LawmaticsOptionIdMap,
} from '@/lib/integrations/lawmatics/pushFields'
import { LawmaticsPicklistMapping, type LeadSourceRow } from './LawmaticsPicklistMapping'
import { Badge } from '@/components/ui/badge'
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

// Picklist fields (practice area, source, campaign) are sent only once matched below.
const STANDARD_FIELDS = LAWMATICS_PUSH_FIELDS.filter(field => field.standard && !field.option)
const EMPTY_OPTION_MAP: LawmaticsOptionIdMap = { practice_area: {}, source: {}, campaign: {} }
const CUSTOM_FIELDS = LAWMATICS_PUSH_FIELDS.filter(field => !field.standard)

type ConnectionStatus = { connected: boolean; updatedAt: string | null; error?: string }

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  return CUSTOM_FIELDS.every(field => (a[field.key] ?? '').trim() === (b[field.key] ?? '').trim())
}

/** Settings → Lawmatics: connection status and the Push to Lawmatics custom field mapping. */
export function LawmaticsSettingsSection() {
  const token = useAccessToken()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [optionIdMap, setOptionIdMap] = useState<LawmaticsOptionIdMap>(EMPTY_OPTION_MAP)
  const [leadSources, setLeadSources] = useState<LeadSourceRow[]>([])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [settingsRes, statusRes] = await Promise.all([
        fetch('/api/admin/settings/lawmatics', { headers }),
        fetch('/api/lawmatics/status', { headers }),
      ])
      const settings = await settingsRes.json().catch(() => ({}))
      if (!settingsRes.ok) throw new Error(settings.error ?? 'Failed to load Lawmatics settings')
      const map = (settings.customFieldIdMap ?? {}) as Record<string, string>
      setSaved(map)
      setDrafts(map)
      setOptionIdMap((settings.optionIdMap ?? EMPTY_OPTION_MAP) as LawmaticsOptionIdMap)
      setLeadSources(Array.isArray(settings.leadSources) ? settings.leadSources as LeadSourceRow[] : [])
      setConnection(statusRes.ok ? await statusRes.json() : null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load Lawmatics settings')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => !sameMap(saved, drafts), [saved, drafts])
  const mappedCount = CUSTOM_FIELDS.filter(field => normalizeLawmaticsCustomFieldId(saved[field.key] ?? '')).length
  const invalidKeys = new Set(CUSTOM_FIELDS
    .filter(field => (drafts[field.key] ?? '').trim() && !normalizeLawmaticsCustomFieldId(drafts[field.key]))
    .map(field => field.key))

  async function save() {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/lawmatics', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // Only current custom keys: a field that later became standard is not mappable.
        body: JSON.stringify({
          customFieldIdMap: Object.fromEntries(CUSTOM_FIELDS.map(field => [field.key, drafts[field.key] ?? ''])),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Save failed')
      const map = (body.customFieldIdMap ?? {}) as Record<string, string>
      setSaved(map)
      setDrafts(map)
      toast.success('Lawmatics field mapping saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Lawmatics settings…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Lawmatics connection</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Push to Lawmatics, Lawmatics import, and appointment sync all use this connection.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connection?.connected ? 'secondary' : 'outline'}>
              {connection?.connected ? 'Connected' : 'Not connected'}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => { window.location.href = '/api/lawmatics/connect' }}
            >
              {connection?.connected ? 'Reconnect' : 'Connect Lawmatics'}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="text-sm font-semibold">Push to Lawmatics — field mapping</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These fields are always sent to the matching Lawmatics field: {STANDARD_FIELDS.map(field => field.label).join(', ')}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lawmatics only stores the fields below in custom fields your firm creates. Paste each field&apos;s Lawmatics
            custom field ID here: the number in its merge field on Lawmatics&apos; document reference page, so{' '}
            <span className="font-mono">{'{{custom_field_930886}}'}</span> is <span className="font-mono">930886</span>.
            Fields left blank are skipped on push, and the push confirmation lists them.{' '}
            {mappedCount} of {CUSTOM_FIELDS.length} mapped.
          </p>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cornerstone field</TableHead>
              <TableHead>Lawmatics custom field ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CUSTOM_FIELDS.map(field => {
              const inputId = `lawmatics-field-${field.key}`
              const invalid = invalidKeys.has(field.key)
              return (
                <TableRow key={field.key}>
                  <TableCell>
                    <label htmlFor={inputId} className="font-medium">{field.label}</label>
                    <p className="font-mono text-micro text-muted-foreground">{field.key}</p>
                  </TableCell>
                  <TableCell>
                    <Input
                      id={inputId}
                      className="h-8 max-w-xs font-mono text-xs"
                      value={drafts[field.key] ?? ''}
                      onChange={e => setDrafts(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder="Not mapped"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={invalid || undefined}
                      aria-describedby={invalid ? `${inputId}-error` : undefined}
                    />
                    {invalid && (
                      <p id={`${inputId}-error`} className="mt-1 text-xs text-destructive">
                        Not a custom field ID. Use the number from its merge field, e.g.{' '}
                        <span className="font-mono">930886</span> from{' '}
                        <span className="font-mono">{'{{custom_field_930886}}'}</span>. Built-in fields like{' '}
                        <span className="font-mono">{'{{practice_area}}'}</span>{' '}can&apos;t be mapped here.
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={!dirty || saving} onClick={() => setDrafts(saved)}>
            Discard changes
          </Button>
          <Button type="button" size="sm" disabled={!dirty || saving || invalidKeys.size > 0} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Save mapping
          </Button>
        </div>
      </section>

      {token && (
        <LawmaticsPicklistMapping
          token={token}
          saved={optionIdMap}
          leadSources={leadSources}
          onSaved={setOptionIdMap}
        />
      )}
    </div>
  )
}
