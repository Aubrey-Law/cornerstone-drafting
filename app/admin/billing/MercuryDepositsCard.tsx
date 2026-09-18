import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DepositIgnoreReason, DepositProposal, MatchCandidate } from '@/lib/integrations/mercury/reconcile'
import { formatDateTime } from '@/lib/utils'
import { moneyExact } from './financeFormat'

const IGNORE_LABELS: Record<DepositIgnoreReason, string> = {
  not_a_credit: 'money out',
  wrong_account: 'other account',
  internal_transfer: 'internal transfers',
  card_activity: 'card activity',
  house_credit: 'Mercury credits',
  not_settled: 'not settled',
  pending_settlement: 'pending',
}

const CONFIDENCE_LABELS: Record<MatchCandidate['confidence'], string> = {
  exact: 'Exact match',
  probable: 'Probable',
  possible: 'Possible',
}

function payerLine(proposal: DepositProposal): string {
  const { counterpartyName, bankDescription, postedAt } = proposal.deposit
  const who = counterpartyName ?? bankDescription ?? 'Unknown payer'
  return postedAt ? `${who} · ${formatDateTime(postedAt)}` : who
}

function DepositRow({ proposal, children }: { proposal: DepositProposal; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{payerLine(proposal)}</p>
        {children}
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-green">
        +{moneyExact(proposal.deposit.amountCents)}
      </span>
    </div>
  )
}

function CandidateLine({ candidate }: { candidate: MatchCandidate }) {
  const label = candidate.number ? `Invoice ${candidate.number}` : 'Draft invoice'
  return (
    <p className="mt-0.5 truncate text-xs text-muted-foreground">
      {candidate.matterId ? (
        <Link href={`/admin/matters/${candidate.matterId}`} className="font-medium hover:text-primary hover:underline">
          {label}
        </Link>
      ) : label}
      {candidate.clientName ? ` · ${candidate.clientName}` : ''}
      {' · '}{CONFIDENCE_LABELS[candidate.confidence]}
    </p>
  )
}

function Section({ title, proposals, showAllCandidates }: {
  title: string
  proposals: DepositProposal[]
  showAllCandidates?: boolean
}) {
  if (proposals.length === 0) return null
  return (
    <>
      <p className="bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground">
        {title} ({proposals.length})
      </p>
      {proposals.map(proposal => (
        <DepositRow key={proposal.deposit.transactionId} proposal={proposal}>
          {(showAllCandidates ? proposal.candidates : proposal.candidates.slice(0, 1))
            .map(candidate => <CandidateLine key={candidate.invoiceId} candidate={candidate} />)}
          {proposal.candidates.length === 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">No open invoice matches this amount.</p>
          )}
        </DepositRow>
      ))}
    </>
  )
}

/**
 * A worklist, not a statement.
 *
 * Deliberately shows no balances or cash position: Mercury owns the accounting,
 * and duplicating its figures here would be the first step to a second ledger.
 */
export function MercuryDepositsCard({ view }: { view: {
  summary: Record<'scanned' | 'ignored' | 'proposed' | 'ambiguous' | 'unmatched' | 'alreadyApplied', number>
  proposals: DepositProposal[]
} }) {
  const by = (status: DepositProposal['status']) => view.proposals.filter(row => row.status === status)
  const ignored = by('ignored')
  const actionable = view.summary.proposed + view.summary.ambiguous + view.summary.unmatched

  const ignoredByReason = new Map<DepositIgnoreReason, number>()
  for (const row of ignored) {
    if (row.ignoreReason) ignoredByReason.set(row.ignoreReason, (ignoredByReason.get(row.ignoreReason) ?? 0) + 1)
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Bank deposits</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        {actionable === 0 && (
          <p className="px-4 py-3 text-xs text-muted-foreground">No client deposits to review.</p>
        )}
        <Section title="Likely payments" proposals={by('proposed')} />
        <Section title="Needs a decision" proposals={by('ambiguous')} showAllCandidates />
        <Section title="No matching invoice" proposals={by('unmatched')} />
        {ignored.length > 0 && (
          <details className="px-4 py-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {ignored.length} not client payments
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              {[...ignoredByReason].map(([reason, count]) => `${count} ${IGNORE_LABELS[reason]}`).join(' · ')}
            </p>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
