import { fetchCrmActivities } from '@/lib/queries/crmHub'
import { ActivitiesClient } from './ActivitiesClient'

export const dynamic = 'force-dynamic'

export default async function CrmActivitiesPage() {
  const { rows, error } = await fetchCrmActivities()
  if (error) return <div className="space-y-2"><h1 className="text-xl font-semibold">Activities</h1><p className="text-sm text-destructive">Could not load CRM activities ({error}). Apply the CRM hub migration first.</p></div>
  return <ActivitiesClient rows={rows} />
}
