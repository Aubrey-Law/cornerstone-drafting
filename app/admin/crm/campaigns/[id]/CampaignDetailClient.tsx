'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Check, Mail, Pause, Play, RefreshCw, Send, Square } from 'lucide-react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { CrmCampaignListItem, getLifecycleLabel } from '@/lib/queries/cornerstoneCrm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/lib/utils'

type CampaignAction = 'queue' | 'run' | 'sendAll'

type CampaignRunPayload = {
  campaignId: string
  sent: number
  failed: number
  processed: number
  nextQueued: number
}

type CampaignQueuePayload = {
  campaignId: string
  queued: number
  added: number
  updated: number
}

interface CrmCampaignDetailClientProps {
  initialCampaign: CrmCampaignListItem
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function CrmCampaignDetailClient({ initialCampaign }: CrmCampaignDetailClientProps) {
  const router = useRouter()
  const token = useAccessToken()
  const [campaign, setCampaign] = useState(initialCampaign)
  const [runLimit, setRunLimit] = useState(200)
  const [busy, setBusy] = useState<CampaignAction | null>(null)

  const statusLabel = useMemo(() => {
    const map: Record<CrmCampaignListItem['status'], string> = {
      draft: 'Draft',
      scheduled: 'Scheduled',
      running: 'Running',
      paused: 'Paused',
      completed: 'Completed',
      cancelled: 'Cancelled',
    }
    return map[campaign.status]
  }, [campaign.status])

  const lifecycleLabel = useMemo(() => {
    const lifecycle = campaign.audienceRules.lifecycleStatuses
      .filter(item => item !== 'all')
      .map(item => getLifecycleLabel(item))
    return lifecycle.length ? lifecycle.join(', ') : 'All'
  }, [campaign.audienceRules.lifecycleStatuses])

  const apiRequest = async (url: string, init: RequestInit = {}) => {
    if (!token) {
      toast.error('Not signed in')
      return null
    }

    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  }

  const patchCampaignStatus = async (status: 'running' | 'paused' | 'completed' | 'cancelled') => {
    if (!token) return false
    const response = await apiRequest(`/api/admin/crm/campaigns/${campaign.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })

    const payload = await response?.json().catch(() => null)
    if (!response?.ok) {
      toast.error(payload?.error ?? `Could not set campaign ${status}`)
      return false
    }

    setCampaign(current => ({
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    }))
    toast.success(`Campaign ${status}`)
    return true
  }

  const runCampaignAction = async (action: CampaignAction) => {
    if (!token) return
    const id = campaign.id
    const url = `/api/admin/crm/campaigns/${id}/${action}`
    const body = action === 'run' ? { limit: Math.max(1, Math.min(runLimit, 500)) } : undefined

    setBusy(action)
    try {
      const response = await apiRequest(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = await response?.json().catch(() => null)

      if (!response?.ok) {
        toast.error(payload?.error ?? `Failed to ${action} campaign`)
        return
      }

      if (action === 'queue') {
        const queuePayload = payload as CampaignQueuePayload
        setCampaign(current => ({
          ...current,
          status: queuePayload?.queued ? 'running' : 'draft',
          recipientCounts: {
            ...current.recipientCounts,
            total: queuePayload?.queued ?? current.recipientCounts.total,
            queued: queuePayload?.queued ?? current.recipientCounts.queued,
          },
        }))
        toast.success(`Queued ${queuePayload?.queued ?? 0} recipients`)
      } else {
        const runPayload = payload as CampaignRunPayload
        setCampaign(current => ({
          ...current,
          status: (runPayload.nextQueued ?? 0) > 0 ? 'running' : 'completed',
          recipientCounts: {
            ...current.recipientCounts,
            sent: current.recipientCounts.sent + (runPayload?.sent ?? 0),
            failed: current.recipientCounts.failed + (runPayload?.failed ?? 0),
            queued: typeof runPayload?.nextQueued === 'number'
              ? runPayload.nextQueued
              : Math.max(0, current.recipientCounts.queued - (runPayload?.processed ?? 0)),
          },
          updatedAt: new Date().toISOString(),
        }))
        toast.success(`Sent ${runPayload?.sent ?? 0} messages (failed ${runPayload?.failed ?? 0})`)
      }

      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${action} failed`)
    } finally {
      setBusy(null)
    }
  }

