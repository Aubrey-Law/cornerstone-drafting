'use client'

import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import { AttorneyNoteBanner, DesignSectionContent } from './shared'
import type { SectionProps } from './shared'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

export function FiduciariesSectionEP(_props: Props) {
  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Assign fiduciary roles on the Trust Details, Will Details, Financial Power of Attorney, and
        Health Care &amp; Directives sections below. Add contacts first in Contacts &amp; Fiduciaries.
      </AttorneyNoteBanner>
    </DesignSectionContent>
  )
}
