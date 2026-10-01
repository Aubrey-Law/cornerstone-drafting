import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { loadFirmSettings } from '@/lib/firmSettings'
import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { calculateCommandCenterRolloutReadiness } from '@/lib/work/rollout'
import { listWorkGraphReconciliationRuns } from '@/lib/work/rolloutServer'
import { calculateCommandCenterCutoverReadiness } from '@/lib/work/cutover'
import { listCommandCenterUsage } from '@/lib/work/usageServer'
import { CommandCenterRolloutClient } from './CommandCenterRolloutClient'

export const dynamic = 'force-dynamic'

export default async function CommandCenterRolloutPage() {
  const auth = await getCachedClaims()
  const [settings, role, runs, usage] = await Promise.all([
    loadFirmSettings(),
    auth ? getCachedUserRole(auth.id) : Promise.resolve(null),
    auth ? listWorkGraphReconciliationRuns(auth.id, 100).catch(() => []) : Promise.resolve([]),
    auth ? listCommandCenterUsage(auth.id).catch(() => []) : Promise.resolve([]),
  ])
  const readiness = calculateCommandCenterRolloutReadiness(runs)
  const cutoverReadiness = calculateCommandCenterCutoverReadiness({
    enabledAt: settings.commandCenterV2EnabledAt,
    cutoverAt: settings.commandCenterCutoverAt,
    runs,
    usage,
  })

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1240px]">
      <PageHeader
        eyebrow="Settings"
        title="Command Center rollout"
        description="Run the Command Center beside legacy Today, measure ten business days of outcomes, and finalize cutover only after every safety gate passes."
      />
      <CommandCenterRolloutClient
        initialEnabled={settings.commandCenterV2Enabled}
        initialEnabledAt={settings.commandCenterV2EnabledAt}
        initialCutoverAt={settings.commandCenterCutoverAt}
        initialReadiness={readiness}
        initialCutoverReadiness={cutoverReadiness}
        initialRuns={runs}
        isAdministrator={role === 'admin'}
      />
    </AdminPageShell>
  )
}
