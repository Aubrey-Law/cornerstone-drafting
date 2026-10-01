import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { loadFirmSettings } from '@/lib/firmSettings'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { calculateCommandCenterRolloutReadiness } from '@/lib/work/rollout'
import { listWorkGraphReconciliationRuns } from '@/lib/work/rolloutServer'
import { CommandCenterRolloutClient } from './CommandCenterRolloutClient'

export const dynamic = 'force-dynamic'

export default async function CommandCenterRolloutPage() {
  const auth = await getCachedClaims()
  const [settings, role, runs] = await Promise.all([
    loadFirmSettings(),
    auth ? getCachedUserRole(auth.id) : Promise.resolve(null),
    auth ? listWorkGraphReconciliationRuns(auth.id).catch(() => []) : Promise.resolve([]),
  ])
  const readiness = calculateCommandCenterRolloutReadiness(runs)

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1240px]">
      <PageHeader
        eyebrow="Settings"
        title="Command Center rollout"
        description="Measure the canonical work graph against legacy Today, inspect gaps, and activate the new daily plan only after the safety gate passes."
      />
      <CommandCenterRolloutClient
        initialEnabled={settings.commandCenterV2Enabled}
        initialEnabledAt={settings.commandCenterV2EnabledAt}
        initialReadiness={readiness}
        initialRuns={runs}
        isAdministrator={role === 'admin'}
      />
    </AdminPageShell>
  )
}
