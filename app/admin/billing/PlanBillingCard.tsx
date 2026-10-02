import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingPlan, BillingSnapshot } from '@/lib/billing/types'
import { money } from './financeFormat'

const planNames: Record<BillingPlan, string> = {
  metlife: 'MetLife',
  legalease: 'LegalEASE',
}

/**
 * What each legal plan carrier has been billed and has paid. Billed counts a
 * claim from the day it was submitted — marked submitted, or sent out on a
 * carrier invoice — so it reads as "claims we put in", not "work entered".
 */
export function PlanBillingCard({ snapshot }: { snapshot: BillingSnapshot }) {
  const rollups = snapshot.planBilling
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Billed to legal plans</CardTitle>
        <p className="text-xs text-muted-foreground">Claims submitted, paid and still owed by each carrier</p>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4">
        {rollups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No legal plan claims yet.</p>
        ) : (
          rollups.map(rollup => (
            <section key={rollup.plan} aria-label={planNames[rollup.plan]} className="space-y-2">
              <h3 className="text-sm font-medium">{planNames[rollup.plan]}</h3>
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="py-1 text-left font-normal"><span className="sr-only">Measure</span></th>
                    <th scope="col" className="py-1 text-right font-normal">This month</th>
                    <th scope="col" className="py-1 text-right font-normal">Year to date</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">Billed</th>
                    <td className="py-1.5 text-right font-semibold">{money(rollup.billedMonth)}</td>
                    <td className="py-1.5 text-right font-semibold">{money(rollup.billedYtd)}</td>
                  </tr>
                  <tr className="border-t border-border">
                    <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">Collected</th>
                    <td className="py-1.5 text-right">{money(rollup.collectedMonth)}</td>
                    <td className="py-1.5 text-right">{money(rollup.collectedYtd)}</td>
                  </tr>
                </tbody>
              </table>
              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border px-2.5 py-2">
                  <dt className="text-xs text-muted-foreground">Owed by {planNames[rollup.plan]}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{money(rollup.outstanding)}</dd>
                </div>
                <div className="rounded-md border border-border px-2.5 py-2">
                  <dt className="text-xs text-muted-foreground">Not yet submitted</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {money(rollup.awaitingSubmission.amount)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      · {rollup.awaitingSubmission.count} claim{rollup.awaitingSubmission.count === 1 ? '' : 's'}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  )
}
