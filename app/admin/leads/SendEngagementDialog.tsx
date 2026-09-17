'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
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
import type { LeadRow } from './LeadsClient'

function leadName(lead: LeadRow): string {
  return (
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    lead.email ||
    ''
  )
}

/**
 * Collects both signers before sending the engagement. A spouse (optional)
 * makes it a two-signer (joint) send; blank keeps it single-signer. "Sign now"
 * additionally opens the primary signer's link via onSignNow.
 */
export function SendEngagementDialog({
  lead,
  onOpenChange,
  onSent,
  onSignNow,
}: {
  lead: LeadRow | null
  onOpenChange: (open: boolean) => void
  onSent: () => void
  onSignNow: (signingLink: string) => void
}) {
  const token = useAccessToken()
  const [form, setForm] = useState({ name: '', email: '', spouseName: '', spouseEmail: '', fee: '' })
  const [busy, setBusy] = useState<null | 'email' | 'sign'>(null)
  const feeRequired = lead !== null && lead.engagement_fee_quoted == null

  useEffect(() => {
    if (!lead) return
    setForm({
      name: leadName(lead),
      email: lead.email ?? '',
      spouseName: '',
      spouseEmail: '',
      fee: lead.engagement_fee_quoted != null ? String(lead.engagement_fee_quoted) : '',
    })
  }, [lead])

  const submit = async (mode: 'email' | 'sign') => {
    if (!token || !lead) return
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Client name and email are required')
      return
    }
    const spouseName = form.spouseName.trim()
    const spouseEmail = form.spouseEmail.trim()
    if (Boolean(spouseName) !== Boolean(spouseEmail)) {
      toast.error('Enter both the spouse name and email, or leave both blank')
      return
    }
    // A lead with no fee on file must get one here — otherwise the quoted
    // pipeline stays at $0 because nothing else captures it.
    if (feeRequired && !(Number(form.fee.trim()) > 0)) {
      toast.error('Enter the quoted flat fee before sending')
      return
    }
    setBusy(mode)
    try {
      const fee = form.fee.trim()
      const res = await fetch(`/api/admin/leads/${lead.id}/engagement`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryName: form.name.trim(),
          primaryEmail: form.email.trim(),
          spouseName: spouseName || undefined,
          spouseEmail: spouseEmail || undefined,
          feeQuoted: fee === '' ? null : Number(fee),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; signingLink?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not send engagement')

      if (mode === 'sign') {
        if (json.signingLink) {
          onOpenChange(false)
          onSignNow(json.signingLink)
          return
        }
        toast.message('Engagement sent by email', {
          description: 'In-app signing was unavailable; the signing link was emailed instead.',
        })
      } else {
        toast.success(spouseName ? 'Engagement sent to both signers' : `Engagement sent to ${form.email.trim()}`)
      }
      onOpenChange(false)
      onSent()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send engagement')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={lead !== null} onOpenChange={open => !open && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send engagement agreement</DialogTitle>
          <DialogDescription>
            Add a spouse to send a joint (two-signer) engagement. Leave the spouse blank for a solo
            client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
              Client
            </span>
            <Input
              placeholder="Client name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Client email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
              Spouse (optional)
            </span>
            <Input
              placeholder="Spouse name"
              value={form.spouseName}
              onChange={e => setForm(f => ({ ...f, spouseName: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Spouse email"
              value={form.spouseEmail}
              onChange={e => setForm(f => ({ ...f, spouseEmail: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
              {feeRequired ? 'Quoted flat fee' : 'Quoted flat fee (optional)'}
            </span>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              required={feeRequired}
              value={form.fee}
              onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
            />
            {feeRequired && (
              <p className="text-micro text-muted-foreground">
                Recorded on the lead so the quoted pipeline totals stay accurate.
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => void submit('sign')} disabled={busy !== null}>
            {busy === 'sign' ? 'Starting…' : 'Sign now (in person)'}
          </Button>
          <Button onClick={() => void submit('email')} disabled={busy !== null}>
            {busy === 'email' ? 'Sending…' : 'Send by email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
