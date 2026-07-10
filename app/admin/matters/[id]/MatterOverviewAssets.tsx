'use client'

import dynamic from 'next/dynamic'
import { ChevronDown } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
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
  defaultOpen?: boolean
}

export function MatterOverviewAssets({ matterId, matter, intakeId, defaultOpen = false }: Props) {
  const token = useAccessToken()

  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-lg border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30">
        <div>
          <h3 className="text-sm font-semibold">Assets</h3>
          <p className="text-xs text-muted-foreground">
            Household asset inventory. Changes sync to the design sheet when intake is linked.
          </p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('border-t border-border px-4 py-4')}>
        <MatterAssetsTab
          matterId={matterId}
          intakeId={intakeId}
          clientName={matter.client_name}
          spouseName={matter.spouse_name}
          maritalStatus={matter.marital_status}
          accessToken={token}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
