'use client'

import { setEstatePlanDesignSetup, getEstatePlanDesignSetup } from '@/lib/designSheetDocumentInclusions'
import type { SectionProps } from './shared'
import { DecisionRow, DesignSectionContent, SectionBlock } from './shared'

export function FamilySection({ sheet, onChange }: SectionProps) {
  const estatePlanSetup = getEstatePlanDesignSetup(sheet)
  const clientFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || '[Name]'

  return (
    <DesignSectionContent>
      <SectionBlock
        title="Will Title"
        subtitle="Choose the title used for the generated Last Will and Testament."
      >
        <DecisionRow
          question="Will title"
          help="Select the title that should appear at the top of the will."
          value={estatePlanSetup.will_title}
          options={[
            { value: 'last_will', label: `Last Will and Testament of ${clientFirst}` },
            { value: 'pour_over_will', label: `Pour-Over Will of ${clientFirst}` },
          ]}
          onChange={value => onChange('decisions', prev => setEstatePlanDesignSetup(prev, { will_title: value }))}
        />
      </SectionBlock>
    </DesignSectionContent>
  )
}
