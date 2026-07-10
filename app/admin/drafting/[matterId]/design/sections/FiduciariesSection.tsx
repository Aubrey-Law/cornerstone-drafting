'use client'

import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { DesignSheetOnChange } from './shared'
import { FiduciariesSectionEP } from './FiduciariesSectionEP'
import { FiduciariesSectionLP } from './FiduciariesSectionLP'

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
}

// ── FiduciariesSection ────────────────────────────────────────────────────────

export default function FiduciariesSection({ isLP, ...props }: FiduciariesSectionProps) {
  if (isLP) {
    return (
      <FiduciariesSectionLP
        lpData={props.lpData}
        sheet={props.sheet}
        contacts={props.contacts}
        onChange={props.onLpChange}
        matter={props.matter}
        onAddContact={props.onAddContact}
        onUpdateContact={props.onUpdateContact}
      />
    )
  }

  return (
    <FiduciariesSectionEP
      sheet={props.sheet}
      contacts={props.contacts}
      matter={props.matter}
      onChange={props.onChange}
      onAddContact={props.onAddContact}
      onUpdateContact={props.onUpdateContact}
    />
  )
}
