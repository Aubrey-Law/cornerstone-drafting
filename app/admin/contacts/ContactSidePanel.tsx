'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { ExternalLink, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecordCommunicationsCard } from '@/components/comms/RecordCommunicationsCard'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'
import { phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { CONTACT_KIND_LABELS, type ContactDirectoryRow } from '@/lib/adminTables/contactTable'

interface ContactSidePanelProps {
  contact: ContactDirectoryRow
  smsEnabled: boolean
  onClose: () => void
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}

export function ContactSidePanel({ contact, smsEnabled, onClose }: ContactSidePanelProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const location = [contact.city, contact.state].filter(Boolean).join(', ')
  const tel = phoneTelHref(contact.phone)

  // Intake-backed rows text the person themself; relationship contacts only
  // have a wired SMS path when they're the spouse on a hired matter.
  const smsSendable = contact.relationship_type === null
    || (contact.thread?.type === 'matter' && contact.relationship_type === 'spouse')
  const smsRole = contact.relationship_type === 'spouse' ? 'spouse' as const : 'client' as const

  return (
    <aside
      aria-label={`${contact.name} contact details`}
      className="sticky top-4 flex h-[calc(100vh-6rem)] w-[400px] shrink-0 flex-col rounded-lg border border-border bg-card shadow lg:w-[460px] xl:w-[520px]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-[10px] font-semibold text-muted-foreground"
        >
          {contact.name.trim().charAt(0).toUpperCase() || '—'}
        </span>
        <span className="truncate text-sm font-semibold">{contact.name}</span>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {CONTACT_KIND_LABELS[contact.kind]}
        </span>
        {contact.href && (
          <Button asChild type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2">
            <Link href={contact.href} aria-label="Open full record">
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={contact.href ? 'h-7 px-2' : 'ml-auto h-7 px-2'}
          aria-label="Close contact panel"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="rounded-md border border-border px-3 py-1.5">
          <InfoRow label="Email">
            {contact.email
              ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a>
              : <span className="text-muted-foreground">—</span>}
          </InfoRow>
          <InfoRow label="Phone">
            {contact.phone
              ? tel
                ? <a href={tel} className="hover:underline">{contact.phone}</a>
                : contact.phone
              : <span className="text-muted-foreground">—</span>}
          </InfoRow>
          {location && <InfoRow label="Location">{location}</InfoRow>}
          {contact.practice_area && <InfoRow label="Practice">{practiceAreaLabel(contact.practice_area)}</InfoRow>}
          {contact.matter_number && <InfoRow label="Matter">{contact.matter_number}</InfoRow>}
          {contact.relationship && <InfoRow label="Relationship">{contact.relationship}</InfoRow>}
        </section>

        {contact.thread ? (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Activity & communications
            </h3>
            <RecordCommunicationsCard
              key={contact.id}
              record={contact.thread}
              recipientName={contact.name}
              recipientEmail={contact.email}
              recipientPhone={contact.phone}
              smsEnabled={smsEnabled}
              smsRecipientRole={smsRole}
              smsSendable={smsSendable}
              smsDisabledReason="Texting from here is wired for leads, clients, and spouses. Use the call button to reach this contact."
            />
          </section>
        ) : (
          <section className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            <p>
              This contact isn&apos;t linked to a lead or matter, so there&apos;s no message history to show.
            </p>
            {contact.phone && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openStaffSoftphone({ number: contact.phone ?? undefined })}
              >
                <Phone className="h-3.5 w-3.5" />
                Call {contact.name.split(' ')[0]}
              </Button>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
