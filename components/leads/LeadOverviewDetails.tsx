'use client'

import { Button } from '@/components/ui/button'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { phoneTelHref } from '@/lib/phone'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'
import { leadDisplayDate } from './LeadOverview'

export function LeadOverviewDetails({ lead, spouse, clientName, lastContactAt, timeZone, onEdit }: {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  clientName: string
  lastContactAt: string | null
  timeZone: string
  onEdit: () => void
}) {
  const showSpouse = lead.marital_status?.trim().toLowerCase() === 'married'
  return (
    <section aria-label="Lead details" className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead Details</h2>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onEdit}>Edit</Button>
      </div>
      <div className={`grid gap-5 sm:grid-cols-2 ${showSpouse ? "2xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <Contact label="Client" name={clientName} email={lead.email} phone={lead.phone} />
        {showSpouse && <Contact label="Spouse" name={[spouse?.first_name, spouse?.last_name].filter(Boolean).join(' ') || 'Name not recorded'} email={spouse?.email} phone={spouse?.phone} />}
        <dl className="space-y-2 text-sm">
          <Fact label="Practice" value={practiceAreaLabel(lead.practice_area)} />
          <Fact label="Source" value={lead.lead_source || 'Not recorded'} />
          <Fact label="Fee quoted" value={lead.engagement_fee_quoted == null ? 'Not quoted' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(lead.engagement_fee_quoted)} />
        </dl>
        <dl className="space-y-2 text-sm">
          <Fact label="Address" value={[lead.address_line1, lead.address_line2, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'Not recorded'} />
          <Fact label="Last contact" value={leadDisplayDate(lastContactAt, timeZone)} />
        </dl>
      </div>
    </section>
  )
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>
}
function Contact({ label, name, email, phone }: { label: string; name: string; email?: string | null; phone?: string | null }) {
  const tel = phoneTelHref(phone)
  return <div className="min-w-0 space-y-1 text-sm"><h3 className="text-xs text-muted-foreground">{label}</h3><p className="font-medium">{name}</p>{email ? <a className="block break-all hover:underline" href={`mailto:${email}`}>{email}</a> : <p className="text-muted-foreground">No email recorded</p>}{tel ? <a className="block hover:underline" href={tel}>{phone}</a> : <p className="text-muted-foreground">{phone || 'No phone recorded'}</p>}</div>
}
