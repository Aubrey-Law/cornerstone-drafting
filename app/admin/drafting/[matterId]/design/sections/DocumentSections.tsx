'use client'

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import type { MatterContact, PipelineMatter } from '@/types/database'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  DecisionRow,
  DesignSectionContent,
  FieldLabel,
  SectionBlock,
} from './shared'
import { DpoaProvisionsSection } from './DpoaProvisionsSection'
import { HealthCareDesignSection } from './HealthCareDesignSection'
import { WillPersonalRepresentativePowersSection } from './WillPersonalRepresentativePowersSection'
import { WillProvisionsSection } from './WillProvisionsSection'
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
    <div className="mb-4 rounded-md border border-blue-strong-border bg-blue-bg px-3 py-2">
      <p className="text-[11px] text-blue">{children}</p>
    </div>
  )
}

export function WillDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange } = props

  return (
    <DesignSectionContent>
      <SectionHelp>Configure will-specific provisions here. Fiduciary nominations are managed in the Fiduciaries grid.</SectionHelp>
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
      <DpoaProvisionsSection sheet={sheet} onChange={onChange} />
    </DesignSectionContent>
  )
}

export function HealthCareDocumentSection(props: DocumentSectionProps) {
  return (
    <DesignSectionContent>
      <SectionHelp>
        Make anatomical gift elections and configure HIPAA and advance directive choices here. Agent nominations are managed in the Fiduciaries grid.
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
    onChange('decisions', prevSheet => {
      const prevDecisions = prevSheet.decisions ?? {}
      const prevDeed = typeof prevDecisions.deed === 'object' && prevDecisions.deed !== null && !Array.isArray(prevDecisions.deed)
        ? prevDecisions.deed as Record<string, unknown>
        : {}
      return {
        ...prevDecisions,
        deed: {
          ...prevDeed,
          [key]: value,
        },
      }
    })
  }

  return (
    <DesignSectionContent>
      <SectionHelp>Track whether real property needs to be transferred into the trust.</SectionHelp>
      <SectionBlock title="Deed Work">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <DecisionRow
            question="Deed work needed?"
            value={deed.needed === false ? 'no' : 'yes'}
            options={YES_NO}
            onChange={v => updateDeed('needed', v === 'yes')}
          />
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
          <DecisionRow
            question="Existing deed requested or received?"
            value={deed.existing_deed_received ? 'yes' : 'no'}
            options={YES_NO}
            onChange={v => updateDeed('existing_deed_received', v === 'yes')}
          />
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
