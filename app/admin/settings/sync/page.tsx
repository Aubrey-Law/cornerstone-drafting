import { fetchCrmSyncEvents } from '@/lib/queries/crmHub'
import { PageHeader } from '@/components/PageHeader'
import { SyncClient } from './SyncClient'

export const dynamic = 'force-dynamic'

export default async function CrmSyncPage() {
  const { rows, error } = await fetchCrmSyncEvents()
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Sync" />
        <p role="alert" className="text-sm text-destructive">
          Could not load CRM sync events ({error}). Apply the CRM hub migration first.
        </p>
      </div>
    )
  }
  return <SyncClient rows={rows} />
}
