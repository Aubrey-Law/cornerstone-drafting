'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import type { StageSlaRow } from '@/lib/queries/pipelineAging'
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

export function PipelineSlaSettings() {
  const token = useAccessToken()
  const [rows, setRows] = useState<StageSlaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, { sla_days: string; escalation_offset: string; cumulative_sla_days: string }>>({})

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/stage-sla', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load SLA settings')
      const data = await res.json()
      const loaded = (data.rows ?? []) as StageSlaRow[]
      setRows(loaded)
      setDrafts(
        Object.fromEntries(
          loaded.map(r => [
            `${r.entity}:${r.stage_key}:${r.track}`,
            {
              sla_days: r.sla_days == null ? '' : String(r.sla_days),
              escalation_offset: r.escalation_offset == null ? '' : String(r.escalation_offset),
              cumulative_sla_days: r.cumulative_sla_days == null ? '' : String(r.cumulative_sla_days),
            },
          ]),
        ),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load SLA settings')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function saveRow(row: StageSlaRow) {
    if (!token) return
    const key = `${row.entity}:${row.stage_key}:${row.track}`
    const draft = drafts[key]
    if (!draft) return

    const slaDays = draft.sla_days.trim() === '' ? null : Number(draft.sla_days)
    const escalationOffset = draft.escalation_offset.trim() === '' ? null : Number(draft.escalation_offset)
    const cumulativeSlaDays =
      draft.cumulative_sla_days.trim() === '' ? null : Number(draft.cumulative_sla_days)

    if (slaDays != null && (!Number.isFinite(slaDays) || slaDays < 0)) {
      toast.error('SLA days must be a non-negative number or blank')
      return
    }
    if (escalationOffset != null && (!Number.isFinite(escalationOffset) || escalationOffset < 0)) {
      toast.error('Escalation offset must be a non-negative number or blank')
      return
    }
    if (cumulativeSlaDays != null && (!Number.isFinite(cumulativeSlaDays) || cumulativeSlaDays < 0)) {
      toast.error('Total days must be a non-negative number or blank')
      return
    }

    setSavingKey(key)
    try {
      const res = await fetch('/api/admin/settings/stage-sla', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stage_key: row.stage_key,
          track: row.track,
          entity: row.entity,
          sla_days: slaDays,
          escalation_offset: escalationOffset,
          cumulative_sla_days: cumulativeSlaDays,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      const body = await res.json()
      const updated = body.row as StageSlaRow
      setRows(prev =>
        prev.map(r => (r.entity === updated.entity && r.stage_key === updated.stage_key && r.track === updated.track ? updated : r)),
      )
      toast.success('SLA updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading SLA settings…
      </div>
    )
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Pipeline stage SLA</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Business-day thresholds for the DEFAULT track. Blank SLA means no deadline.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>SLA days</TableHead>
            <TableHead>Escalation</TableHead>
            <TableHead>Total days</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const key = `${row.entity}:${row.stage_key}:${row.track}`
            const draft = drafts[key]
            const dirty =
              draft &&
              (draft.sla_days !== (row.sla_days == null ? '' : String(row.sla_days)) ||
                draft.escalation_offset !==
                  (row.escalation_offset == null ? '' : String(row.escalation_offset)) ||
                draft.cumulative_sla_days !==
                  (row.cumulative_sla_days == null ? '' : String(row.cumulative_sla_days)))

            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{engineStageLabel(row.stage_key)}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{row.entity}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{row.owner}</TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-20"
                    inputMode="numeric"
                    value={draft?.sla_days ?? ''}
                    onChange={e =>
                      setDrafts(prev => ({
                        ...prev,
                        [key]: { ...prev[key], sla_days: e.target.value },
                      }))
                    }
                    placeholder="—"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-20"
                    inputMode="numeric"
                    value={draft?.escalation_offset ?? ''}
                    onChange={e =>
                      setDrafts(prev => ({
                        ...prev,
                        [key]: { ...prev[key], escalation_offset: e.target.value },
                      }))
                    }
                    placeholder="—"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-8 w-20"
                    inputMode="numeric"
                    value={draft?.cumulative_sla_days ?? ''}
                    onChange={e =>
                      setDrafts(prev => ({
                        ...prev,
                        [key]: { ...prev[key], cumulative_sla_days: e.target.value },
                      }))
                    }
                    placeholder="—"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!dirty || savingKey === key}
                    onClick={() => void saveRow(row)}
                  >
                    {savingKey === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}
