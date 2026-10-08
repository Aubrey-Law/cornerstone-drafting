import { Button } from '@/components/ui/button'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { formatDate } from '@/lib/utils'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterPlanMirror } from '@/lib/matter/planMirror'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value || 'Not recorded'}</dd></div>
}
export function MatterOverviewFacts({ matter, details, plan, estate, lastContactAt, onDetails }: {
  matter: PipelineMatter; details: MatterDetailsRow | null; plan: MatterPlanMirror; estate: MatterEstateSnapshot; lastContactAt: string | null; onDetails: () => void
}) {
  const married = matter.marital_status?.trim().toLowerCase() === 'married'
  const fee = details?.flat_fee_amount ?? matter.fee_amount
  const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  const hasPlan = Boolean(plan.planType || plan.trustName || plan.fiduciaries.some(item => item.primary || item.successor) || estate.assetCount > 0)
  const trustee = plan.fiduciaries.find(item => item.key === 'trustee_slots')
  return <section aria-labelledby="matter-facts-heading" className="rounded-lg border bg-card p-5">
    <div className="mb-4 flex items-center justify-between"><h2 id="matter-facts-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matter Details</h2><Button variant="link" size="sm" className="h-auto p-0" onClick={onDetails}>Edit</Button></div>
    <div className={married ? 'grid gap-6 md:grid-cols-2' : 'grid gap-6 lg:grid-cols-3'}>
        <div><h3 className="mb-3 text-sm font-medium">Client</h3><dl className="space-y-2">
          <Fact label="Name" value={matter.client_name} /><Fact label="Email" value={matter.client_email} />
          <Fact label="Phone" value={matter.client_phone} /><Fact label="Address" value={matter.client_address} />
        </dl></div>
        {married && <div><h3 className="mb-3 text-sm font-medium">Spouse</h3><dl className="space-y-2">
          <Fact label="Name" value={matter.spouse_name} /><Fact label="Email" value={matter.spouse_email} />
          <Fact label="Phone" value={matter.spouse_phone} /><Fact label="Address" value={matter.spouse_address} />
        </dl></div>}
      <div><h3 className="mb-3 text-sm font-medium">Plan</h3>{hasPlan ? <dl className="space-y-2"><Fact label="Type" value={plan.planType ? designPlanTypeLabel(plan.planType) : null} /><Fact label="Trust" value={plan.trustName} /><Fact label="Trustees" value={trustee ? [trustee.primary, trustee.successor].filter(Boolean).join(' → ') : null} /><Fact label="Estate" value={estate.assetCount > 0 ? `${money(estate.grossEstateEstimate)} estimated` : null} /></dl> : <div className="space-y-2"><p className="text-sm text-muted-foreground">Plan details have not been recorded yet.</p></div>}</div>
      <div><h3 className="mb-3 text-sm font-medium">Matter</h3><dl className="space-y-2"><Fact label="Fee" value={fee == null ? null : money(fee)} /><Fact label="Payment" value={details ? details.fee_collected || details.fee_payment_status === 'paid_in_full' ? 'Paid in full' : details.fee_payment_status === 'deposit' ? 'Partial payment' : 'Unpaid' : null} /><Fact label="Opened" value={matter.opened_at || matter.matter_created ? formatDate((matter.opened_at || matter.matter_created)!) : null} />{lastContactAt && <Fact label="Last contact" value={formatDate(lastContactAt)} />}</dl></div>
    </div>
  </section>
}
