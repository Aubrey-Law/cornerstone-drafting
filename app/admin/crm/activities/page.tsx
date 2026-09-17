import { fetchCrmActivities } from '@/lib/queries/crmHub'
import { PageHeader } from '@/components/PageHeader'
import { ActivitiesClient } from './ActivitiesClient'

export const dynamic = 'force-dynamic'

export default async function CrmActivitiesPage() {
  const { rows, error } = await fetchCrmActivities()
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Activities" />
        <p role="alert" className="text-sm text-destructive">
          Could not load CRM activities ({error}). Apply the CRM hub migration first.
        </p>
      </div>
    )
  }
  return <ActivitiesClient rows={rows} />
}
