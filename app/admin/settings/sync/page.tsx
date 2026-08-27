import { fetchCrmSyncEvents } from '@/lib/queries/crmHub'
import { SyncClient } from './SyncClient'

export const dynamic = 'force-dynamic'

export default async function CrmSyncPage() {
  const { rows, error } = await fetchCrmSyncEvents()
  if (error) return <div className="space-y-2"><h1 className="text-xl font-semibold">Sync</h1><p className="text-sm text-destructive">Could not load CRM sync events ({error}). Apply the CRM hub migration first.</p></div>
  return <SyncClient rows={rows} />
}
