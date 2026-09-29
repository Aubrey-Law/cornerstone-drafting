'use client'

import dynamic from 'next/dynamic'
import { Landmark, List } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { ViewSwitch, type ViewSwitchOption } from '@/components/ViewSwitch'
import { MatterTabHeader } from './MatterTabHeader'
import type { AssetView } from '@/lib/matterPageTabs'
import { MatterFundingPanel } from './tabs/funding/MatterFundingPanel'
import type { PipelineMatter } from '@/types/database'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'

const MatterAssetsTab = dynamic(
  () => import('./tabs/assets').then(m => ({ default: m.MatterAssetsTab })),
  { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Loading assets…</p> },
)

const ASSET_VIEW_OPTIONS: readonly ViewSwitchOption<AssetView>[] = [
  { value: 'inventory', label: 'Inventory', icon: List },
  { value: 'funding', label: 'Funding', icon: Landmark },
]

interface Props {
  matterId: string
  matter: PipelineMatter
  intakeId: string | null
  enabled?: boolean
  anticipatedInheritance?: boolean
  onAnticipatedInheritanceChange?: (next: boolean) => void
  /** Inventory, or its trust funding. Without `onViewChange` only the inventory shows. */
  view?: AssetView
  onViewChange?: (view: AssetView) => void
}

export function MatterOverviewAssets({
  matterId,
  matter,
  intakeId,
  enabled = true,
  anticipatedInheritance = false,
  onAnticipatedInheritanceChange,
  view = 'inventory',
  onViewChange,
}: Props) {
  const token = useAccessToken()
  const showFunding = view === 'funding' && Boolean(onViewChange)

  return (
    <section className="space-y-3">
      <MatterTabHeader
        title="Assets"
        description={
          showFunding
            ? 'Whether each asset has been moved into the plan, confirmed by the institution.'
            : 'Household asset inventory. Changes sync automatically to the design sheet when a matter is linked.'
        }
        actions={
          onViewChange ? (
            <ViewSwitch value={view} options={ASSET_VIEW_OPTIONS} onChange={onViewChange} label="Assets view" />
          ) : null
        }
      />
      {showFunding ? (
        <MatterFundingPanel matterId={matterId} />
      ) : (
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
      )}
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
  view,
  onViewChange,
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
        view={view}
        onViewChange={onViewChange}
      />
    </TabsContent>
  )
}
