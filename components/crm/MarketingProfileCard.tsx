'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Profile = { marketing_status: 'unknown' | 'opted_in' | 'opted_out'; consent_source: string | null; consent_captured_at: string | null; unsubscribed_at: string | null; marketing_segment: string | null; last_engagement_at: string | null }

export function MarketingProfileCard({ intakeId }: { intakeId: string | null | undefined }) {
  const token = useAccessToken()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(Boolean(intakeId))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!intakeId || !token) return
    fetch(`/api/admin/crm/profiles/${intakeId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(payload => setProfile(payload?.profile ?? null))
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [intakeId, token])
  if (!intakeId) return null
  const status = profile?.marketing_status ?? 'unknown'
  const update = async (marketingStatus: Profile['marketing_status']) => {
    if (!token) return
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/crm/profiles/${intakeId}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ marketingStatus }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Could not update marketing consent')
      setProfile(payload.profile)
      toast.success(marketingStatus === 'opted_in' ? 'Marketing consent recorded' : 'Marketing consent removed')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update marketing consent') } finally { setSaving(false) }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" /> Marketing</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <div className="flex items-center gap-2"><span className="text-muted-foreground">Consent</span><Badge variant={status === 'opted_in' ? 'default' : 'outline'}>{loading ? 'Loading' : status.replace('_', ' ')}</Badge></div>
      <p className="text-xs text-muted-foreground">Only explicit opt-in recipients can receive newsletters or nurture emails.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void update('opted_in')} disabled={saving || status === 'opted_in'}>Record opt-in</Button>
        <Button size="sm" variant="outline" onClick={() => void update('opted_out')} disabled={saving || status === 'opted_out'}>Opt out</Button>
      </div>
    </CardContent>
  </Card>
}