  const sendRemainingCampaign = async () => {
    if (!token) return
    if (!campaign.recipientCounts.queued) {
      toast.info('No queued recipients remain.')
      return
    }

    setBusy('sendAll')
    let nextQueued = campaign.recipientCounts.queued
    let sends = 0
    let fails = 0
    let loops = 0

    try {
      while (nextQueued > 0 && loops < 100) {
        const response = await apiRequest(`/api/admin/crm/campaigns/${campaign.id}/run`, {
          method: 'POST',
          body: JSON.stringify({ limit: 500 }),
        })
        const payload = await response?.json().catch(() => null)
        if (!response?.ok) {
          toast.error(payload?.error ?? 'Failed to send remaining campaign')
          break
        }

        const runPayload = payload as CampaignRunPayload
        sends += runPayload?.sent ?? 0
        fails += runPayload?.failed ?? 0
        nextQueued = typeof runPayload?.nextQueued === 'number' ? runPayload.nextQueued : 0

        setCampaign(current => ({
          ...current,
          status: nextQueued > 0 ? 'running' : 'completed',
          recipientCounts: {
            ...current.recipientCounts,
            sent: current.recipientCounts.sent + (runPayload?.sent ?? 0),
            failed: current.recipientCounts.failed + (runPayload?.failed ?? 0),
            queued: nextQueued,
          },
          updatedAt: new Date().toISOString(),
        }))

        loops += 1
        if (nextQueued > 0) await sleep(200)
      }

      if (nextQueued > 0 && loops >= 100) {
        toast.warning('Stopped after 100 passes. Refresh and continue sending to clear the rest.')
      } else {
        toast.success(`Send-all complete. Sent ${sends}, failed ${fails}.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Send all failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={campaign.name}
        eyebrow={campaignTypeLabel(campaign.type)}
        icon={Mail}
        description={campaign.subject ?? 'No subject set'}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/admin/crm/campaigns">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Campaign settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge>{campaign.type}</Badge>
              <Badge variant="outline">{statusLabel}</Badge>
            </div>
            <p><span className="text-muted-foreground">Subject:</span> {campaign.subject || 'No subject'}</p>
            <p><span className="text-muted-foreground">Provider:</span> {campaign.emailProvider}</p>
            <p><span className="text-muted-foreground">Audience:</span> {lifecycleLabel}</p>
            <p>
              <span className="text-muted-foreground">Search:</span>{' '}
              {campaign.audienceRules.search || '—'}
            </p>
            <p><span className="text-muted-foreground">Updated:</span> {formatDateTime(campaign.updatedAt)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Total recipients: {campaign.recipientCounts.total}</p>
            <p>Queued: {campaign.recipientCounts.queued}</p>
            <p>Sent: {campaign.recipientCounts.sent}</p>
            <p>Failed: {campaign.recipientCounts.failed}</p>
            <p>Opened: {campaign.recipientCounts.opened}</p>
            <p>Clicked: {campaign.recipientCounts.clicked}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="run-limit">Send batch limit</Label>
            <Input
              id="run-limit"
              type="number"
              min={1}
              max={500}
              value={runLimit}
              onChange={event => setRunLimit(Math.max(1, Number(event.target.value) || 1))}
            />
            <p className="text-xs text-muted-foreground">Max 500 recipients per run invocation.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patchCampaignStatus('paused')}
              disabled={
                !token
                || busy !== null
                || campaign.status === 'paused'
                || campaign.status === 'cancelled'
                || campaign.status === 'completed'
              }
            >
              <Pause className="mr-1 h-4 w-4" />
              Pause
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patchCampaignStatus('running')}
              disabled={!token || busy !== null || campaign.status !== 'paused'}
            >
              <Play className="mr-1 h-4 w-4" />
              Resume
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patchCampaignStatus('cancelled')}
              disabled={
                !token
                || busy !== null
                || campaign.status === 'cancelled'
                || campaign.status === 'completed'
              }
            >
              <Square className="mr-1 h-4 w-4" />
              Cancel
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => void runCampaignAction('queue')}
              disabled={!token || busy === 'queue' || campaign.status === 'cancelled'}
            >
              {busy === 'queue' ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              Queue recipients now
            </Button>
            <Button
              size="sm"
              onClick={() => void runCampaignAction('run')}
              disabled={!token || busy === 'run' || !campaign.recipientCounts.queued}
            >
              {busy === 'run' ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Send next {runLimit}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void sendRemainingCampaign()}
              disabled={!token || busy !== null || !campaign.recipientCounts.queued}
            >
              {busy === 'sendAll' ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              Send all remaining
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Body preview</CardTitle>
        </CardHeader>
        <CardContent>
          {campaign.bodyText ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted p-3 text-xs">{campaign.bodyText}</pre>
          ) : (
            <EmptyState
              icon={Mail}
              title="No body yet"
              description="Add a body before sending to avoid empty emails."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function campaignTypeLabel(type: CrmCampaignListItem['type']) {
  return type === 'newsletter' ? 'Newsletter' : 'Nurture'
}
