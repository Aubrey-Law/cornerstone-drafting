'use client'

import { ChannelListField } from '@/components/contacts/ChannelListField'
import { parseContactChannels, type ContactChannel } from '@/lib/contacts/additionalChannels'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

/** Which person's secondary addresses an edit is for. */
export type LeadChannelTarget = 'client' | 'spouse'
export type LeadChannelField = 'additional_emails' | 'additional_phones'

/**
 * The extra emails and phones for the household, shown under the people on the
 * record rather than in the field rail — they are contact rows, not fields.
 */
export function LeadChannelsCard({
  lead,
  spouse,
  onSaveChannels,
}: {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  onSaveChannels: (
    target: LeadChannelTarget,
    field: LeadChannelField,
    channels: ContactChannel[],
  ) => Promise<void>
}) {
  return (
    <section aria-label="Other ways to reach them" className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Other ways to reach them</h3>
      <div className="mt-2 space-y-1">
        <ChannelListField
          label="Client emails"
          kind="email"
          channels={parseContactChannels(lead.additional_emails)}
          onSave={channels => onSaveChannels('client', 'additional_emails', channels)}
        />
        <ChannelListField
          label="Client phones"
          kind="phone"
          channels={parseContactChannels(lead.additional_phones)}
          onSave={channels => onSaveChannels('client', 'additional_phones', channels)}
        />
        {spouse && (
          <>
            <ChannelListField
              label="Spouse emails"
              kind="email"
              channels={parseContactChannels(spouse.additional_emails)}
              onSave={channels => onSaveChannels('spouse', 'additional_emails', channels)}
            />
            <ChannelListField
              label="Spouse phones"
              kind="phone"
              channels={parseContactChannels(spouse.additional_phones)}
              onSave={channels => onSaveChannels('spouse', 'additional_phones', channels)}
            />
          </>
        )}
      </div>
    </section>
  )
}
