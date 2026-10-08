'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { Button } from '@/components/ui/button'
import type { MatterDetailsRow } from '@/types/matter-details'
import { normalizeTargetSigningDate, targetSigningDateInput } from '@/lib/matterDates'
import { KeyDateEditor, type SlaAnchors } from '@/components/tasks/KeyDatesCard'

export function MatterKeyDates({ matterId, details, onSaveField }: {
  matterId: string
  details: MatterDetailsRow | null
  onSaveField: (field: keyof MatterDetailsRow, value: unknown) => Promise<void>
}) {
  const token = useAccessToken()
  const router = useRouter()
  const [anchors, setAnchors] = useState<SlaAnchors | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      const result = await apiRequest<{ anchors: SlaAnchors }>(`/api/matters/${matterId}/tasks`, { headers: { Authorization: `Bearer ${token}` } })
      setAnchors(result.anchors)
    } catch { setError('Key dates could not be loaded. Please retry.') }
  }, [matterId, token])
  useEffect(() => { void load() }, [load, details?.engagement_signed_at])
  async function save(patch: Partial<SlaAnchors>) {
    if (!token || saving) return
    setSaving(true); setError(null)
    try {
      const result = await apiRequest<{ anchors: SlaAnchors; rescheduled: number }>(`/api/admin/matters/${matterId}/sla-anchors`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      setAnchors(result.anchors)
      toast.success(result.rescheduled > 0 ? `Saved — ${result.rescheduled} tasks rescheduled` : 'Key date saved')
      router.refresh()
    } catch { setError('Date was not saved. The previous date has been restored; please try again.') }
    finally { setRevision(value => value + 1); setSaving(false) }
  }
  async function saveDetail(field: keyof MatterDetailsRow, value: string | null) {
    if (saving) return
    setSaving(true); setError(null)
    try {
      await onSaveField(field, field === 'scheduled_signing_date' && value ? normalizeTargetSigningDate(value) : value)
      router.refresh()
    } catch { setError('Date was not saved. The previous date has been restored; please try again.') }
    finally { setRevision(value => value + 1); setSaving(false) }
  }
  return <section aria-label="Key dates" className="space-y-3">
    <h3 className="text-sm font-semibold">Key dates</h3>
    <p className="text-xs text-muted-foreground">Enter MM/DD/YYYY or YYYY-MM-DD. Save when ready.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {anchors ? <KeyDateEditor key={`engagement-${revision}`} label="Engagement Signed" hint="Starts the matter task schedule"
        value={anchors.engagementSignedAt} saving={saving} onSave={value => void save({ engagementSignedAt: value })} />
        : !error && <p className="text-sm text-muted-foreground">Loading engagement date…</p>}
      {([
        { field: 'design_meeting_date', label: 'Design Meeting', hint: 'Meeting to confirm the plan design' },
        { field: 'scheduled_signing_date', label: 'Target Signing Date', hint: 'Planned signing date' },
        { field: 'signing_date', label: 'Signing Date', hint: 'Actual date the documents were signed' },
      ] as const).map(({ field, label, hint }) => <KeyDateEditor key={`${field}-${revision}-${details?.[field] ?? ''}`}
        label={label} hint={hint} value={targetSigningDateInput(details?.[field]) || null} saving={saving}
        onSave={value => void saveDetail(field, value)} />)}
    </div>
    {error && <div role="alert" className="text-sm text-destructive">{error}{!anchors && <Button variant="link" onClick={() => void load()}>Retry</Button>}</div>}
  </section>
}
