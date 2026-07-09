'use client'

import dynamic from 'next/dynamic'
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
}

export function MatterOverviewAssets({ matterId, matter, intakeId }: Props) {
  const token = useAccessToken()

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Assets</h3>
        <p className="text-xs text-muted-foreground">
          Household asset inventory. Add assets manually or import from a spreadsheet or document.
        </p>
      </div>
      <MatterAssetsTab
        matterId={matterId}
        intakeId={intakeId}
        clientName={matter.client_name}
        spouseName={matter.spouse_name}
        maritalStatus={matter.marital_status}
        accessToken={token}
      />
    </section>
  )
}
