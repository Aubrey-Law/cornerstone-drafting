'use client'

import dynamic from 'next/dynamic'
import { TabsContent } from '@/components/ui/tabs'
import type { PipelineMatter } from '@/types/database'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

const MatterAssetsTab = dynamic(
  () => import('./tabs/assets').then(m => ({ default: m.MatterAssetsTab })),
  { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Loading assets…</p> },
)

interface Props {
  matterId: string
  matter: PipelineMatter
  intakeId: string | null
  enabled?: boolean
  anticipatedInheritance?: boolean
  onAnticipatedInheritanceChange?: (next: boolean) => void
}

export function MatterOverviewAssets({
  matterId,
  matter,
  intakeId,
  enabled = true,
  anticipatedInheritance = false,
  onAnticipatedInheritanceChange,
}: Props) {
  const token = useAccessToken()

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Assets</h3>
        <p className="text-xs text-muted-foreground">
          Household asset inventory. Changes sync automatically to the design sheet when a matter is linked.
        </p>
      </div>
      <MatterAssetsTab
        matterId={matterId}
        intakeId={intakeId}
        clientName={matter.client_name}
        spouseName={matter.spouse_name}
        maritalStatus={matter.marital_status}
        accessToken={token}
        enabled={enabled}
        anticipatedInheritance={anticipatedInheritance}
        onAnticipatedInheritanceChange={onAnticipatedInheritanceChange}
      />
    </section>
  )
}

export function MatterAssetsTabContent({
  matterId,
  matter,
  intakeId,
  enabled = true,
  anticipatedInheritance = false,
  onAnticipatedInheritanceChange,
}: Props) {
  return (
    <TabsContent value="assets" className="space-y-4">
      <MatterOverviewAssets
        matterId={matterId}
        matter={matter}
        intakeId={intakeId}
        enabled={enabled}
        anticipatedInheritance={anticipatedInheritance}
        onAnticipatedInheritanceChange={onAnticipatedInheritanceChange}
      />
    </TabsContent>
  )
}
