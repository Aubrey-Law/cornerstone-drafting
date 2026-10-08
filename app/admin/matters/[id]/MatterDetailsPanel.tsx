'use client'

import { MatterFactsPanel, type MatterFactsPanelProps } from './facts-panel/MatterFactsPanel'
import { MatterAdminRows, type MatterAdminRowsProps } from './facts-panel/MatterAdminRows'

/**
 * The Details panel body: the facts panel (always `simplified` here) with the
 * matter's administrative fields folded into its Matter section, so every
 * field has exactly one home. The page owns the rail around it.
 */
export function MatterDetailsPanel({ facts, admin }: {
  facts: Omit<MatterFactsPanelProps, 'simplified' | 'adminRows'>
  admin: MatterAdminRowsProps
}) {
  return (
    <div className="h-full overflow-y-auto">
      <MatterFactsPanel {...facts} simplified adminRows={<MatterAdminRows {...admin} />} />
    </div>
  )
}
