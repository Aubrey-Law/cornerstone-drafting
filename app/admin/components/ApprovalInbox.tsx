'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, Eye, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ApprovalProposal {
  id: string
  action_key: string
  risk: string
  display_summary: string
  confirmation_policy: 'automatic' | 'one_click' | 'explicit' | 'never'
  created_at: string
  source?: string
}

interface ProposalPreview {
  proposal: ApprovalProposal
  preview: { display: Record<string, unknown> }
  confirmation: { policy: ApprovalProposal['confirmation_policy']; digest: string; stale: boolean }
}

function DisplayValue({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label.replace(/([A-Z])/g, ' $1')}</dt>
      <dd className={`mt-1 break-words text-sm ${label === 'content' ? 'max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-xs' : ''}`}>{text}</dd>
    </div>
  )
}

export function ApprovalInbox({
  initialProposals,
  onResolved,
}: {
  initialProposals: ApprovalProposal[]
  onResolved?: () => void | Promise<void>
}) {
  const [proposals, setProposals] = useState(initialProposals)
  const [selected, setSelected] = useState<ProposalPreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function review(proposal: ApprovalProposal) {
    setMessage(null)
    const response = await fetch(`/api/admin/actions/proposals/${proposal.id}`)
    const body = await response.json().catch(() => ({})) as ProposalPreview & { error?: string }
    if (!response.ok) {
      setMessage(body.error ?? 'Could not load the current preview.')
      return
    }
    setSelected(body)
  }

  async function execute(proposal: ApprovalProposal, confirmationDigest?: string) {
    setMessage(null)
    const response = await fetch(`/api/admin/actions/proposals/${proposal.id}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmationDigest }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      setMessage(body.error ?? 'Could not execute the action.')
      return
    }
    startTransition(() => {
      setProposals(current => current.filter(item => item.id !== proposal.id))
      setSelected(current => current?.proposal.id === proposal.id ? null : current)
      setMessage('Action completed and recorded in the audit log.')
    })
    void onResolved?.()
  }

  async function reject(proposal: ApprovalProposal) {
    setMessage(null)
    const response = await fetch(`/api/admin/actions/proposals/${proposal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) {
      setMessage(body.error ?? 'Could not reject the action.')
      return
    }
    startTransition(() => {
      setProposals(current => current.filter(item => item.id !== proposal.id))
      setSelected(current => current?.proposal.id === proposal.id ? null : current)
    })
    void onResolved?.()
  }

  return (
    <div className="space-y-3">
      <div aria-live="polite">
        {message ? <p className="rounded-md border bg-muted p-2 text-sm">{message}</p> : null}
      </div>
      {proposals.length ? proposals.map(proposal => (
        <div key={proposal.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <strong>{proposal.display_summary}</strong>
              <p className="mt-1 text-xs text-muted-foreground">{proposal.action_key} · {new Date(proposal.created_at).toLocaleString()}{proposal.source ? ` · prepared by ${proposal.source}` : ''}</p>
            </div>
            <Badge variant="outline">{proposal.risk.replace('_', ' ')}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {proposal.confirmation_policy === 'explicit' ? (
              <Button size="sm" variant="outline" onClick={() => void review(proposal)} disabled={isPending}>
                <Eye className="h-3.5 w-3.5" /> Review exact change
              </Button>
            ) : (
              <Button size="sm" onClick={() => void execute(proposal)} disabled={isPending || proposal.confirmation_policy === 'never'}>
                <Check className="h-3.5 w-3.5" /> Apply
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void reject(proposal)} disabled={isPending}>
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
          {selected?.proposal.id === proposal.id ? (
            <div className="mt-3 rounded-lg border bg-background p-3">
              {selected.confirmation.stale ? (
                <div role="alert" className="mb-3 flex items-center gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" /> The source changed. Prepare a new proposal before acting.
                </div>
              ) : null}
              <dl className="space-y-3">
                {Object.entries(selected.preview.display).map(([label, value]) => <DisplayValue key={label} label={label} value={value} />)}
              </dl>
              <Button
                className="mt-4"
                size="sm"
                disabled={isPending || selected.confirmation.stale}
                onClick={() => void execute(proposal, selected.confirmation.digest)}
              >
                Confirm this exact {proposal.risk === 'external_write' ? 'send' : 'change'}
              </Button>
            </div>
          ) : null}
        </div>
      )) : <p className="text-sm text-muted-foreground">No actions are waiting for your approval.</p>}
    </div>
  )
}
