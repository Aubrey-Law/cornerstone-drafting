'use client'

import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { MatterFactsPanel, type MatterFactsPanelProps } from './facts-panel/MatterFactsPanel'
import { MatterDetailsCard } from './MatterDetailsCard'

/**
 * The Details panel body: the facts panel (always `simplified` here) with the
 * administrative settings folded underneath. The page owns the rail around it.
 */
export function MatterDetailsPanel({ facts, admin, onOpenIntake }: {
  facts: Omit<MatterFactsPanelProps, 'simplified'>
  admin: ComponentProps<typeof MatterDetailsCard>
  onOpenIntake: () => void
}) {
  return (
    <div className="h-full overflow-y-auto">
      <MatterFactsPanel {...facts} simplified />
      <details className="border-t p-4">
        <summary className="cursor-pointer text-sm font-medium">Administrative settings</summary>
        <MatterDetailsCard {...admin} />
        <Button variant="outline" onClick={onOpenIntake}>Review / update intake</Button>
      </details>
    </div>
  )
}
