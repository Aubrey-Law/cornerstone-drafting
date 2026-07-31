'use client'

import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { DesignSheetOnChange } from './shared'
import { DesignSectionContent, SectionBlock } from './shared'
import { ExcludedGuardians } from './ExcludedGuardiansSection'
import type { FiduciarySlotField } from './fiduciary-blocks'
import { FiduciaryGrid } from './FiduciaryGrid'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LpData {
  li_plan_coverage: string
  li_design_sheet_data: Record<string, unknown>
  li_design_sheet_approved: boolean
}

export interface FiduciariesSectionProps {
  isLP: boolean
  // EP
  sheet: DesignSheet
  onChange: DesignSheetOnChange
  // LP
  lpData: LpData | null
  onLpChange: (key: string, value: unknown) => void
  // Shared
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  showInapplicable?: boolean
  /** Slot field a readiness blocker points at; flashes that grid column. */
  flashRoleKey?: FiduciarySlotField | null
}

// ── FiduciariesSection ────────────────────────────────────────────────────────

export default function FiduciariesSection({
  sheet,
  contacts,
  matter,
  onChange,
  onAddContact,
  onUpdateContact,
  showInapplicable = false,
  flashRoleKey = null,
}: FiduciariesSectionProps) {
  return (
    <DesignSectionContent>
      <SectionBlock
        title="Fiduciary assignments"
        subtitle="Set the order in which each person serves across every document."
      >
        <FiduciaryGrid
          sheet={sheet}
          contacts={contacts}
          matter={matter}
          onChange={onChange}
          onAddContact={onAddContact}
          showInapplicable={showInapplicable}
          flashRoleKey={flashRoleKey}
        />
      </SectionBlock>
      <ExcludedGuardians
        sheet={sheet}
        onChange={onChange}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
      />
    </DesignSectionContent>
  )
}
