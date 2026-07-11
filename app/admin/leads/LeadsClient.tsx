'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel } from '@/lib/practiceArea'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface LeadRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  practice_area: string | null
  status: string | null
  intake_sent_at: string | null
  intake_completed_at: string | null
  engagement_status: string | null
  engagement_sent_at: string | null
  engagement_signed_at: string | null
  engagement_fee_quoted: number | null
  created_at: string | null
}

function leadName(lead: LeadRow): string {
  return (
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    lead.email ||
    'Lead'
  )
}

function IntakeStatusBadge({ lead }: { lead: LeadRow }) {
  if (lead.intake_completed_at || lead.status === 'completed') {
    return <Badge variant="outline" className="border-green/40 bg-green-bg text-[10px] text-green">Intake done</Badge>
  }
  if (lead.intake_sent_at) {
    return <Badge variant="outline" className="text-[10px]">Intake sent</Badge>
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Intake not sent</Badge>
}

function EngagementStatusBadge({ lead }: { lead: LeadRow }) {
  if (lead.engagement_status === 'signed') {
    return <Badge variant="outline" className="border-green/40 bg-green-bg text-[10px] text-green">Signed</Badge>
  }
  if (lead.engagement_status === 'declined') {
    return <Badge variant="outline" className="border-amber-border bg-amber-bg text-[10px] text-amber">Declined</Badge>
  }
  if (lead.engagement_sent_at) {
    return <Badge variant="outline" className="text-[10px]">Sent {formatDate(lead.engagement_sent_at)}</Badge>
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Not sent</Badge>
}

export function LeadsClient({
  initialLeads,
  esignEnabled,
}: {
  initialLeads: LeadRow[]
  esignEnabled: boolean
}) {
  const token = useAccessToken()
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '' })

  async function authedPost(path: string, body?: unknown): Promise<Record<string, unknown>> {
    if (!token) throw new Error('Not signed in')
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Request failed')
    return json
  }

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required')
      return
    }
    setCreating(true)
    try {
      const fee = form.fee.trim()
      await authedPost('/api/admin/leads', {
        clientName: form.name.trim(),
        clientEmail: form.email.trim(),
        clientPhone: form.phone.trim() || undefined,
        practiceArea: form.practiceArea,
        feeQuoted: fee === '' ? null : Number(fee),
      })
      toast.success('Lead added')
      setCreateOpen(false)
      setForm({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '' })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add lead')
    } finally {
      setCreating(false)
    }
  }

  const handleSendIntake = async (lead: LeadRow) => {
    setBusyLeadId(lead.id)
    try {
      await authedPost('/api/admin/intake/send', { intakeId: lead.id })
      toast.success(`Intake sent to ${lead.email}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send intake')
    } finally {
      setBusyLeadId(null)
    }
  }

  const handleSendEngagement = async (lead: LeadRow) => {
    setBusyLeadId(lead.id)
    try {
      await authedPost(`/api/admin/leads/${lead.id}/engagement`)
      toast.success(`Engagement sent to ${lead.email}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send engagement')
    } finally {
      setBusyLeadId(null)
    }
  }

  const handleConvert = async (lead: LeadRow) => {
    if (!window.confirm(`Create a matter for ${leadName(lead)} now?`)) return
    setBusyLeadId(lead.id)
    try {
      const result = await authedPost(`/api/admin/leads/${lead.id}/convert`)
      toast.success('Matter created')
      if (typeof result.matterId === 'string') {
        router.push(`/admin/matters/${result.matterId}`)
      } else {
        router.refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create matter')
      setBusyLeadId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New lead
        </Button>
      </div>

      {initialLeads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-12 text-center">
          <UserPlus className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No leads yet. Add one to send the intake and engagement agreement.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Practice</TableHead>
                <TableHead>Fee quoted</TableHead>
                <TableHead>Intake</TableHead>
                <TableHead>Engagement</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialLeads.map(lead => {
                const busy = busyLeadId === lead.id
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{leadName(lead)}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.email}</TableCell>
                    <TableCell>{practiceAreaLabel(lead.practice_area)}</TableCell>
                    <TableCell>
                      {lead.engagement_fee_quoted != null
                        ? `$${lead.engagement_fee_quoted.toLocaleString('en-US')}`
                        : '—'}
                    </TableCell>
                    <TableCell><IntakeStatusBadge lead={lead} /></TableCell>
                    <TableCell><EngagementStatusBadge lead={lead} /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() => void handleSendIntake(lead)}
                        >
                          {lead.intake_sent_at ? 'Resend intake' : 'Send intake'}
                        </Button>
                        {esignEnabled && lead.engagement_status !== 'signed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={busy}
                            onClick={() => void handleSendEngagement(lead)}
                          >
                            {lead.engagement_sent_at ? 'Resend engagement' : 'Send engagement'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() => void handleConvert(lead)}
                        >
                          Create matter
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>
              A lead becomes a matter when the engagement agreement is signed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Client name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
            <Input
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            />
            <Select
              value={form.practiceArea}
              onValueChange={value => setForm(f => ({ ...f, practiceArea: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRACTICE_AREA_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Quoted flat fee (optional)"
              value={form.fee}
              onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Adding…' : 'Add lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
