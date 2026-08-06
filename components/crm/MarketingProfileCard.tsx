'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Mail, UsersRound } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Profile = { marketing_status: 'unknown' | 'opted_in' | 'opted_out'; consent_source: string | null; consent_captured_at: string | null; unsubscribed_at: string | null; marketing_segment: string | null; topic_preferences: string[] | null; preferred_frequency: 'monthly' | 'quarterly' | 'as_needed' | null; duplicate_review_status: 'unreviewed' | 'reviewed' | 'merged' | null; last_engagement_at: string | null }

export function MarketingProfileCard({ intakeId }: { intakeId: string | null | undefined }) {
  const token = useAccessToken()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(Boolean(intakeId))
  const [saving, setSaving] = useState(false)
  const [duplicateCount, setDuplicateCount] = useState(0)
  useEffect(() => {
    if (!intakeId || !token) return
    fetch(`/api/admin/crm/profiles/${intakeId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(payload => { setProfile(payload?.profile ?? null); setDuplicateCount(payload?.duplicateCount ?? 0) })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [intakeId, token])
  if (!intakeId) return null
  const status = profile?.marketing_status ?? 'unknown'
  const update = async (changes: { marketingStatus?: Profile['marketing_status']; marketingSegment?: NonNullable<Profile['marketing_segment']>; topicPreferences?: string[]; preferredFrequency?: Profile['preferred_frequency']; duplicateReviewStatus?: NonNullable<Profile['duplicate_review_status']> }) => {
    if (!token) return
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/crm/profiles/${intakeId}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Could not update marketing consent')
      setProfile(payload.profile)
      toast.success(changes.marketingStatus === 'opted_in' ? 'Marketing consent recorded' : changes.marketingStatus === 'opted_out' ? 'Marketing consent removed' : 'Marketing preferences updated')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update marketing consent') } finally { setSaving(false) }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> Marketing</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <div className="flex items-center gap-2"><span className="text-muted-foreground">Consent</span><Badge variant={status === 'opted_in' ? 'default' : 'outline'}>{loading ? 'Loading' : status.replace('_', ' ')}</Badge></div>
      <p className="text-xs text-muted-foreground">Only explicit opt-in recipients can receive newsletters or nurture emails.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void update({ marketingStatus: 'opted_in' })} disabled={saving || status === 'opted_in'}>Record opt-in</Button>
        <Button size="sm" variant="outline" onClick={() => void update({ marketingStatus: 'opted_out' })} disabled={saving || status === 'opted_out'}>Opt out</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">Segment<select className="mt-1 w-full rounded border bg-background p-2 text-sm text-foreground" value={profile?.marketing_segment ?? 'prospect_nurture'} disabled={saving} onChange={event => void update({ marketingSegment: event.target.value as NonNullable<Profile['marketing_segment']> })}><option value="prospect_nurture">Prospect nurture</option><option value="client_newsletter">Client newsletter</option><option value="excluded">Excluded</option></select></label>
        <label className="text-xs text-muted-foreground">Frequency<select className="mt-1 w-full rounded border bg-background p-2 text-sm text-foreground" value={profile?.preferred_frequency ?? 'as_needed'} disabled={saving} onChange={event => void update({ preferredFrequency: event.target.value as Profile['preferred_frequency'] })}><option value="as_needed">As needed</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label>
      </div>
      {duplicateCount > 0 && <div className="flex items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"><span className="flex items-center gap-1"><UsersRound className="h-3.5 w-3.5" /> {duplicateCount} possible matching household{duplicateCount === 1 ? '' : 's'}</span><Button size="sm" variant="outline" disabled={saving || profile?.duplicate_review_status === 'reviewed'} onClick={() => void update({ duplicateReviewStatus: 'reviewed' })}>Mark reviewed</Button></div>}
    </CardContent>
  </Card>
}
