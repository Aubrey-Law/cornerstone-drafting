'use client'

import type { ReactNode } from 'react'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import type { MatterContact, PipelineMatter } from '@/types/database'
import { DpoaProvisionsSection } from './DpoaProvisionsSection'
import { HealthCareDesignSection } from './HealthCareDesignSection'
import { PlanStructureFactsSection } from './PlanStructureFactsSection'
import { AssetTransferDocumentsFields, PlanTypeBlock } from './PlanDesignSection'
import { SigningTypeDecision } from './SigningMechanicsSection'
import { TransfersAssignmentsSection } from './TransfersAssignmentsSection'
import { TrustDetailsSection } from './TrustDetailsSection'
import {
  DesignSectionContent,
  SectionBlock,
  type SectionProps,
} from './shared'

interface EssentialEstatePlanDesignSectionProps extends SectionProps {
  matter: PipelineMatter
  contacts: MatterContact[]
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  showInapplicable?: boolean
}

function ApplicableBlock({
  applicable,
  showInapplicable,
  children,
}: {
  applicable: boolean
  showInapplicable: boolean
  children: ReactNode
}) {
  if (!applicable && !showInapplicable) return null
  return <div className={!applicable ? 'opacity-45 grayscale-[20%]' : undefined}>{children}</div>
}

/**
 * The Estate Plan Design section of Essential Estate Plan Design.
 * Each block is the same control the full design sheet uses.
 */
export function EssentialEstatePlanDesignSection({
  sheet,
  onChange,
  matter,
  contacts,
  onAddContact,
  onUpdateContact,
  showInapplicable = false,
}: EssentialEstatePlanDesignSectionProps) {
  const inclusions = getDocumentInclusions(sheet)
  const revocableTrustPlan = designPlanTypeIncludesRevocableTrust(sheet.plan_type)
  const disallowsRevocableTrust = planTypeDisallowsRevocableTrustDocument(sheet.plan_type)
  const trustApplicable = sheet.plan_type == null || sheet.plan_type === ''
    ? inclusions.trust
    : inclusions.trust && revocableTrustPlan && !disallowsRevocableTrust

  return (
    <DesignSectionContent>
      <PlanTypeBlock sheet={sheet} onChange={onChange} />

      <SectionBlock
        title="Asset Transfer Documents"
        subtitle="Selected documents are generated with the estate plan. Real property below shows the fields those documents need."
      >
        <AssetTransferDocumentsFields sheet={sheet} onChange={onChange} />
      </SectionBlock>

      <PlanStructureFactsSection
        sheet={sheet}
        onChange={onChange}
        includeAssets={false}
        showPlacementNote={false}
      />

      <ApplicableBlock applicable={trustApplicable} showInapplicable={showInapplicable}>
        <SectionBlock title="Trust" subtitle="Joint or separate, the trust name, and who receives the residue.">
          <TrustDetailsSection
            sheet={sheet}
            onChange={onChange}
            contacts={contacts}
            matter={matter}
            onAddContact={onAddContact}
            onUpdateContact={onUpdateContact}
            variant="essential"
          />
        </SectionBlock>
      </ApplicableBlock>

      <ApplicableBlock applicable={inclusions.dpoa} showInapplicable={showInapplicable}>
        <SectionBlock title="Power of Attorney">
          <DpoaProvisionsSection sheet={sheet} onChange={onChange} onlyCoagent />
        </SectionBlock>
      </ApplicableBlock>

      <ApplicableBlock applicable={inclusions.healthcare} showInapplicable={showInapplicable}>
        <SectionBlock title="Health care">
          <HealthCareDesignSection
            sheet={sheet}
            onChange={onChange}
            contacts={contacts}
            matter={matter}
            onAddContact={onAddContact}
            onUpdateContact={onUpdateContact}
            scope="essential"
          />
        </SectionBlock>
      </ApplicableBlock>

      <TransfersAssignmentsSection
        sheet={sheet}
        onChange={onChange}
        matter={matter}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
        title="Real property"
      />

      <SectionBlock title="Signing Type">
        <SigningTypeDecision sheet={sheet} onChange={onChange} />
      </SectionBlock>
    </DesignSectionContent>
  )
}
