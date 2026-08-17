import Link from 'next/link'
import { CheckCircle2, CircleDollarSign, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingNudge, BillingSnapshot } from '@/lib/billing/types'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function amount(cents: number) {
  return MONEY.format(cents / 100)
}
function ClaimsCard({ snapshot }: { snapshot: BillingSnapshot }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <CircleDollarSign className="size-4 text-muted-foreground" aria-hidden />
            Plan claims in flight
          </span>
          <span className="text-xs font-medium tabular-nums text-stage-active-text">
            {amount(snapshot.openClaims.reduce((sum, row) => sum + row.balance, 0))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        {snapshot.openClaims.length === 0 && snapshot.unpreparedClaims.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No plan claims need attention.</p>
        ) : (
          <>
            {snapshot.openClaims.map(claim => (
              <div key={claim.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/admin/matters/${claim.matterId}`}
                    className="text-xs font-medium hover:text-primary hover:underline"
                  >
                    {claim.clientName} — {claim.plan === 'metlife' ? 'MetLife' : 'LegalEASE'}
                  </Link>
                  <span className={claim.overdue ? 'text-xs font-semibold tabular-nums text-destructive' : 'text-xs font-medium tabular-nums'}>
                    {amount(claim.balance)}
                  </span>
                </div>
                <p className={claim.overdue ? 'mt-1 text-xs text-destructive' : 'mt-1 text-xs text-muted-foreground'}>
                  {claim.overdue ? `${claim.ageDays} days · follow up needed` : `Submitted · ${claim.ageDays}d`}
                </p>
              </div>
            ))}
            {snapshot.unpreparedClaims.map(claim => {
              const search = claim.legalPlan === 'metlife' ? 'metlife-claim' : 'legalease'
              return (
                <div key={`${claim.matterId}:${claim.legalPlan}`} className="px-4 py-3">
                  <p className="text-xs font-medium">{claim.clientName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {claim.legalPlan === 'metlife' ? 'MetLife' : 'LegalEASE'} claim not prepared
                  </p>
                  <Button asChild variant="link" size="sm" className="mt-1 h-auto min-h-11 px-0">
                    <Link href={`/admin/works?search=${search}`}>
                      Prep claim docs <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </Button>
                </div>
              )
            })}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** The verb for each follow-up, so the button says what it will actually do. */
const nudgeAction: Record<BillingNudge['kind'], string> = {
  bill: 'Bill',
  claim_submit: 'Submit',
  reminder: 'Remind',
  claim: 'Prep',
}

function WeekCard({
  nudges,
  onAction,
  onDismiss,
}: {
  nudges: BillingNudge[]
  onAction: (nudge: BillingNudge) => void
  onDismiss: (nudge: BillingNudge) => void
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">This week</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        {nudges.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-green" aria-hidden />
            Billing follow-up is clear.
          </div>
        ) : nudges.map(nudge => (
          <div key={nudge.key} className="flex items-start gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{nudge.clientName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{nudge.description}</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mt-1 h-auto min-h-11 px-0"
                onClick={() => onAction(nudge)}
              >
                {nudgeAction[nudge.kind]}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label={`Dismiss ${nudge.description} for this week`}
              onClick={() => onDismiss(nudge)}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function BillingRail({
  snapshot,
  onNudgeAction,
  onDismiss,
}: {
  snapshot: BillingSnapshot
  onNudgeAction: (nudge: BillingNudge) => void
  onDismiss: (nudge: BillingNudge) => void
}) {
  return (
    <aside aria-label="Billing follow-up" className="space-y-3">
      <ClaimsCard snapshot={snapshot} />
      <WeekCard nudges={snapshot.nudges} onAction={onNudgeAction} onDismiss={onDismiss} />
    </aside>
  )
}
