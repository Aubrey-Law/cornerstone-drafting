'use client'

import type { ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import type { MatterContact, PipelineMatter } from '@/types/database'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  DesignSectionContent,
  FieldLabel,
  SectionBlock,
} from './shared'
import { SegControl } from './fiduciary-blocks'
import { DpoaProvisionsSection } from './DpoaProvisionsSection'
import { HealthCareDesignSection } from './HealthCareDesignSection'
import { WillPersonalRepresentativePowersSection } from './WillPersonalRepresentativePowersSection'
import { WillProvisionsSection } from './WillProvisionsSection'
import {
  DpoaFiduciarySections,
  WillFiduciarySections,
} from './documentFiduciarySections'
import {
  TrustDetailsSection,
  TrustDetailsSpouseSection,
  TrustDocumentSection,
} from './TrustDetailsSection'

export { TrustDetailsSection, TrustDetailsSpouseSection, TrustDocumentSection }

interface DocumentSectionProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

function SectionHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800/40 dark:bg-blue-950/20">
      <p className="text-[11px] text-blue-700 dark:text-blue-300">{children}</p>
    </div>
  )
}

function ExcludedGuardians({ sheet, onChange }: SectionProps) {
  const enabled = Boolean(sheet.excluded_guardian_flag)
  return (
    <SectionBlock title="Excluded Guardian(s)">
      <label className="flex items-start gap-2">
        <Checkbox
          checked={enabled}
          onCheckedChange={checked => {
            const next = checked === true
            onChange('excluded_guardian_flag', next)
            if (!next) onChange('excluded_guardian_name', null)
          }}
        />
        <span className="text-xs leading-5 text-foreground">
          Exclude one or more individuals from serving as guardian
        </span>
      </label>
      {enabled && (
        <div className="mt-4">
          <AttorneyInput
            label="Excluded individual(s) + reason"
            value={sheet.excluded_guardian_name ?? ''}
            placeholder="e.g. Jane Doe — estranged"
            onChange={v => onChange('excluded_guardian_name', v || null)}
          />
        </div>
      )}
    </SectionBlock>
  )
}

export function WillDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange } = props
  const hasMinors = sheetHasMinorChildren(sheet.children)

  return (
    <DesignSectionContent>
      <SectionHelp>Configure will-specific provisions and nominate personal representatives and guardians here.</SectionHelp>
      {hasMinors && <ExcludedGuardians sheet={sheet} onChange={onChange} />}
      <WillFiduciarySections {...props} />
      <WillPersonalRepresentativePowersSection sheet={sheet} onChange={onChange} />
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="will" />
    </DesignSectionContent>
  )
}

export function DpoaDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange } = props

  return (
    <DesignSectionContent>
      <SectionHelp>
        The options in this section apply to all power of attorney documents created as part of this package.
      </SectionHelp>
      <DpoaFiduciarySections {...props} />
      <DpoaProvisionsSection sheet={sheet} onChange={onChange} />
    </DesignSectionContent>
  )
}

export function HealthCareDocumentSection(props: DocumentSectionProps) {
  return (
    <DesignSectionContent>
      <SectionHelp>
        Nominate health care agents, make anatomical gift elections, and configure HIPAA and advance directive choices here.
      </SectionHelp>
      <HealthCareDesignSection {...props} />
    </DesignSectionContent>
  )
}

export function DeedDocumentSection({ sheet, onChange }: SectionProps) {
  const decisions = sheet.decisions ?? {}
  const deed = typeof decisions.deed === 'object' && decisions.deed !== null && !Array.isArray(decisions.deed)
    ? decisions.deed as Record<string, unknown>
    : {}
  const updateDeed = (key: string, value: unknown) => {
    onChange('decisions', {
      ...decisions,
      deed: {
        ...deed,
        [key]: value,
      },
    })
  }

  return (
    <DesignSectionContent>
      <SectionHelp>Track whether real property needs to be transferred into the trust.</SectionHelp>
      <SectionBlock title="Deed Work">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Deed Work Needed?</FieldLabel>
            <SegControl value={deed.needed === false ? 'no' : 'yes'} options={YES_NO} onChange={v => updateDeed('needed', v === 'yes')} />
          </div>
          <AttorneySelect
            label="Deed Status"
            value={typeof deed.status === 'string' ? deed.status : 'not_started'}
            options={[
              { value: 'not_started', label: 'Not started' },
              { value: 'information_needed', label: 'Information needed' },
              { value: 'drafted', label: 'Drafted' },
              { value: 'sent_for_signing', label: 'Sent for signing' },
              { value: 'recorded', label: 'Recorded' },
              { value: 'not_applicable', label: 'Not applicable' },
            ]}
            onChange={v => updateDeed('status', v)}
          />
          <div>
            <FieldLabel>Existing Deed Requested / Received?</FieldLabel>
            <SegControl value={deed.existing_deed_received ? 'yes' : 'no'} options={YES_NO} onChange={v => updateDeed('existing_deed_received', v === 'yes')} />
          </div>
          <AttorneyInput
            label="Recording County"
            value={typeof deed.recording_county === 'string' ? deed.recording_county : ''}
            onChange={v => updateDeed('recording_county', v || null)}
          />
        </div>
      </SectionBlock>
      <SectionBlock title="Deed Notes">
        <div className="grid gap-4">
          <div>
            <FieldLabel>Real Property Transfer Notes</FieldLabel>
            <Input value={typeof deed.transfer_notes === 'string' ? deed.transfer_notes : ''} onChange={e => updateDeed('transfer_notes', e.target.value || null)} />
          </div>
          <div>
            <FieldLabel>Funding-to-Trust Notes</FieldLabel>
            <Input value={typeof deed.funding_notes === 'string' ? deed.funding_notes : ''} onChange={e => updateDeed('funding_notes', e.target.value || null)} />
          </div>
          <div>
            <FieldLabel>Follow-up Notes</FieldLabel>
            <Input value={typeof deed.follow_up_notes === 'string' ? deed.follow_up_notes : ''} onChange={e => updateDeed('follow_up_notes', e.target.value || null)} />
          </div>
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}
